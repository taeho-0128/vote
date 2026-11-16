import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(PORT) }, shell: true, stdio: 'ignore' });
const stop = () => { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' }); };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const phone = { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(BASE);
  await host.getByTestId('home-create-room').click();
  await host.waitForURL(/\/host\/\d{4}$/);
  const code = (await host.getByTestId('room-code').innerText()).trim();
  check('host created a 4-digit room', /^\d{4}$/.test(code), code);
  check('url matches code', host.url().endsWith(`/host/${code}`));

  const join = async (nick, viaHome) => {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${nick}: ${e.message}`));
    if (viaHome) {
      await page.goto(BASE);
      for (let i = 0; i < 4; i++) await page.getByTestId(`home-code-${i}`).fill(code[i]);
      await page.getByTestId('home-nickname').fill(nick);
      await page.getByTestId('home-join').click();
    } else {
      await page.goto(`${BASE}/r/${code}`);
      await page.getByTestId('nickname-input').fill(nick);
      await page.getByTestId('nickname-submit').click();
    }
    await page.getByTestId('my-nickname').waitFor();
    return { ctx, page };
  };

  const a = await join('하늘', false);
  const b = await join('민준', true);
  const c = await join('서연', false);
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="roster-item"]').length === 3);
  const names = await host.getByTestId('roster-item').allInnerTexts();
  check('host roster lists all three joiners live', ['하늘', '민준', '서연'].every((n) => names.some((t) => t.includes(n))), names.join(' | ').replace(/\n/g, ' '));
  await host.screenshot({ path: `${OUT}/real-host-1280.png` });
  await a.page.screenshot({ path: `${OUT}/real-participant-390.png` });

  const bRoster = await b.page.getByTestId('roster-item').count();
  check('a participant sees everyone, including people who joined after', bRoster === 3, String(bRoster));

  const dup = await browser.newContext(phone);
  const dupPage = await dup.newPage();
  await dupPage.goto(`${BASE}/r/${code}`);
  await dupPage.getByTestId('nickname-input').fill('하늘');
  await dupPage.getByTestId('nickname-submit').click();
  await dupPage.getByTestId('join-error').waitFor();
  check('duplicate nickname is refused with a message', true, (await dupPage.getByTestId('join-error').innerText()).trim());
  await dup.close();

  await c.ctx.close();
  await host.getByTestId('roster-item').filter({ hasText: '연결 끊김' }).waitFor({ timeout: 5000 });
  check('closed participant shows as disconnected on host', true);

  await a.page.reload();
  await a.page.getByTestId('my-nickname').waitFor();
  await new Promise((r) => setTimeout(r, 500));
  check('participant reload resumes the same seat', (await host.getByTestId('roster-item').count()) === 3);

  await host.reload();
  await host.getByTestId('room-code').waitFor();
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="roster-item"]').length === 3);
  check('host reload resumes the same room', (await host.getByTestId('room-code').innerText()).trim() === code);

  for (const width of [390, 768, 1280, 1920]) {
    await host.setViewportSize({ width, height: 900 });
    await new Promise((r) => setTimeout(r, 200));
    const over = await host.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`operator screen has no horizontal overflow at ${width}px`, over <= 0, `overflow ${over}`);
    await host.screenshot({ path: `${OUT}/real-host-${width}.png` });
  }

  const noHost = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const stranger = await noHost.newPage();
  await stranger.goto(`${BASE}/host/${code}`);
  await stranger.getByTestId('host-error').waitFor();
  check('someone without the host token cannot take over the room', true);

  check('no page errors', errors.length === 0, errors.join(' ; '));
  await browser.close();
} finally {
  stop();
}
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
