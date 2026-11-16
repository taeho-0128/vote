// D-41 against the fake server: every screen sends one ping per 4 minutes of page time and never more, the answer
// changes nothing on screen, and a reconnect does not start a second timer. Page time is Playwright's clock, so the
// walk takes seconds. Run from the project root: npx tsx e2e/keepalive-walk.mjs
import { chromium } from 'playwright-core';
import { createFakeRoom } from './fake-server.mjs';
import { EDGE, ORIGIN, byId, check, failures, settle, startViteNode, stopVite, watchPage } from './kit.mjs';

const PHONE = { width: 390, height: 844 };
const FOUR_MINUTES = 4 * 60_000;
// Paused from before the page loads, so page time moves only when the walk says so and every interval starts at the same instant.
const START = new Date('2026-11-17T09:00:00Z');

async function open(browser, room, { url, ready, init }) {
  const ctx = await browser.newContext({ viewport: PHONE, locale: 'ko-KR' });
  if (init) await ctx.addInitScript(init.script, init.arg);
  await ctx.clock.install({ time: START });
  await ctx.clock.pauseAt(new Date(START.getTime() + 1000));
  const page = await ctx.newPage();
  const problems = [];
  watchPage(page, problems);
  await room.install(page);
  await page.goto(url);
  await ready(page);
  return { ctx, page, problems };
}

const pingsFrom = (room, role) => room.pings.filter((r) => r === role).length;
const pageText = (page) => page.evaluate(() => document.body.innerText);

async function waitFor(predicate, label) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  check(label, false, 'timed out');
  return false;
}

async function run(browser) {
  const room = createFakeRoom();
  const screens = {
    host: await open(browser, room, {
      url: `${ORIGIN}/host/${room.code}`,
      init: { script: ([key, token]) => localStorage.setItem(key, token), arg: [`hanpyo:host:${room.code}`, room.hostToken] },
      ready: (page) => byId(page, 'roster').waitFor(),
    }),
    participant: await open(browser, room, {
      url: `${ORIGIN}/r/${room.code}?nick=${encodeURIComponent('핑퐁')}`,
      ready: (page) => page.locator('.pill', { hasText: '· 핑퐁' }).waitFor(),
    }),
    display: await open(browser, room, {
      url: `${ORIGIN}/d/${room.code}/${room.displayToken}`,
      ready: (page) => byId(page, 'display-root').waitFor(),
    }),
  };

  for (const [role, { page }] of Object.entries(screens)) {
    await settle(page);
    check(`${role}: no ping has gone out right after connecting`, pingsFrom(room, role) === 0);
  }
  const opened = room.connections;
  const before = Object.fromEntries(await Promise.all(Object.entries(screens).map(async ([role, { page }]) => [role, await pageText(page)])));

  for (const { page } of Object.values(screens)) await page.clock.fastForward(FOUR_MINUTES - 1000);
  await new Promise((r) => setTimeout(r, 300));
  check('3 minutes 59 seconds in: still no ping from any screen', room.pings.length === 0, `${room.pings}`);

  for (const { page } of Object.values(screens)) await page.clock.fastForward(1500);
  await waitFor(() => room.pings.length >= 3, 'all three screens ping at 4 minutes');
  await new Promise((r) => setTimeout(r, 300));
  for (const role of Object.keys(screens)) check(`${role}: exactly one ping at 4 minutes`, pingsFrom(room, role) === 1, `${pingsFrom(room, role)}`);

  for (const [role, { page, problems }] of Object.entries(screens)) {
    check(`${role}: the pong changed nothing on screen`, (await pageText(page)) === before[role]);
    check(`${role}: no reconnect banner, no page error`, (await byId(page, 'connection-banner').count()) === 0 && problems.length === 0, problems.join(' | '));
  }
  check('a ping is not a command: the fake server saw none in its command log', room.commands('ping').length === 0);
  check('the sockets stayed up the whole time', room.connections === opened, `${room.connections} vs ${opened}`);

  for (const { page } of Object.values(screens)) await page.clock.fastForward(FOUR_MINUTES + 500);
  await waitFor(() => room.pings.length >= 6, 'a second round of pings');
  await new Promise((r) => setTimeout(r, 300));
  for (const role of Object.keys(screens)) check(`${role}: two pings after 8 minutes`, pingsFrom(room, role) === 2, `${pingsFrom(room, role)}`);

  const host = screens.host.page;
  const hostSocket = [...room.sockets].find((s) => s.role === 'host');
  hostSocket.ws.close();
  const connectionsBeforeDrop = room.connections;
  await waitFor(() => !room.sockets.has(hostSocket), 'the host socket closed');
  await host.clock.fastForward(1000);
  await waitFor(() => room.connections === connectionsBeforeDrop + 1 && [...room.sockets].some((s) => s.role === 'host'), 'the host reconnected');
  await settle(host);
  const base = pingsFrom(room, 'host');
  await host.clock.fastForward(FOUR_MINUTES - 1000);
  await new Promise((r) => setTimeout(r, 300));
  check('host after a reconnect: no ping before 4 minutes on the new socket', pingsFrom(room, 'host') === base);
  await host.clock.fastForward(1500);
  await waitFor(() => pingsFrom(room, 'host') > base, 'the host pings on the new socket');
  await new Promise((r) => setTimeout(r, 300));
  check('host after a reconnect: one ping per 4 minutes, not two timers', pingsFrom(room, 'host') === base + 1, `${pingsFrom(room, 'host')} vs ${base}`);

  for (const { ctx } of Object.values(screens)) await ctx.close();
}

const vite = await startViteNode();
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  await run(browser);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
