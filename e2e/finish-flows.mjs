// The step 6 flows that are not export: the idle-room banner and keepAlive, room_expired and rate_limited on every
// screen, the step 5 review fixes, and fullscreen on the operator results and the display.
import path from 'node:path';
import { DISPLAY_SIZES, contactSheet, downloadOf, startAndClose } from './finish-kit.mjs';
import { OPTIONS, closeVote, composeVote, newRoom, openDisplay, openHost, textOf, wholePage } from './results-kit.mjs';
import { ORIGIN, OUT, byId, check, joinAs, settle, watchPage } from './kit.mjs';

const HOST = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function openPage(browser, room, url, size, problems) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR' });
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}${url}`);
  return { ctx, page };
}

async function openStoredHost(browser, room, problems) {
  const ctx = await browser.newContext({ viewport: HOST, locale: 'ko-KR' });
  await ctx.addInitScript(([key, token]) => localStorage.setItem(key, token), [`hanpyo:host:${room.code}`, room.hostToken]);
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/host/${room.code}`);
  return { ctx, page };
}

export async function runExpiry(browser) {
  const problems = [];
  const room = newRoom();
  const host = await openHost(browser, room, HOST, { problems });
  const H = host.page;
  await H.evaluate(() => {
    window.print = () => undefined;
  });
  const banner = byId(H, 'expiry-banner');

  check('expiry: a fresh room with six hours left shows no banner', (await banner.count()) === 0);
  room.setExpiresIn(31 * 60_000);
  await H.waitForTimeout(300);
  check('expiry: 31 minutes left is still no banner', (await banner.count()) === 0);
  room.setExpiresIn(29 * 60_000 + 30_000);
  await banner.waitFor();
  check('expiry: under 30 minutes a banner appears with role=status, not a toast', (await banner.getAttribute('role')) === 'status' && (await banner.isVisible()));
  check('expiry: it names the minutes left, rounded down', (await textOf(H, 'expiry-minutes')).trim() === '29분');
  check('expiry: in the lobby it does not talk about exports', !(await banner.textContent())?.includes('내보내지'));
  check('expiry: the 계속 사용 button is there and named', (await textOf(H, 'keep-alive')).trim() === '계속 사용');
  await H.screenshot({ path: path.join(OUT, 'finish-expiry-host-1280.png') });
  await H.waitForTimeout(2500);
  check('expiry: it stays put, a banner and not a toast', await banner.isVisible());

  room.setExpiresIn(61_500);
  await H.waitForFunction(() => document.querySelector('[data-testid="expiry-minutes"]')?.textContent === '1분');
  await H.waitForFunction(() => /^\d+초$/.test(document.querySelector('[data-testid="expiry-minutes"]')?.textContent ?? ''), null, { timeout: 5000 });
  const first = Number.parseInt(await textOf(H, 'expiry-minutes'), 10);
  await H.waitForTimeout(2200);
  const later = Number.parseInt(await textOf(H, 'expiry-minutes'), 10);
  check('expiry: the last minute counts in seconds and keeps counting down on its own', first <= 60 && later < first, `${first} -> ${later}`);

  room.setExpiresIn(30 * 60_000 + 2_500);
  await H.waitForTimeout(300);
  check('expiry: just over 30 minutes shows nothing yet', (await banner.count()) === 0);
  await banner.waitFor({ timeout: 6000 });
  check('expiry: the banner appears by itself when the local clock crosses 30 minutes, with no new view', (await textOf(H, 'expiry-minutes')).trim() === '29분');

  await byId(H, 'keep-alive').click();
  await banner.waitFor({ state: 'detached' });
  check('keepAlive: pressing 계속 사용 sends one keepAlive and the banner leaves with the new view', room.commands('keepAlive').length === 1 && room.expiresIn === 6 * 3600 * 1000);

  room.refuseNext = 'not_host';
  room.setExpiresIn(5 * 60_000);
  await banner.waitFor();
  await byId(H, 'keep-alive').click();
  await byId(H, 'command-error').waitFor();
  check('keepAlive: a refusal is shown and the banner stays with the button usable again', (await banner.isVisible()) && (await byId(H, 'keep-alive').isEnabled()));
  await byId(H, 'keep-alive').click();
  await banner.waitFor({ state: 'detached' });

  await startAndClose(H, room, { title: '만료 경고', kind: 'freeform', anonymity: 'anonymous', ballots: { 민준: { kind: 'text', text: '글' } } });
  room.setExpiresIn(10 * 60_000);
  await banner.waitFor();
  check('expiry: a closed vote that was never exported adds that to the banner', (await banner.textContent())?.includes('아직 내보내지 않은 투표가 있어요') === true);
  await H.screenshot({ path: path.join(OUT, 'finish-expiry-unexported-1280.png') });
  await downloadOf(H, () => byId(H, 'export-csv').click());
  await H.waitForFunction(() => !document.querySelector('[data-testid="expiry-banner"]')?.textContent?.includes('내보내지'));
  check('expiry: once exported the banner stops mentioning it', (await banner.isVisible()) && !(await banner.textContent())?.includes('내보내지'));

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'open-composer').waitFor();
  await startAndClose(H, room, { title: '빈 투표', kind: 'freeform', anonymity: 'anonymous', ballots: {} });
  check('expiry: a closed vote with no papers does not nag about exporting', !(await banner.textContent())?.includes('내보내지'));

  await H.setViewportSize(PHONE);
  await settle(H);
  await H.screenshot({ path: path.join(OUT, 'finish-expiry-host-390.png') });
  check('expiry: the banner fits a 390px phone without sideways scroll', await H.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await H.setViewportSize({ width: 320, height: 640 });
  await settle(H);
  await H.screenshot({ path: path.join(OUT, 'finish-expiry-host-320.png') });
  check('expiry: and a 320px phone', await H.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check('expiry: the keep button is at least 44px tall', (await byId(H, 'keep-alive').boundingBox()).height >= 44);
  check('expiry: page errors', problems.length === 0, problems.join(' | '));
  await host.ctx.close();
}

export async function runErrors(browser) {
  const problems = [];

  const expiredCase = async (name, open, { stored, frames }) => {
    const room = newRoom();
    const { ctx, page } = await open(room);
    const before = room.connections;
    room.expire();
    await byId(page, 'room-expired').waitFor();
    await page.waitForTimeout(3200);
    const text = await textOf(page, 'room-expired');
    check(`${name}: room_expired shows the calm "방이 닫혔어요" with the reason and a way home`, text.includes('방이 닫혔어요') && text.includes('6시간') && (await page.locator('[data-testid="room-expired"] a[href="/"]').count()) === 1, text);
    check(`${name}: it never reconnects`, room.connections === before && room.sockets.size === 0, `${before} -> ${room.connections}`);
    check(`${name}: the last view is gone from the page`, (await byId(page, 'roster').count()) === 0 && (await byId(page, 'my-nickname').count()) === 0 && (await byId(page, 'display-lobby').count()) === 0);
    if (stored) check(`${name}: the stored token for the dead room is cleared`, (await page.evaluate((key) => localStorage.getItem(key), stored(room))) === null);
    for (const frame of frames) {
      await page.setViewportSize(frame);
      await settle(page);
      await page.screenshot({ path: path.join(OUT, `finish-expired-${name}-${frame.width}x${frame.height}.png`) });
      check(`${name} @${frame.width}x${frame.height}: no horizontal scroll on the closed-room screen`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
    await page.locator('[data-testid="room-expired"] a[href="/"]').click();
    await page.locator('[data-testid="home-join"]').waitFor();
    check(`${name}: the link goes home`, new URL(page.url()).pathname === '/');
    await ctx.close();
  };

  await expiredCase('host', (room) => openHost(browser, room, HOST, { problems }), {
    stored: (room) => `hanpyo:host:${room.code}`,
    frames: [HOST, PHONE, { width: 320, height: 640 }],
  });
  await expiredCase('participant', (room) => joinAs(browser, PHONE, room, '현지', problems), {
    stored: (room) => `hanpyo:participant:${room.code}`,
    frames: [PHONE, HOST],
  });
  await expiredCase('display', (room) => openDisplay(browser, room, { width: 1920, height: 1080 }, { problems }), {
    frames: [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, PHONE, { width: 844, height: 390 }],
  });

  const limitCase = async (name, open, { message, seconds, retryable, proof }) => {
    const room = newRoom();
    room.limit(message);
    const { ctx, page } = await open(room);
    await byId(page, 'rate-limit-message').waitFor();
    check(`${name}: rate_limited shows a plain message that says to wait`, (await textOf(page, 'rate-limit-message')).includes('기다려') && (await byId(page, 'rate-limit-retry').isDisabled()));
    const label = (await textOf(page, 'rate-limit-retry')).trim();
    check(`${name}: the wait is ${seconds} seconds`, label.startsWith(`${seconds}초`) || label.startsWith(`${seconds - 1}초`), label);
    await page.waitForTimeout(2600);
    check(`${name}: no retry loop, the server was asked exactly once`, room.helloAttempts === 1, String(room.helloAttempts));
    await page.screenshot({ path: path.join(OUT, `finish-ratelimit-${name}.png`) });
    if (retryable) {
      await page.waitForFunction(() => !document.querySelector('[data-testid="rate-limit-retry"]')?.disabled, null, { timeout: 6000 });
      check(`${name}: after the wait the retry button is usable again`, await byId(page, 'rate-limit-retry').isEnabled());
      room.unlimit();
      await byId(page, 'rate-limit-retry').click();
      await proof(page);
      check(`${name}: the retry goes through once the limit is gone`, room.helloAttempts === 2, String(room.helloAttempts));
    } else {
      check(`${name}: the button is still waiting well before the time is up`, await byId(page, 'rate-limit-retry').isDisabled());
    }
    await ctx.close();
  };

  await limitCase('participant', (room) => openPage(browser, room, `/r/${room.code}?nick=%ED%98%84%EC%A7%80`, PHONE, problems), {
    message: '너무 많이 시도했어요. 4초 뒤에 다시 시도해 주세요.',
    seconds: 4,
    retryable: true,
    proof: (page) => page.locator('.pill', { hasText: '현지' }).waitFor(),
  });
  await limitCase('host', (room) => openStoredHost(browser, room, problems), {
    message: 'Too many attempts, retry in 4 seconds',
    seconds: 4,
    retryable: true,
    proof: (page) => byId(page, 'roster').waitFor(),
  });
  await limitCase('display', (room) => openPage(browser, room, `/d/${room.code}/${room.displayToken}`, { width: 1920, height: 1080 }, problems), {
    message: 'rate_limited',
    seconds: 60,
    retryable: false,
  });
  await limitCase('participant-default', (room) => openPage(browser, room, `/r/${room.code}?nick=%ED%98%84%EC%A7%80`, PHONE, problems), {
    message: 'rate_limited',
    seconds: 60,
    retryable: false,
  });
  check('errors: page errors', problems.length === 0, problems.join(' | '));
}

const TITLES = {
  spaced: '이번 모임에서 가장 좋았던 점심 메뉴를 정해 보는 투표에 참여해 주세요 감사합니다 여러분 모두 함께 해요',
  unbroken: '가나다라마바사아자차'.repeat(6),
};

// The characters of a text node by the line they land on, so a word cut across two lines can be told from a line that
// ends at a space.
const lineFacts = (page, id) =>
  page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    const node = el?.firstChild;
    if (!node) return null;
    const text = node.textContent;
    const range = document.createRange();
    const splits = [];
    const tops = new Set();
    let prev = null;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const top = Math.round(rect.top);
      tops.add(top);
      if (prev !== null && top !== prev && text[i] !== ' ' && text[i - 1] !== ' ') splits.push(i);
      prev = top;
    }
    const box = el.getBoundingClientRect();
    return { splits, lines: tops.size, left: box.left, right: box.right, top: box.top, bottom: box.bottom, wordBreak: getComputedStyle(el).wordBreak };
  }, id);

