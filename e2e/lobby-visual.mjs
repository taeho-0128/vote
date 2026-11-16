// Visual and behavior check of the lobby screens against a faked WebSocket server.
// Run from the project root: node e2e/lobby-visual.mjs
import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out');
const ORIGIN = 'http://localhost:5173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SIZES = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

const failures = [];
const check = (name, ok, detail = '') => {
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

async function startVite() {
  if (await isUp()) return null;
  const child = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (await isUp()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite did not start on 5173');
}

const stopVite = (child) => {
  if (!child) return;
  try {
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    child.kill();
  }
};

const NAMES = ['민준', '서연', '지후', '도윤', '예은', '시우', '하린', '주원', '채원', '지안', '이안', '유나'];
const MANY = ['가온', '은우', '세아', '윤호', '지민', '재이', '아린', '단우', '해든', '나래', '보람', '시현', '예준', '라온', '한결', '새봄', '도하', '이레', '우진', '설아', '찬영', '미르', '다인', '건우', '수아', '로운', '태오', '다온', '나은', '현우', '소율', '준서', '유빈', '하준', '서윤', '지율', '이든', '다솔', '별이'];
const pad = (s) => s.padEnd(24, 'x');

function createFakeRoom() {
  let seq = 0;
  const person = (nickname, connected = true) => {
    seq += 1;
    return { id: `p${seq}`, token: pad(`tok-p${seq}-`), nickname, connected };
  };
  const room = {
    code: '4827',
    hostToken: pad('host-token-'),
    participants: [...NAMES.map((n) => person(n)), person('소율', false), person('가나다라마바사아')],
    sockets: new Set(),
    connections: 0,
    hostResumes: 0,
    refuse: false,
  };
  const summaries = () => room.participants.map(({ id, nickname, connected }) => ({ id, nickname, connected }));
  const send = (sock, msg) => sock.ws.send(JSON.stringify(msg));
  const viewFor = (sock) => {
    if (sock.role === 'host') return { role: 'host', code: room.code, stage: { kind: 'lobby' }, participants: summaries() };
    const me = room.participants.find((p) => p.id === sock.id);
    return { role: 'participant', code: room.code, stage: { kind: 'lobby' }, me: { id: me.id, nickname: me.nickname }, participants: summaries() };
  };
  room.broadcast = () => {
    for (const sock of room.sockets) if (sock.role) send(sock, { t: 'view', view: viewFor(sock) });
  };
  room.add = (nickname, connected = true) => {
    room.participants.push(person(nickname, connected));
    room.broadcast();
  };
  room.fill = (count) => {
    for (const n of MANY) if (room.participants.length < count) room.participants.push(person(n, Math.random() > 0.1));
    room.broadcast();
  };
  room.dropAll = () => {
    room.refuse = true;
    for (const sock of [...room.sockets]) sock.ws.close();
  };
  room.replace = (nickname) => {
    const me = room.participants.find((p) => p.nickname === nickname);
    for (const sock of room.sockets) {
      if (sock.id !== me.id) continue;
      send(sock, { t: 'error', reason: 'replaced', message: 'replaced' });
      sock.ws.close();
    }
  };

  room.install = (page) =>
    page.routeWebSocket('**/ws', (ws) => {
      const sock = { ws, role: null, id: null };
      if (room.refuse) {
        ws.close();
        return;
      }
      room.sockets.add(sock);
      room.connections += 1;
      const fail = (reason) => send(sock, { t: 'error', reason, message: reason });
      ws.onClose(() => {
        room.sockets.delete(sock);
        const me = room.participants.find((p) => p.id === sock.id);
        if (me) {
          me.connected = false;
          room.broadcast();
        }
      });
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.t === 'createRoom') {
          sock.role = 'host';
          send(sock, { t: 'hosted', hostToken: room.hostToken, view: viewFor(sock) });
        } else if (msg.t === 'resumeHost') {
          if (msg.code !== room.code) return fail('room_not_found');
          if (msg.hostToken !== room.hostToken) return fail('bad_host_token');
          room.hostResumes += 1;
          sock.role = 'host';
          send(sock, { t: 'view', view: viewFor(sock) });
        } else if (msg.t === 'join') {
          if (msg.code !== room.code) return fail('room_not_found');
          let me = msg.participantToken ? room.participants.find((p) => p.token === msg.participantToken) : undefined;
          if (msg.participantToken && !me) return fail('bad_participant_token');
          if (!me) {
            if (room.participants.some((p) => p.nickname === msg.nickname)) return fail('nickname_taken');
            me = person(msg.nickname);
            room.participants.push(me);
          }
          me.connected = true;
          sock.role = 'participant';
          sock.id = me.id;
          send(sock, { t: 'joined', participantToken: me.token, view: viewFor(sock) });
          room.broadcast();
        }
      });
    });

  return room;
}

