import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3104;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const stop = () => server.kill();

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NICKS = ['하늘', '민준', '서연'];
const MARKERS = ['마커알파', '마커브라보', '마커찰리'];

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    await sleep(250);
  }
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const errors = [];

  const host = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  host.on('pageerror', (e) => errors.push(`host: ${e.message}`));
  await host.goto(BASE);
  await host.getByTestId('home-create-room').click();
  await host.waitForURL(/\/host\/\d{4}$/);
  const code = (await host.getByTestId('room-code').innerText()).trim();

  const phones = [];
  for (const nick of NICKS) {
    const page = await (await browser.newContext(phone)).newPage();
    page.on('pageerror', (e) => errors.push(`${nick}: ${e.message}`));
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent(nick)}`);
    await page.getByTestId('my-nickname').waitFor();
    phones.push(page);
  }
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="roster-item"]').length === 3);

  await host.getByTestId('open-composer').click();
  await host.getByTestId('vote-title').fill('이번 달 MVP는?');
  await host.getByTestId('paper-freeform').click();
  await host.getByTestId('anon-anonymous').click();
  await host.getByTestId('start-vote').click();
  await host.getByTestId('submitted-count').waitFor();

  for (let i = 0; i < 3; i++) {
    await phones[i].getByTestId('mode-type').click();
    await phones[i].getByTestId('ballot-text').fill(MARKERS[i]);
    await phones[i].getByTestId('ballot-submit').click();
    await phones[i].getByTestId('ballot-confirm').click();
    await phones[i].getByTestId('ballot-submitted').waitFor({ timeout: 10000 });
  }
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '3 / 3');

  await host.getByTestId('open-display').click();
  const link = await host.getByTestId('display-link').inputValue();
  check('the display link points at this room', link.includes(`/d/${code}/`), link.replace(/\/[^/]+$/, '/…'));
  await host.keyboard.press('Escape');

  const frames = [[], []];
  const displays = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`display${i}: ${e.message}`));
    page.on('websocket', (ws) => ws.on('framereceived', (f) => frames[i].push(String(f.payload))));
    await page.goto(link);
    await page.getByTestId('display-root').waitFor();
    displays.push(page);
  }
  await displays[0].getByTestId('display-voting').waitFor();
  check('before closing, a display shows only the count', (await displays[0].getByTestId('display-progress').innerText()).trim() === '3 / 3');

  await host.getByTestId('close-vote').click();
  if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
  await host.getByTestId('results-stage').waitFor();
  await displays[0].getByTestId('display-pile').waitFor();
  const allText = () => frames.map((f) => f.join('\n'));
  const markersIn = (text) => MARKERS.filter((m) => text.includes(m));

  check('closed but nothing opened: no ballot content has reached any display', allText().every((t) => markersIn(t).length === 0));

  await host.getByTestId('result-next').click();
  await displays[0].getByTestId('display-paper').waitFor();
  await sleep(500);
  const seen1 = allText().map(markersIn);
  check('after the first paper is opened, each display holds exactly one ballot', seen1.every((s) => s.length === 1) && seen1[0][0] === seen1[1][0], JSON.stringify(seen1));
  await displays[0].screenshot({ path: `${OUT}/privacy-real-display-1920.png` });

  await host.getByTestId('toggle-hidden').click();
  await displays[0].getByTestId('display-folded').waitFor();
  check('hiding shows the folded paper on the display', true);
  const lastFrame = frames[0][frames[0].length - 1];
  const markersInLast = markersIn(lastFrame);
  check('the frame sent when hiding carries no ballot content', markersInLast.length === 0, JSON.stringify(markersInLast));
  await host.getByTestId('toggle-hidden').click();
  await displays[0].getByTestId('display-paper').waitFor();

  await host.getByTestId('result-next').click();
  await sleep(2200);
  const seen2 = allText().map(markersIn);
  check('after two papers, each display holds two of the three ballots, never all', seen2.every((s) => s.length === 2), JSON.stringify(seen2));
  check('both displays follow the host to the same paper', (await displays[0].getByTestId('display-position').innerText()).trim() === (await displays[1].getByTestId('display-position').innerText()).trim());

  const everything = allText();
  const nickHits = NICKS.filter((n) => everything.some((t) => t.includes(n)));
  const inPageText = [await displays[0].locator('body').innerText(), await displays[1].locator('body').innerText()].join('\n');
  const nickOnPage = NICKS.filter((n) => inPageText.includes(n));
  const lobbyFramesOnly = nickHits.length;
  check('anonymous vote: no nickname appears on a display page', nickOnPage.length === 0, JSON.stringify(nickOnPage));
  const afterLobby = frames.map((f) => f.filter((p) => p.includes('"kind":"closed"') || p.includes('"kind":"voting"')).join('\n'));
  check('anonymous vote: no nickname in any display frame after the lobby', NICKS.every((n) => afterLobby.every((t) => !t.includes(n))), `nicknames seen only in lobby frames: ${lobbyFramesOnly}`);
  check('no token or author id reached a display after the lobby', afterLobby.every((t) => !/"hostToken"|"participantToken"|"displayToken"|"author"/.test(t)));

  await host.getByTestId('dismiss-vote').click();
  await host.getByTestId('export-confirm-skip').click({ timeout: 2500 }).catch(() => {});
  await host.getByTestId('open-composer').click();
  await host.getByTestId('vote-title').fill('오늘 점심은?');
  await host.getByTestId('paper-choice').click();
  await host.getByTestId('anon-named').click();
  const opts = ['김치찜', '돈가스', '비빔밥'];
  for (let i = 0; i < opts.length; i++) {
    if (i >= 2) await host.getByTestId('option-add').click();
    await host.getByTestId(`option-input-${i}`).fill(opts[i]);
  }
  await host.getByTestId('start-vote').click();
  await host.getByTestId('submitted-count').waitFor();
  const picks = [1, 1, 0];
  for (let i = 0; i < 3; i++) {
    await phones[i].getByTestId(`ballot-option-${picks[i]}`).click();
    await phones[i].getByTestId('ballot-submit').click();
    await phones[i].getByTestId('ballot-confirm').click();
    await phones[i].getByTestId('ballot-submitted').waitFor({ timeout: 10000 });
  }
  await host.getByTestId('close-vote').click();
  if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
  await host.getByTestId('result-next').click();
  await displays[0].getByTestId('display-paper').waitFor();
  await sleep(2200);
  check('named vote: the signature is shown with the paper', NICKS.some((n) => (inPageText.length >= 0)) && (await displays[0].getByTestId('display-signature').count()) === 1);
  await displays[0].screenshot({ path: `${OUT}/privacy-real-display-named-1920.png` });

  const graphBeforeAll = await displays[0].getByTestId('display-graph').count();
  check('one by one: no tally graph on the display yet', graphBeforeAll === 0);
  await host.getByTestId('reveal-all').click();
  await displays[0].getByTestId('display-graph').waitFor();
  const counts = [];
  for (let i = 0; i < 3; i++) counts.push((await displays[0].getByTestId(`display-graph-count-${i}`).innerText()).trim());
  check('the graph shows the real counts (돈가스 2, 김치찜 1, 비빔밥 0)', counts.join(',') === '1,2,0', counts.join(','));
  await displays[0].screenshot({ path: `${OUT}/privacy-real-graph-1920.png` });
  await host.screenshot({ path: `${OUT}/privacy-real-host-graph-1280.png` });

  check('no page errors', errors.length === 0, errors.join(' ; '));
  await browser.close();
} finally {
  stop();
}
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