export async function runStep5(browser) {
  const problems = [];
  const room = newRoom();
  const host = await openHost(browser, room, HOST, { problems });
  const H = host.page;
  const disp = await openDisplay(browser, room, { width: 1920, height: 1080 }, { problems });
  const D = disp.page;
  const shots = { voting: [], closed: [] };

  const titleSweep = async (name, stage) => {
    for (const size of DISPLAY_SIZES) {
      await D.setViewportSize(size);
      await settle(D);
      const info = await lineFacts(D, 'display-title');
      const inside = info.left >= -1 && info.right <= size.width + 1 && info.top >= -1 && info.bottom <= size.height + 1;
      const wordsKept = name === 'unbroken' || info.splits.length === 0;
      check(`titles ${name} ${stage} @${size.width}x${size.height}: inside the window, keep-all, ${name === 'spaced' ? 'no word split across lines' : 'wraps rather than overflows'}`, inside && info.wordBreak === 'keep-all' && wordsKept, JSON.stringify(info));
      const file = path.join(OUT, `finish-titles-${name}-${stage}-${size.width}x${size.height}.png`);
      await D.screenshot({ path: file });
      shots[stage].push(file);
    }
    await D.setViewportSize({ width: 1920, height: 1080 });
  };

  for (const [name, title] of Object.entries(TITLES)) {
    check(`titles ${name}: the test title is about 60 characters`, [...title].length >= 56 && [...title].length <= 60, String([...title].length));
    await composeVote(H, { title, kind: 'freeform', anonymity: 'anonymous' });
    await byId(D, 'display-voting').waitFor();
    await titleSweep(name, 'voting');
    room.submitAs('민준', { kind: 'text', text: '글' });
    await closeVote(H);
    await byId(D, 'display-closed').waitFor();
    await titleSweep(name, 'closed');
    await byId(H, 'dismiss-vote').click();
    await byId(H, 'export-confirm-skip').click();
    await byId(H, 'open-composer').waitFor();
  }
  await contactSheet(browser, 'titles-closed', shots.closed, { scale: 0.3 });
  await contactSheet(browser, 'titles-voting', shots.voting, { scale: 0.3 });

  await composeVote(H, { title: '가운데 위치 확인', kind: 'freeform', anonymity: 'anonymous' });
  room.submitAs('민준', { kind: 'text', text: '알파' });
  room.submitAs('서연', { kind: 'text', text: '베타' });
  await closeVote(H);
  check('position: before the first paper opens the host reads "- / 2", not "0 / 2"', (await textOf(H, 'result-position')) === '- / 2');
  check('position: the display shows no counter at all before the first paper', (await byId(D, 'display-position').count()) === 0 && !(await wholePage(D)).includes('0 / 2'));
  await byId(H, 'result-next').click();
  await byId(D, 'display-position').waitFor();
  check('position: once a paper is open both read 1 / 2', (await textOf(H, 'result-position')) === '1 / 2' && (await textOf(D, 'display-position')) === '1 / 2');
  await byId(H, 'dismiss-vote').click();
  await byId(H, 'export-confirm-skip').click();
  await byId(H, 'open-composer').waitFor();

  await composeVote(H, { title: '그래프 설정 확인', kind: 'choice', anonymity: 'anonymous', options: OPTIONS });
  room.submitAs('민준', { kind: 'choice', optionIndex: 1 });
  room.submitAs('서연', { kind: 'choice', optionIndex: 2 });
  await closeVote(H);
  await byId(H, 'reveal-all').click();
  await byId(H, 'result-graph').waitFor();
  await H.waitForTimeout(1300);
  const reach = async (id) => {
    await byId(H, id).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await H.waitForTimeout(120);
    return byId(H, id).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { free: hit !== null && el.contains(hit), inside: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth };
    });
  };
  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const at = `${size.width}x${size.height}`;
    await H.setViewportSize(size);
    await settle(H);
    const toggle = byId(H, 'settings-toggle');
    check(`graph settings @${at}: the 설정 disclosure is present and the switches start folded`, (await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false' && !(await byId(H, 'toggle-hidden').isVisible()));
    const t = await reach('settings-toggle');
    check(`graph settings @${at}: the toggle can be scrolled to and nothing sits over it`, t.free && t.inside, JSON.stringify(t));
    await toggle.click();
    await H.waitForTimeout(150);
    const s = await reach('toggle-hidden');
    check(`graph settings @${at}: opened, the switch is whole on screen and the bottom bar is not over it`, (await toggle.getAttribute('aria-expanded')) === 'true' && s.free && s.inside, JSON.stringify(s));
    await byId(H, 'toggle-hidden').click();
    check(`graph settings @${at}: the switch works and the closed row would say so`, (await byId(H, 'toggle-hidden').getAttribute('aria-checked')) === 'true');
    await toggle.click();
    await H.evaluate(() => window.scrollTo(0, 0));
    await H.waitForTimeout(150);
    check(`graph settings @${at}: folded again, the row names the state`, (await toggle.textContent())?.includes('대화면 가림 중') === true);
    await H.screenshot({ path: path.join(OUT, `finish-graph-settings-${at}.png`), fullPage: true });
    await toggle.click();
    await byId(H, 'toggle-hidden').click();
    await toggle.click();
  }
  await H.setViewportSize(HOST);
  await settle(H);
  check('graph settings @1280: no disclosure on a wide screen, the switches are always there', (await byId(H, 'settings-toggle').count()) === 0 && (await byId(H, 'toggle-hidden').isVisible()));
  check('step5: page errors', problems.length === 0, problems.join(' | '));
  await Promise.all([host.ctx.close(), disp.ctx.close()]);
}