const byId = (page, id) => page.locator(`[data-testid="${id}"]`);

async function settle(page) {
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]));
  await page.waitForTimeout(450);
}

async function shot(page, name, width) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

async function noHorizontalScroll(page, label) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(`${label}: no horizontal scroll`, scrollWidth <= innerWidth, `${scrollWidth} > ${innerWidth}`);
}

const box = async (locator) => (await locator.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };

async function checkBreakpoints(page, restore) {
  const probe = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
      const visible = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
      const main = rect('.host-main');
      return {
        mainWidth: Math.round(main.width),
        twoColumns: rect('[data-testid="roster"]').top < rect('.join-card').bottom,
        bottomBar: visible('.bar-bottom'),
        topActions: visible('.bar-actions'),
      };
    });
  };
  const phone = await probe(719);
  check('breakpoint 719: one full-width column with bottom bar', !phone.twoColumns && phone.bottomBar && !phone.topActions && phone.mainWidth === 719, JSON.stringify(phone));
  const tabletLow = await probe(720);
  check('breakpoint 720: centered 640 column with bottom bar', !tabletLow.twoColumns && tabletLow.bottomBar && tabletLow.mainWidth === 640, JSON.stringify(tabletLow));
  const tabletHigh = await probe(1023);
  check('breakpoint 1023: centered 640 column with bottom bar', !tabletHigh.twoColumns && tabletHigh.bottomBar && tabletHigh.mainWidth === 640, JSON.stringify(tabletHigh));
  const laptop = await probe(1024);
  check('breakpoint 1024: two columns with top actions', laptop.twoColumns && !laptop.bottomBar && laptop.topActions, JSON.stringify(laptop));
  await page.setViewportSize(restore);
}

