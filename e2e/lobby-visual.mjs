// Visual and behavior check of the lobby and the voting lifecycle against a faked WebSocket server.
// Run from the project root: node e2e/lobby-visual.mjs
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createFakeRoom } from './fake-server.mjs';
import { EDGE, ORIGIN, OUT, SIZES, box, byId, check, failures, noHorizontalScroll, settle, shot, startVite, stopVite, watchPage } from './kit.mjs';
import { runVoteWalk } from './vote-walk.mjs';

async function checkBreakpoints(page, restore) {
  const probe = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
      const main = rect('.host-main');
      return {
        mainWidth: Math.round(main.width),
        twoColumns: rect('[data-testid="roster"]').top < rect('.join-card').bottom,
        bottomBar: document.querySelector('.bar-bottom') !== null,
        topActions: document.querySelector('.bar-actions') !== null,
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
  const watch = (page) => watchPage(page, problems);

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
  const topActions = await hostPage.locator('.bar-actions .btn').count();
  const bottomActions = await hostPage.locator('.bar-bottom .btn').count();
  check(`host ${tag}: actions in ${width >= 1024 ? 'top bar' : 'bottom bar'} only`, width >= 1024 ? topActions === 2 && bottomActions === 0 : bottomActions === 2 && topActions === 0, `${topActions}/${bottomActions}`);
  const disabled = await hostPage.locator('button:disabled').allInnerTexts();
  check(`host ${tag}: only the big-screen action is disabled in the lobby`, disabled.length === 1 && disabled[0] === '대화면 열기', disabled.join(','));
  check(`host ${tag}: open-composer enabled`, await byId(hostPage, 'open-composer').isEnabled());
  check(`host ${tag}: lobby roster items carry data-submitted=false`, (await hostPage.locator('[data-testid="roster-item"][data-submitted="false"]').count()) === (await byId(hostPage, 'roster-item').count()));
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
  for (const size of SIZES) {
    await runWidth(browser, size);
    await runVoteWalk(browser, size);
  }
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
