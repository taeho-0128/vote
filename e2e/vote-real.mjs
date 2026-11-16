import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const stop = () => server.kill();

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const phone = { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const errors = [];

  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostCtx.newPage();
  host.on('pageerror', (e) => errors.push(`host: ${e.message}`));
  await host.goto(BASE);
  await host.getByTestId('home-create-room').click();
  await host.waitForURL(/\/host\/\d{4}$/);
  const code = (await host.getByTestId('room-code').innerText()).trim();

  const join = async (nick) => {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${nick}: ${e.message}`));
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent(nick)}`);
    await page.getByTestId('my-nickname').waitFor();
    return { ctx, page };
  };
  const [a, b, c] = [await join('하늘'), await join('민준'), await join('서연')];
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="roster-item"]').length === 3);

  await host.getByTestId('open-composer').click();
  await host.getByTestId('vote-title').fill('이번 달 MVP는?');
  await host.getByTestId('paper-freeform').click();
  await host.getByTestId('anon-anonymous').click();
  await host.screenshot({ path: `${OUT}/vote-real-composer.png` });
  await host.getByTestId('start-vote').click();
  await host.getByTestId('submitted-count').waitFor();
  check('host sees 0 / 3 after starting', (await text(host.getByTestId('submitted-count'))) === '0 / 3', await text(host.getByTestId('submitted-count')));

  for (const p of [a, b, c]) await p.page.getByTestId('vote-title-view').waitFor();
  check('participants receive the vote title', (await text(a.page.getByTestId('vote-title-view'))).includes('이번 달 MVP는?'));
  const badge = await text(a.page.getByTestId('anon-badge'));
  check('anonymous badge is shown to participants', badge.includes('이름이 표시되지 않아요'), badge);

  await a.page.getByTestId('mode-type').click();
  await a.page.getByTestId('ballot-text').fill('서연이요! 발표 자료 같이 만들어 줘서 고마웠어요');
  await a.page.getByTestId('ballot-submit').click();
  await a.page.getByTestId('ballot-confirm').click();
  await a.page.getByTestId('ballot-submitted').waitFor();
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '1 / 3');
  const flags = await host.getByTestId('roster-item').evaluateAll((els) => els.map((e) => `${e.textContent.replace(/\s+/g, '').slice(0, 4)}:${e.getAttribute('data-submitted')}`));
  check('host roster flags exactly one submitted', flags.filter((f) => f.endsWith(':true')).length === 1, flags.join(' '));

  await a.page.reload();
  await a.page.getByTestId('ballot-submitted').waitFor();
  check('submitted state survives a participant reload', true);

  await b.page.getByTestId('mode-type').click();
  await b.page.getByTestId('ballot-text').fill('민준이가 맨날 청소를 먼저 해요');
  await b.page.getByTestId('ballot-submit').click();
  await b.page.getByTestId('ballot-confirm').click();
  await b.page.getByTestId('ballot-submitted').waitFor();
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '2 / 3');
  await host.screenshot({ path: `${OUT}/vote-real-host-voting.png` });

  await host.getByTestId('close-vote').click();
  await host.getByTestId('confirm-close').click();
  await host.getByTestId('closed-count').waitFor();
  check('host sees 2 ballots after closing with one still pending', (await text(host.getByTestId('closed-count'))) === '2', await text(host.getByTestId('closed-count')));
  await c.page.getByTestId('vote-closed-notice').waitFor();
  const closedText = await text(c.page.getByTestId('vote-closed-notice'));
  check('a participant who never submitted is told so', closedText.includes('참여하지 않았어요'), closedText);
  check('the ballot form is gone after closing', (await c.page.getByTestId('ballot-text').count()) === 0);

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
  await c.page.getByTestId('ballot-option-1').waitFor();
  const namedBadge = await text(c.page.getByTestId('anon-badge'));
  check('named badge shows the participant their own nickname', namedBadge.includes('서연') && namedBadge.includes('이름이 표시돼요'), namedBadge);
  check('previous vote ballot is not carried over (fresh form, nothing submitted)', (await c.page.getByTestId('ballot-submitted').count()) === 0);

  for (const [p, i] of [[a, 1], [b, 1], [c, 0]]) {
    await p.page.getByTestId(`ballot-option-${i}`).click();
    await p.page.getByTestId('ballot-submit').click();
    await p.page.getByTestId('ballot-confirm').click();
    await p.page.getByTestId('ballot-submitted').waitFor();
  }
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '3 / 3');
  check('host sees 3 / 3 for the second vote', true);
  await host.getByTestId('close-vote').click();
  if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
  await host.getByTestId('closed-count').waitFor();
  check('second vote closes with 3 ballots', (await text(host.getByTestId('closed-count'))) === '3');

  await host.reload();
  await host.getByTestId('closed-count').waitFor();
  check('host reload resumes into the closed stage', (await text(host.getByTestId('closed-count'))) === '3');

  for (const width of [390, 768, 1280, 1920]) {
    await host.setViewportSize({ width, height: 900 });
    await new Promise((r) => setTimeout(r, 200));
    const over = await host.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`closed operator screen has no horizontal overflow at ${width}px`, over <= 0, `overflow ${over}`);
  }

  check('no page errors', errors.length === 0, errors.join(' ; '));
  await browser.close();
} finally {
  stop();
}
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
