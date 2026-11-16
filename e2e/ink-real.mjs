import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3102;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(PORT) }, shell: true, stdio: 'ignore' });
const stop = () => { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' }); };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
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
    const page = await ctx.newPage();
    const sent = [];
    page.on('websocket', (ws) => ws.on('framesent', (f) => { try { sent.push(JSON.parse(f.payload)); } catch {} }));
    page.on('pageerror', (e) => errors.push(`${nick}: ${e.message}`));
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent(nick)}`);
    await page.getByTestId('my-nickname').waitFor();
    return { page, sent };
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

  const draw = async (page, pts) => {
    const canvas = page.getByTestId('ink-canvas');
    const box = await canvas.boundingBox();
    const abs = pts.map(([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height]);
    await page.mouse.move(abs[0][0], abs[0][1]);
    await page.mouse.down();
    for (const [x, y] of abs.slice(1)) await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.up();
    return box;
  };

  await a.page.getByTestId('ink-canvas').waitFor();
  check('writing mode is the default on a free-form paper', (await a.page.getByTestId('mode-write').count()) === 1 && (await a.page.getByTestId('ballot-text').count()) === 0);
  const box = await draw(a.page, [[0.2, 0.2], [0.5, 0.25], [0.8, 0.2]]);
  await draw(a.page, [[0.25, 0.5], [0.5, 0.6], [0.75, 0.5]]);
  await a.page.screenshot({ path: `${OUT}/ink-real-paper-390.png` });
  check('the submit button is enabled once something is written', await a.page.getByTestId('ballot-submit').isEnabled());

  await a.page.getByTestId('ballot-submit').click();
  await a.page.getByTestId('ballot-confirm').click();
  await a.page.getByTestId('ballot-submitted').waitFor();
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '1 / 2');
  check('the server accepted the handwritten ballot (host count 1 / 2)', true);

  const inkMsg = a.sent.find((m) => m.t === 'submitBallot');
  const strokes = inkMsg?.content?.strokes ?? [];
  check('the ballot sent was an ink ballot with two strokes', inkMsg?.content?.kind === 'ink' && strokes.length === 2, `kind=${inkMsg?.content?.kind} strokes=${strokes.length}`);
  const first = strokes[0]?.pts ?? [];
  const expectX = Math.round(0.2 * 1000);
  const expectY = Math.round(0.2 * 1333);
  check('the first stroke starts where the pen went down, in logical coordinates', Math.abs(first[0] - expectX) <= 12 && Math.abs(first[1] - expectY) <= 12, `got ${first[0]},${first[1]} expected about ${expectX},${expectY}`);
  const lastX = first[first.length - 2];
  check('the first stroke ends where the pen came up', Math.abs(lastX - 800) <= 12, `got x=${lastX} expected about 800`);
  check('all coordinates are integers inside the logical paper', strokes.every((s) => s.pts.every((v, i) => Number.isInteger(v) && v >= 0 && v <= (i % 2 === 0 ? 1000 : 1333))));
  check('the message stays far below the server limit', JSON.stringify(inkMsg).length < 20000, `${JSON.stringify(inkMsg).length} bytes`);

  await a.page.reload();
  await a.page.getByTestId('ballot-submitted').waitFor();
  check('submitted state survives a reload', true);

  await b.page.getByTestId('ink-canvas').waitFor();
  await draw(b.page, [[0.3, 0.3], [0.6, 0.4]]);
  await b.page.getByTestId('mode-type').click();
  await b.page.getByTestId('ballot-text').fill('민준이가 맨날 청소를 먼저 해요');
  await b.page.getByTestId('mode-write').click();
  await b.page.getByTestId('mode-type').click();
  check('switching modes keeps the typed draft', (await b.page.getByTestId('ballot-text').inputValue()) === '민준이가 맨날 청소를 먼저 해요');
  await b.page.getByTestId('ballot-submit').click();
  await b.page.getByTestId('ballot-confirm').click();
  await b.page.getByTestId('ballot-submitted').waitFor();
  await host.waitForFunction(() => document.querySelector('[data-testid="submitted-count"]')?.textContent?.trim() === '2 / 2');
  const textMsg = b.sent.find((m) => m.t === 'submitBallot');
  check('only the selected mode was submitted (text, even though strokes were drawn)', textMsg?.content?.kind === 'text' && textMsg.content.text === '민준이가 맨날 청소를 먼저 해요', JSON.stringify(textMsg?.content).slice(0, 80));

  await host.getByTestId('close-vote').click();
  if (await host.getByTestId('confirm-close').count()) await host.getByTestId('confirm-close').click();
  await host.getByTestId('closed-count').waitFor();
  check('closing counts both ballots', (await text(host.getByTestId('closed-count'))) === '2');
  check('no page errors', errors.length === 0, errors.join(' ; '));
  await browser.close();
} finally {
  stop();
}
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