export async function runFullscreen(browser) {
  const problems = [];
  for (const size of [{ width: 1920, height: 1080 }, PHONE]) {
    const room = newRoom();
    const host = await openHost(browser, room, size, { problems });
    const H = host.page;
    await startAndClose(H, room, { title: '전체화면 확인', kind: 'freeform', anonymity: 'anonymous', ballots: { 민준: { kind: 'text', text: '알파 점심은 국밥' }, 서연: { kind: 'text', text: '베타 산책' } } });
    await byId(H, 'result-next').click();
    await byId(H, 'result-paper').waitFor();
    await H.waitForTimeout(2000);
    const label = async () => (await byId(H, 'fullscreen').getAttribute('aria-label')) ?? '';
    check(`fullscreen operator ${size.width}: the toggle is a button named 전체화면, at least 44px`, (await label()) === '전체화면' && (await byId(H, 'fullscreen').evaluate((el) => el.tagName)) === 'BUTTON' && (await byId(H, 'fullscreen').boundingBox()).width >= 44 && (await byId(H, 'fullscreen').boundingBox()).height >= 44);
    await byId(H, 'fullscreen').click();
    await H.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 3000 }).catch(() => undefined);
    const active = await H.evaluate(() => document.fullscreenElement?.getAttribute('aria-label') ?? null);
    if (active === null) {
      console.log(`SKIP fullscreen operator ${size.width}: this browser did not enter fullscreen`);
    } else {
      await H.waitForFunction(() => document.querySelector('[data-testid="fullscreen"]')?.getAttribute('aria-label') === '전체화면 나가기', null, { timeout: 2000 }).catch(() => undefined);
      check(`fullscreen operator ${size.width}: the results area is the fullscreen element and the toggle reads 전체화면 나가기`, active === '결과 확인' && (await label()) === '전체화면 나가기');
      check(`fullscreen operator ${size.width}: the same toggle is inside the fullscreen area`, await byId(H, 'fullscreen').evaluate((el) => document.fullscreenElement?.contains(el) === true));
      await H.waitForTimeout(500);
      const parts = await H.evaluate(() => {
        const area = document.fullscreenElement.getBoundingClientRect();
        const within = (id) => {
          const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
          return r ? r.left >= area.left - 1 && r.right <= area.right + 1 && r.top >= area.top - 1 && r.bottom <= area.bottom + 1 : false;
        };
        return {
          stage: within('results-stage'),
          paper: within('result-paper'),
          next: within('result-next'),
          prev: within('result-prev'),
          toggle: within('fullscreen'),
          noScroll: document.fullscreenElement.scrollHeight <= document.fullscreenElement.clientHeight + 1,
        };
      });
      check(`fullscreen operator ${size.width}: stage, paper and controls sit inside the screen and nothing scrolls`, Object.values(parts).every(Boolean), JSON.stringify(parts));
      await H.screenshot({ path: path.join(OUT, `finish-fullscreen-operator-${size.width}x${size.height}.png`) });
      await H.keyboard.press('Escape');
      await H.waitForTimeout(500);
      if (!(await H.evaluate(() => document.fullscreenElement === null))) {
        console.log(`NOTE fullscreen operator ${size.width}: headless Edge ignores a synthetic Escape, so only the toggle was used to leave`);
        await byId(H, 'fullscreen').click();
        await H.waitForFunction(() => document.fullscreenElement === null);
      }
      await H.waitForFunction(() => document.querySelector('[data-testid="fullscreen"]')?.getAttribute('aria-label') === '전체화면', null, { timeout: 2000 }).catch(() => undefined);
      check(`fullscreen operator ${size.width}: it leaves fullscreen and the toggle reads 전체화면 again`, (await label()) === '전체화면');
    }
    await host.ctx.close();

    const disp = await openDisplay(browser, room, size, { problems });
    const D = disp.page;
    await byId(D, 'display-closed').waitFor();
    await byId(D, 'display-fullscreen').waitFor();
    const dlabel = async () => (await byId(D, 'display-fullscreen').getAttribute('aria-label')) ?? '';
    check(`fullscreen display ${size.width}: the toggle is named 전체화면 and is at least 44px`, (await dlabel()) === '전체화면' && (await byId(D, 'display-fullscreen').boundingBox()).width >= 44);
    await byId(D, 'display-fullscreen').click();
    await D.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 3000 }).catch(() => undefined);
    const dActive = await D.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') ?? null);
    if (dActive === null) {
      console.log(`SKIP fullscreen display ${size.width}: this browser did not enter fullscreen`);
    } else {
      await D.waitForFunction(() => document.querySelector('[data-testid="display-fullscreen"]')?.getAttribute('aria-label') === '전체화면 나가기', null, { timeout: 2000 }).catch(() => undefined);
      check(`fullscreen display ${size.width}: the display root is the fullscreen element and the toggle reads 전체화면 나가기`, dActive === 'display-root' && (await dlabel()) === '전체화면 나가기');
      await D.waitForTimeout(400);
      await D.screenshot({ path: path.join(OUT, `finish-fullscreen-display-${size.width}x${size.height}.png`) });
      await D.keyboard.press('Escape');
      await D.waitForTimeout(500);
      if (!(await D.evaluate(() => document.fullscreenElement === null))) {
        await byId(D, 'display-fullscreen').click();
        await D.waitForFunction(() => document.fullscreenElement === null);
      }
      await D.waitForFunction(() => document.querySelector('[data-testid="display-fullscreen"]')?.getAttribute('aria-label') === '전체화면', null, { timeout: 2000 }).catch(() => undefined);
      check(`fullscreen display ${size.width}: it leaves fullscreen and the toggle reads 전체화면 again`, (await dlabel()) === '전체화면');
    }
    await disp.ctx.close();
  }
  check('fullscreen: page errors', problems.length === 0, problems.join(' | '));
}