async function runWidth(browser, size) {
  const { width } = size;
  const tag = `@${width}`;
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR' });
  const room = createFakeRoom();
  const problems = [];
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_/.test(m.text())) problems.push(m.text());
    });
  };

  const hostPage = await ctx.newPage();
  watch(hostPage);
  await room.install(hostPage);
  await hostPage.goto(ORIGIN + '/');
  await byId(hostPage, 'home-code-0').waitFor();
  await shot(hostPage, 'home', width);
  await noHorizontalScroll(hostPage, `home ${tag}`);
  await byId(hostPage, 'home-create-room').click();
  await hostPage.waitForURL('**/host/4827');
  await byId(hostPage, 'roster-item').first().waitFor();
  check(`host ${tag}: room-code text is the digits`, (await byId(hostPage, 'room-code').textContent()) === '4827');
  check(`host ${tag}: room-code innerText stays one line`, (await byId(hostPage, 'room-code').innerText()) === '4827');
  check(`host ${tag}: join-url`, (await byId(hostPage, 'join-url').textContent()) === `${ORIGIN}/r/4827`);
  check(`host ${tag}: qr visible`, await byId(hostPage, 'qr').isVisible());
  const count = async (page) => Number(await byId(page, 'roster-count').textContent());
  check(`host ${tag}: roster count matches items`, (await count(hostPage)) === (await byId(hostPage, 'roster-item').count()));

  room.add('새봄');
  await hostPage.waitForFunction(() => document.querySelector('[data-testid="roster-count"]')?.textContent === '15');
  check(`host ${tag}: live roster update`, (await count(hostPage)) === 15);

  const card = await box(hostPage.locator('.join-card'));
  const roster = await box(byId(hostPage, 'roster'));
  const qr = await box(byId(hostPage, 'qr'));
  const twoColumns = Math.abs(card.y - roster.y) < 4 && roster.x > card.x + card.width - 4;
  check(`host ${tag}: ${width >= 1024 ? 'two columns' : 'one column'}`, twoColumns === width >= 1024, JSON.stringify({ card, roster }));
  if (width >= 1024) check(`host ${tag}: QR about 240px`, Math.abs(qr.width - 240) < 2, String(qr.width));
  const topActions = await hostPage.locator('.bar-actions .btn').first().isVisible();
  const bottomActions = await hostPage.locator('.bar-bottom .btn').first().isVisible();
  check(`host ${tag}: actions in ${width >= 1024 ? 'top bar' : 'bottom bar'}`, topActions === width >= 1024 && bottomActions === width < 1024);
  const disabled = await hostPage.locator('button:disabled:visible').count();
  check(`host ${tag}: both actions disabled`, disabled === 2, String(disabled));
  await shot(hostPage, 'host-lobby', width);
  await settle(hostPage);
  await hostPage.screenshot({ path: path.join(OUT, `host-lobby-viewport-${width}.png`) });
  await noHorizontalScroll(hostPage, `host ${tag}`);
  if (width === 1280) await checkBreakpoints(hostPage, size);

  const partPage = await ctx.newPage();
  watch(partPage);
  await room.install(partPage);
  await partPage.goto(ORIGIN + '/');
  await byId(partPage, 'home-code-0').click();
  await partPage.keyboard.type('4827');
  const typed = await Promise.all([0, 1, 2, 3].map((i) => byId(partPage, `home-code-${i}`).inputValue()));
  check(`home ${tag}: typing auto-advances`, typed.join('') === '4827', typed.join(','));
  await partPage.keyboard.press('Backspace');
  await partPage.keyboard.press('Backspace');
  const afterBackspace = await Promise.all([0, 1, 2, 3].map((i) => byId(partPage, `home-code-${i}`).inputValue()));
  check(`home ${tag}: backspace clears and steps back`, afterBackspace.join(',') === '4,8,,', afterBackspace.join(','));
  await partPage.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text', '4 8-2 7');
    document.querySelector('[data-testid="home-code-0"]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const pasted = await Promise.all([0, 1, 2, 3].map((i) => byId(partPage, `home-code-${i}`).inputValue()));
  check(`home ${tag}: paste of 4 digits`, pasted.join('') === '4827', pasted.join(','));
  await byId(partPage, 'home-nickname').fill('하늘');
  await shot(partPage, 'home-filled', width);
  await byId(partPage, 'home-join').click();
  await partPage.waitForURL('**/r/4827?nick=*');
  await byId(partPage, 'roster-item').first().waitFor();
  const mine = partPage.locator('[data-testid="roster-item"][aria-current="true"]');
  check(`participant ${tag}: my own roster entry`, (await mine.textContent())?.includes('하늘') === true);
  check(`participant ${tag}: disconnected entry labelled`, (await partPage.locator('[data-testid="roster-item"].off').first().textContent())?.includes('연결 끊김') === true);
  check(`participant ${tag}: waiting line`, (await partPage.textContent('body'))?.includes('운영자가 투표를 만드는 중이에요.') === true);
  await shot(partPage, 'participant-lobby', width);
  await noHorizontalScroll(partPage, `participant ${tag}`);

  const joinsBefore = room.participants.length;
  await partPage.reload();
  await byId(partPage, 'roster-item').first().waitFor();
  check(`participant ${tag}: reload resumes the same seat`, room.participants.length === joinsBefore);

  room.fill(45);
  await hostPage.waitForFunction(() => document.querySelector('[data-testid="roster-count"]')?.textContent === '45');
  await shot(hostPage, 'host-many', width);
  await noHorizontalScroll(hostPage, `host many ${tag}`);

  const resumesBefore = room.hostResumes;
  room.dropAll();
  await byId(hostPage, 'connection-banner').waitFor({ timeout: 3000 });
  await hostPage.waitForTimeout(150);
  await shot(hostPage, 'host-reconnecting', width);
  await byId(partPage, 'connection-banner').waitFor({ timeout: 3000 });
  room.refuse = false;
  await byId(hostPage, 'connection-banner').waitFor({ state: 'detached', timeout: 12000 });
  check(`host ${tag}: banner gone after reconnect`, true);
  check(`host ${tag}: resumeHost re-sent on reconnect`, room.hostResumes > resumesBefore);
  await byId(partPage, 'connection-banner').waitFor({ state: 'detached', timeout: 12000 });
  check(`participant ${tag}: rejoined with token after reconnect`, (await byId(partPage, 'roster-item').count()) > 0);

  const connectionsBefore = room.connections;
  room.replace('하늘');
  await byId(partPage, 'join-error').waitFor();
  check(`participant ${tag}: replaced message`, (await byId(partPage, 'join-error').textContent())?.includes('다른 화면에서 같은 닉네임으로 입장했어요.') === true);
  await partPage.waitForTimeout(1500);
  check(`participant ${tag}: no reconnect after replaced`, room.connections === connectionsBefore && (await byId(partPage, 'connection-banner').count()) === 0);
  await shot(partPage, 'participant-replaced', width);
  await ctx.close();

  // Error screens in a fresh storage
  const errCtx = await browser.newContext({ viewport: size, locale: 'ko-KR' });
  const taken = await errCtx.newPage();
  watch(taken);
  await room.install(taken);
  await taken.goto(`${ORIGIN}/r/4827?nick=${encodeURIComponent('민준')}`);
  await byId(taken, 'join-error').waitFor();
  check(`participant ${tag}: nickname taken shows the form`, (await byId(taken, 'nickname-input').inputValue()) === '민준' && (await byId(taken, 'join-error').textContent())?.includes('이미 쓰고 있는') === true);
  await shot(taken, 'participant-nickname-taken', width);
  await byId(taken, 'nickname-input').fill('');
  await byId(taken, 'nickname-submit').click();
  check(`participant ${tag}: empty nickname invalid`, (await byId(taken, 'join-error').textContent())?.includes('1~8자') === true);
  await byId(taken, 'nickname-input').fill('보리');
  await byId(taken, 'nickname-submit').click();
  await byId(taken, 'roster-item').first().waitFor();
  check(`participant ${tag}: form join reaches lobby`, (await taken.textContent('body'))?.includes('입장했어요') === true);

  const gone = await errCtx.newPage();
  watch(gone);
  await room.install(gone);
  await gone.goto(`${ORIGIN}/r/9999?nick=${encodeURIComponent('하늘')}`);
  await byId(gone, 'join-error').waitFor();
  check(`participant ${tag}: room not found links home`, (await gone.locator('[data-testid="join-error"] a[href="/"]').count()) === 1);
  await shot(gone, 'participant-room-missing', width);

  const noToken = await errCtx.newPage();
  watch(noToken);
  await room.install(noToken);
  await noToken.goto(`${ORIGIN}/host/4827`);
  await byId(noToken, 'host-error').waitFor();
  check(`host ${tag}: no token shows host-error with home link`, (await noToken.locator('[data-testid="host-error"] a[href="/"]').count()) === 1);
  await shot(noToken, 'host-no-token', width);
  await errCtx.close();

  check(`page errors ${tag}`, problems.length === 0, problems.join(' | '));
}

mkdirSync(OUT, { recursive: true });
const vite = await startVite();
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const size of SIZES) await runWidth(browser, size);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
