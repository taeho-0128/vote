// Shared plumbing for the browser checks: dev server lifecycle, checks, screenshots and small page helpers.
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'e2e', 'out');
export const ORIGIN = 'http://localhost:5173';
export const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export const SIZES = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

export const failures = [];
export const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
  if (!ok) failures.push(name);
};

async function isUp() {
  try {
    return (await fetch(ORIGIN)).ok;
  } catch {
    return false;
  }
}

export async function startVite() {
  if (await isUp()) return null;
  const child = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (await isUp()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite did not start on 5173');
}

export const stopVite = (child) => {
  if (!child) return;
  try {
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    child.kill();
  }
};

export const byId = (page, id) => page.locator(`[data-testid="${id}"]`);

export async function settle(page) {
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]));
  await page.waitForTimeout(450);
}

export async function shot(page, name, width) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

export async function noHorizontalScroll(page, label) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(`${label}: no horizontal scroll`, scrollWidth <= innerWidth, `${scrollWidth} > ${innerWidth}`);
}

export const box = async (locator) => (await locator.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };


// Collects page errors, ignoring the Google Fonts requests that fail on an offline machine.
export function watchPage(page, problems) {
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_/.test(m.text())) problems.push(m.text());
  });
}

export async function joinAs(browser, size, room, nickname, problems, { blockStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR' });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
  }
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/r/${room.code}?nick=${encodeURIComponent(nickname)}`);
  await page.locator('.pill', { hasText: `· ${nickname}` }).waitFor();
  return { ctx, page };
}
