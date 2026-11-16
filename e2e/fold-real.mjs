import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3103;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const stop = () => server.kill();

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const join = async (nick) => {
    const ctx = await browser.newContext(phone);
    await ctx.addInitScript(() => {
      window.__vibes = [];
      navigator.vibrate = (p) => { window.__vibes.push({ p, t: performance.now() }); return true; };
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${nick}: ${e.message}`));
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent(nick)}`);
    await page.getByTestId('my-nickname').waitFor();
    return page;
  };
  const a = await join('하늘');
  const b = await join('민준');
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="roster-item"]').length === 2);

  await host.getByTestId('open-composer').click();
  await host.getByTestId('vote-title').fill('이번 달 MVP는?');
  await host.getByTestId('paper-freeform').click();
  await host.getByTestId('anon-anonymous').click();
  await host.getByTestId('start-vote').click();
  await host.getByTestId('submitted-count').waitFor();

  await a.getByTestId('ink-canvas').waitFor();
  const canvas = a.getByTestId('ink-canvas');
  const box = await canvas.boundingBox();
  const stroke = async (pts) => {
    const abs = pts.map(([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height]);
    await a.mouse.move(abs[0][0], abs[0][1]);
    await a.mouse.down();
    for (const [x, y] of abs.slice(1)) await a.mouse.move(x, y, { steps: 8 });
    await a.mouse.up();
  };
  await stroke([[0.15, 0.2], [0.5, 0.3], [0.85, 0.2]]);
  await stroke([[0.2, 0.5], [0.5, 0.65], [0.8, 0.5]]);

  const phases = [];
  await a.exposeFunction('__phase', (p) => { if (phases[phases.length - 1] !== p) phases.push(p); });
  await a.evaluate(() => {
    const read = () => document.querySelector('[data-testid="fold-stage"]')?.getAttribute('data-phase');
    setInterval(() => { const p = read(); if (p) window.__phase(p); }, 30);
  });

  await a.getByTestId('ballot-submit').click();
  await a.getByTestId('ballot-confirm').click();
  const t0 = Date.now();
  const frames = [250, 800, 1400, 1900, 2700, 3300, 4300];
  for (let i = 0; i < frames.length; i++) {
    const wait = frames[i] - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await a.screenshot({ path: `${OUT}/fold-real-390-${i + 1}.png` });
  }
  await a.getByTestId('ballot-submitted').waitFor();
  check('phases ran in order against the real server', JSON.stringify(phases.filter((p) => p !== 'writing')) === JSON.stringify(['sending', 'folding', 'done']) || JSON.stringify(phases.filter((p) => p !== 'writing')) === JSON.stringify(['folding', 'done']), phases.join(' > '));
  const vibes = await a.evaluate(() => window.__vibes);
  check('the phone vibrated exactly once, for 30 ms', vibes.length === 1 && vibes[0].p === 30, JSON.stringify(vibes.map((v) => v.p)));
  check('the box count is 1 after the first ballot', (await a.getByTestId('box-count').innerText()).trim() === '1');
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '1 / 2');
  check('the host saw the ballot arrive (1 / 2)', true);

  await b.getByTestId('box-count').waitFor({ timeout: 2000 }).catch(() => {});
  const bCountBefore = await b.getByTestId('ballot-box').count();
  check('a waiting participant has no box yet, only their own paper', bCountBefore === 0 || (await b.getByTestId('fold-stage').getAttribute('data-phase')) === 'writing');

  await b.getByTestId('mode-type').click();
  await b.getByTestId('ballot-text').fill('민준이가 맨날 청소를 먼저 해요');
  await b.getByTestId('ballot-submit').click();
  await b.getByTestId('ballot-confirm').click();
  await b.getByTestId('ballot-submitted').waitFor({ timeout: 8000 });
  check('the second ballot lands and the box counts 2', (await b.getByTestId('box-count').innerText()).trim() === '2');
  await sleep(300);
  check('the first participant, still waiting at their box, sees 2 as well', (await a.getByTestId('box-count').innerText()).trim() === '2');

  await a.reload();
  await a.getByTestId('ballot-submitted').waitFor();
  check('after a reload the stage is static, no animation', (await a.getByTestId('fold-stage').getAttribute('data-phase')) === 'static');
  await a.screenshot({ path: `${OUT}/fold-real-390-static.png` });

  check('no page errors', errors.length === 0, errors.join(' ; '));
  await browser.close();
} finally {
  stop();
}
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
