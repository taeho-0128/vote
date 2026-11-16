import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, PORT: '3000' }, stdio: 'ignore' });
const vite = spawn(process.execPath, [VITE], { stdio: 'ignore' });
const stop = () => { server.kill(); vite.kill(); };

try {
  for (let i = 0; i < 80; i++) {
    try {
      const a = await fetch('http://localhost:3000/healthz');
      const b = await fetch('http://localhost:5173/');
      if (a.ok && b.ok) break;
    } catch {}
    await sleep(250);
  }
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/');
  await page.getByTestId('home-create-room').click();
  const ok = await page.waitForURL(/\/host\/\d{4}$/, { timeout: 10000 }).then(() => true).catch(() => false);
  check('the dev setup (screen on 5173, server on 3000) can create a room through the proxy', ok);
  if (ok) {
    const code = (await page.getByTestId('room-code').innerText()).trim();
    const other = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await other.goto(`http://localhost:5173/r/${code}?nick=${encodeURIComponent('하늘')}`);
    const joined = await other.getByTestId('my-nickname').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check('a participant joins through the dev proxy too', joined);
  }
  check('no page errors', errors.length === 0, errors.join(' ; '));
  await browser.close();
} finally {
  stop();
}
console.log(results.every(Boolean) ? 'ALL PASSED' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
