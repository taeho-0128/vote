// Step 5, walked against the fake server: a free-form anonymous vote and a choice named vote from close to dismiss, one
// host and several display pages that must follow it, the privacy of the public screen, the unfold, reload, reduced
// motion, refusals, the display's wrong-token paths, and the fit of both screens at the sizes they are shown at.
// Run from the project root: npx tsx e2e/results-walk.mjs
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { NICKS, OPTIONS, TEXTS, authorAt, clearRecorded, closeVote, composeVote, contentText, found, newRoom, openDisplay, openHost, orderedContent, recorded, stepTo, textOf, waitRest, waitText, wholePage } from './results-kit.mjs';
import { EDGE, ORIGIN, OUT, byId, check, failures, settle, startViteNode, stopVite } from './kit.mjs';

const OFFLINE = '연결이 끊겨서 보내지 못했어요';
const HOST = { width: 1280, height: 800 };
const D1920 = { width: 1920, height: 1080 };
const D1280 = { width: 1280, height: 720 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const OPERATOR_WIDTHS = [390, 768, 1280, 1920];

const shotTo = async (page, name, options = {}) => {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `results-${name}.png`), ...options });
};

// The operator at the phone and the laptop width, in the same state.
async function shotHost(page, name) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await shotTo(page, `op-${name}-1280`);
  await page.setViewportSize({ width: 390, height: 844 });
  await shotTo(page, `op-${name}-390`, { fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page);
}

const shotDisplays = async (d1920, d1280, name) => {
  await shotTo(d1920, `disp-${name}-1920x1080`);
  await shotTo(d1280, `disp-${name}-1280x720`);
};

const fitsViewport = (page) =>
  page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    iw: window.innerWidth,
    ih: window.innerHeight,
  }));

async function noOverflow(page, label) {
  const m = await fitsViewport(page);
  check(`${label}: no horizontal scroll`, m.sw <= m.iw, JSON.stringify(m));
}

async function displayFits(page, label) {
  const m = await fitsViewport(page);
  check(`${label}: fits the window without scrolling`, m.sw <= m.iw && m.sh <= m.ih, JSON.stringify(m));
  const outside = await page.evaluate(() => {
    const bad = [];
    for (const id of ['display-title', 'display-position', 'display-paper', 'display-pile', 'display-folded', 'display-progress', 'display-graph', 'display-code']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) bad.push(id);
    }
    return bad;
  });
  check(`${label}: every visible part is inside the window`, outside.length === 0, outside.join());
}

const unfoldFacts = (entries) => {
  const steps = entries.filter((e) => e.k === 'step' && e.v !== null).map((e) => e.v);
  const plays = entries.filter((e) => e.k === 'play').map((e) => e.v);
  const start = entries.find((e) => e.k === 'play' && (e.v === 'unfold' || e.v === 'fade'));
  const end = entries.find((e) => e.k === 'play' && e.v === 'rest' && start && e.t > start.t);
  return { steps, plays, ms: start && end ? Math.round(end.t - start.t) : NaN };
};

// Screencast frames come at the page's own pace, so the sequence shows the moment and not the cost of taking pictures.
async function frameSequence(page, name, press) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (frame) => {
    frames.push({ at: frame.metadata.timestamp, data: frame.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, everyNthFrame: 1 });
  await page.waitForTimeout(150);
  const pressedAt = Date.now() / 1000;
  await press();
  await page.waitForTimeout(2400);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const after = frames.filter((frame) => frame.at >= pressedAt - 0.05);
  const picks = Array.from({ length: Math.min(12, after.length) }, (_, i) => after[Math.round((i * (after.length - 1)) / Math.max(1, Math.min(12, after.length) - 1))]);
  picks.forEach((frame, i) => writeFileSync(path.join(OUT, `results-unfold-${name}-${String(i).padStart(2, '0')}-${Math.round((frame.at - pressedAt) * 1000)}ms.jpg`), Buffer.from(frame.data, 'base64')));
  return { shots: picks.length, total: after.length };
}

async function runFreeform(browser) {
  const problems = [];
  const room = newRoom();
  room.fill(45);
  const nicknames = room.participants.map((p) => p.nickname);
  const host = await openHost(browser, room, HOST, { problems });
  const d1 = await openDisplay(browser, room, D1920, { problems });
  const d2 = await openDisplay(browser, room, D1280, { problems });
  const H = host.page;
  const D = [d1.page, d2.page];

  await byId(D[0], 'display-lobby').waitFor();
  check('display lobby: shows the four code digits, the QR and the head count', (await byId(D[0], 'display-code').getAttribute('aria-label')) === `방 코드 ${room.code}` && (await byId(D[0], 'display-join-qr').isVisible()) && (await textOf(D[0], 'display-count')) === '45');
  check('display lobby: one chip per person', (await byId(D[0], 'display-chip').count()) === 45);
  await displayFits(D[0], 'display lobby 1920x1080');
  await displayFits(D[1], 'display lobby 1280x720');
  const chipsClipped = await D[1].evaluate(() => {
    const el = document.querySelector('.d-chips');
    return el ? el.scrollHeight - el.clientHeight : 0;
  });
  check('display lobby: all 45 chips fit at 1280x720', chipsClipped <= 1, String(chipsClipped));
  await shotDisplays(D[0], D[1], 'lobby');

  await composeVote(H, { title: '이번 모임에서 가장 좋았던 순간은 언제였나요?', kind: 'freeform', anonymity: 'anonymous' });
  const framesFrom = room.displayFrames.length;
  await byId(D[0], 'display-voting').waitFor();
  check('display voting: progress reads exactly 0 / 45', (await textOf(D[0], 'display-progress')) === '0 / 45');
  NICKS.forEach((nick) => room.submitAs(nick, TEXTS[nick]));
  await waitText(D[0], 'display-progress', '8 / 45');
  await waitText(D[1], 'display-progress', '8 / 45');
  check('display voting: title is the vote title and no person is named', (await textOf(D[0], 'display-title')).includes('가장 좋았던 순간') && found(await wholePage(D[0]), nicknames).length === 0);
  await displayFits(D[0], 'display voting 1920x1080');
  await displayFits(D[1], 'display voting 1280x720');
  await shotDisplays(D[0], D[1], 'voting');

  await closeVote(H);
  await byId(H, 'result-pile').waitFor();
  const total = 8;
  check('host results: the pile shows 0 / 8, previous is off, next is on', (await textOf(H, 'result-position')) === `0 / ${total}` && (await byId(H, 'result-prev').isDisabled()) && (await byId(H, 'result-next').isEnabled()));
  check('host results: a free-form vote offers no 전체 공개', (await byId(H, 'reveal-all').count()) === 0);
  check('host results: switches start off and 작성자 보기 is local', (await byId(H, 'toggle-hidden').getAttribute('aria-checked')) === 'false' && (await byId(H, 'toggle-author').getAttribute('aria-checked')) === 'false' && (await byId(H, 'toggle-author').getAttribute('role')) === 'switch');
  check('host results: the shuffled order is not the submission order', room.reveal.order.join() !== room.participants.filter((p) => room.ballots.has(p.id)).map((p) => p.id).join());
  for (const page of D) {
    await byId(page, 'display-pile').waitFor();
    check('display closed: a folded pile and the waiting line, no position, no content', (await byId(page, 'display-position').count()) === 0 && (await wholePage(page)).includes('곧 결과를 보여드릴게요'));
  }
  await displayFits(D[0], 'display pile 1920x1080');
  await displayFits(D[1], 'display pile 1280x720');
  await shotDisplays(D[0], D[1], 'pile');
  await shotHost(H, 'pile');
  await noOverflow(H, 'host pile @1280');

  const unopenedTexts = (from) => Array.from({ length: total - from }, (_, i) => contentText(orderedContent(room, from + i))).filter(Boolean);
  const authors = NICKS;

  await clearRecorded(D[1]);
  const seq = await frameSequence(D[1], 'first', () => byId(H, 'result-next').click());
  await waitRest(D[1]);
  const first = unfoldFacts(await recorded(D[1]));
  check('unfold: pile to first paper runs slip, strip, paper, then rests', first.steps.join() === 'slip,strip,paper,rest', first.steps.join());
  check('unfold: the whole moment lasts 1.4 to 2.0 seconds', first.ms >= 1400 && first.ms <= 2000, String(first.ms));
  check('unfold: the frame sequence was captured', seq.shots >= 8, JSON.stringify(seq));

  for (const page of [H, ...D]) {
    const idPrefix = page === H ? 'result' : 'display';
    await byId(page, `${idPrefix}-paper`).waitFor();
    check(`position ${idPrefix}: 1 / 8`, (await textOf(page, `${idPrefix}-position`)) === '1 / 8');
  }
  const expectText = async (page, id, index, label) => {
    const content = orderedContent(room, index);
    if (content.kind === 'text') {
      const shown = await byId(page, id).locator('.pface-text').textContent();
      check(`${label}: shows paper ${index + 1} exactly`, shown === content.text, `${shown} vs ${content.text}`);
    } else {
      const paths = await byId(page, id).locator('.pface-ink path').count();
      const dots = await byId(page, id).locator('.pface-ink circle').count();
      check(`${label}: draws all of ink paper ${index + 1}`, paths === 3 && dots === 1, `${paths}/${dots}`);
    }
  };
  for (let i = 0; i < D.length; i++) await expectText(D[i], 'display-paper', 0, `display ${i + 1}`);
  await expectText(H, 'result-paper', 0, 'host');
  check('privacy: both displays hold no nickname and none of the unopened papers', (await Promise.all(D.map(async (page) => found(await wholePage(page), [...nicknames, ...unopenedTexts(1)])))).every((hits) => hits.length === 0));
  check('privacy: the display socket never carried a nickname or an unopened paper', found(room.displayFrames.slice(framesFrom).join(''), [...nicknames, ...unopenedTexts(1)]).length === 0);
  check('display: an anonymous paper carries no signature', (await byId(D[0], 'display-signature').count()) === 0 && (await byId(H, 'result-signature').count()) === 0);
  await displayFits(D[0], 'display paper 1920x1080');
  await displayFits(D[1], 'display paper 1280x720');
  await shotDisplays(D[0], D[1], 'paper');
  await shotHost(H, 'paper');

  await clearRecorded(D[1]);
  await H.evaluate(() => document.activeElement?.blur());
  await frameSequence(D[1], 'next', () => H.keyboard.press('ArrowRight'));
  await waitText(D[1], 'display-position', '2 / 8');
  await waitRest(D[1]);
  const second = unfoldFacts(await recorded(D[1]));
  check('keys: ArrowRight moves both screens to 2 / 8 and unfolds the next paper', (await textOf(H, 'result-position')) === '2 / 8' && second.steps.join() === 'slip,strip,paper,rest', second.steps.join());
  await expectText(D[1], 'display-paper', 1, 'display 2 after ArrowRight');
  await H.keyboard.press('Space');
  await waitText(D[0], 'display-position', '3 / 8');
  check('keys: Space moves on', (await textOf(H, 'result-position')) === '3 / 8');
  await waitRest(D[0]);

  await clearRecorded(D[0]);
  await H.keyboard.press('ArrowLeft');
  await waitText(D[0], 'display-position', '2 / 8');
  await byId(D[0], 'display-paper').waitFor();
  await waitRest(D[0]);
  const back = unfoldFacts(await recorded(D[0]));
  check('keys: ArrowLeft goes back with a cross-fade and no unfold', back.plays.includes('fade') && !back.steps.includes('slip'), JSON.stringify(back));
  await expectText(D[0], 'display-paper', 1, 'display 1 after ArrowLeft');

  await byId(H, 'open-display').click();
  await byId(H, 'display-link').waitFor();
  const link = await byId(H, 'display-link').inputValue();
  check('display link: read-only field holds the link built from the origin, code and token', link === `${ORIGIN}/d/${room.code}/${room.displayToken}` && (await byId(H, 'display-link').getAttribute('readonly')) !== null, link);
  check('display link: a QR, a copy button and one plain sentence', (await byId(H, 'display-qr').locator('svg path').count()) === 1 && (await byId(H, 'display-copy').isVisible()) && (await H.locator('.display-dialog').innerText()).includes('보기만'));
  await shotTo(H, 'op-dialog-1280');
  await H.keyboard.press('ArrowRight');
  await H.waitForTimeout(250);
  check('keys: ignored while the dialog is open', (await textOf(H, 'result-position')) === '2 / 8');
  await byId(H, 'display-copy').click();
  await H.waitForFunction(() => document.querySelector('[data-testid="display-note"]')?.textContent !== '');
  check('display link: copy answers with a status line', (await textOf(H, 'display-note')).includes('복사'));
  const popupPromise = H.context().waitForEvent('page', { timeout: 6000 });
  await byId(H, 'display-open-window').click();
  const popup = await popupPromise;
  await room.install(popup);
  await popup.reload();
  await byId(popup, 'display-root').waitFor();
  await waitText(popup, 'display-position', '2 / 8');
  check('display link: 새 창으로 열기 opens a display that is already on the same paper', (await popup.url()) === link);
  await popup.close();
  await H.keyboard.press('Escape');
  await H.locator('.display-dialog').waitFor({ state: 'hidden' });
  await H.setViewportSize({ width: 390, height: 844 });
  await byId(H, 'open-display').click();
  await shotTo(H, 'op-dialog-390');
  await H.keyboard.press('Escape');
  await H.setViewportSize(HOST);

  check('author: 작성자 보기 shows nothing until it is switched on', (await byId(H, 'author-label').count()) === 0);
  await byId(H, 'toggle-author').click();
  const nowAt = authorAt(room, 1);
  check('author: the label names the writer and says the display does not show it', (await byId(H, 'toggle-author').getAttribute('aria-checked')) === 'true' && (await textOf(H, 'author-label')).includes(nowAt) && (await textOf(H, 'author-label')).includes('표시되지 않아요'));
  check('author: the nickname is not on either display', (await Promise.all(D.map(async (p) => found(await wholePage(p), [nowAt]).length))).every((n) => n === 0));
  await shotHost(H, 'author');
  await byId(H, 'toggle-author').click();

  await byId(H, 'toggle-hidden').click();
  for (const page of D) await byId(page, 'display-folded').waitFor();
  const hiddenPaper = contentText(orderedContent(room, 1));
  check('hidden: the host switch is on and the host still sees the paper', (await byId(H, 'toggle-hidden').getAttribute('aria-checked')) === 'true' && (await byId(H, 'result-paper').isVisible()) && (await byId(H, 'result-paper').textContent()).includes(hiddenPaper));
  check('hidden: both displays show the folded paper and none of its content', (await Promise.all(D.map(async (p) => (await byId(p, 'display-paper').count()) === 0 && found(await wholePage(p), [hiddenPaper, ...nicknames]).length === 0))).every(Boolean));
  check('hidden: the display carries no content in the frames it was sent', !room.displayFrames.slice(-2).join('').includes(hiddenPaper));
  await shotDisplays(D[0], D[1], 'hidden');
  await shotHost(H, 'hidden');
  const late = await openDisplay(browser, room, D1280, { problems });
  await byId(late.page, 'display-folded').waitFor();
  check('hidden: a display that joins late shows the folded paper at once', (await byId(late.page, 'display-paper').count()) === 0);
  await late.ctx.close();
  await clearRecorded(D[0]);
  await byId(H, 'toggle-hidden').click();
  await byId(D[0], 'display-paper').waitFor();
  const uncovered = unfoldFacts(await recorded(D[0]));
  check('hidden: switching it off unfolds the covered paper in place', uncovered.steps.includes('slip'), JSON.stringify(uncovered));
  await expectText(D[0], 'display-paper', 1, 'display after uncovering');
  await waitRest(D[0]);

  check('privacy: after reaching paper 3 of 8 the frames hold no paper beyond it', found(room.displayFrames.slice(framesFrom).join(''), unopenedTexts(3)).length === 0);

  room.latency = 130;
  const commandsBefore = room.commands('revealMove').length;
  await clearRecorded(D[1]);
  await H.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 5; i++) await H.keyboard.press('ArrowRight');
  await waitText(H, 'result-position', '7 / 8');
  await waitText(D[1], 'display-position', '7 / 8');
  await waitRest(D[1]);
  room.latency = 0;
  const sent = room.commands('revealMove').length - commandsBefore;
  const burst = unfoldFacts(await recorded(D[1]));
  check('fast presses: five quick presses end on paper 7 of 8 on the host and the display', (await textOf(D[1], 'display-position')) === '7 / 8');
  await expectText(D[1], 'display-paper', 6, 'display after the burst');
  check('fast presses: the server heard fewer commands than presses', sent < 5, String(sent));
  check('fast presses: no backlog of unfolds, at most one slip after the burst', burst.steps.filter((s) => s === 'slip').length <= 1, burst.steps.join());

  await H.keyboard.press('ArrowRight');
  await waitText(D[0], 'display-position', '8 / 8');
  await waitRest(D[0]);
  check('last paper: next is off and the host says so quietly', (await byId(H, 'result-next').isDisabled()) && (await textOf(H, 'result-note')).includes('마지막 용지예요'));
  check('last paper: the display says 마지막 용지예요', (await wholePage(D[0])).includes('마지막 용지예요'));
  await H.keyboard.press('ArrowRight');
  await H.waitForTimeout(250);
  check('last paper: another press changes nothing', (await textOf(H, 'result-position')) === '8 / 8' && room.reveal.cursor === 7);
  await shotDisplays(D[0], D[1], 'last');
  await shotHost(H, 'last');
  await expectText(D[0], 'display-paper', 7, 'display last');

  await D[0].reload();
  await byId(D[0], 'display-paper').waitFor();
  const reloaded = unfoldFacts(await recorded(D[0]));
  check('reload: the display resumes on the same paper without playing an opening', (await textOf(D[0], 'display-position')) === '8 / 8' && !reloaded.steps.includes('slip') && !reloaded.plays.includes('unfold'), JSON.stringify(reloaded));
  await H.reload();
  await byId(H, 'result-paper').waitFor();
  check('reload: the host resumes on the same paper', (await textOf(H, 'result-position')) === '8 / 8' && (await byId(H, 'toggle-author').getAttribute('aria-checked')) === 'false');

  const inkIndex = room.reveal.order.findIndex((id) => room.ballots.get(id).kind === 'ink');
  const longIndex = room.reveal.order.findIndex((id) => contentText(room.ballots.get(id))?.startsWith('델타'));
  await byId(H, 'toggle-author').click();
  for (const [name, index] of [['ink', inkIndex], ['long', longIndex]]) {
    await stepTo(H, index + 1);
    await waitText(D[0], 'display-position', `${index + 1} / 8`);
    await waitRest(D[0]);
    await waitRest(D[1]);
    await expectText(D[0], 'display-paper', index, `display 1920 ${name} paper`);
    await expectText(D[1], 'display-paper', index, `display 1280 ${name} paper`);
    if (name === 'long') {
      const clipped = await D[1].evaluate(() => {
        const text = document.querySelector('[data-testid="display-paper"] .pface-text');
        return text.scrollHeight - text.clientHeight;
      });
      check('a 200-character paper shows whole at display size', clipped <= 1, String(clipped));
    }
    await shotDisplays(D[0], D[1], `paper-${name}`);
    await shotHost(H, `paper-${name}`);
  }
  await byId(H, 'toggle-author').click();

  await stepTo(H, 4);
  room.refuseNext = 'bad_reveal';
  await byId(H, 'result-next').click();
  await byId(H, 'command-error').waitFor();
  check('refused: bad_reveal reads as plain Korean and the screen stays put', (await textOf(H, 'command-error')).includes('넘길 수 없어요'));
  await shotHost(H, 'refused');
  await H.waitForTimeout(100);

  room.dropAll();
  await byId(H, 'connection-banner').waitFor({ timeout: 4000 });
  await byId(D[0], 'display-banner').waitFor({ timeout: 4000 });
  check('offline: the display keeps the paper and says it is reconnecting', (await byId(D[0], 'display-paper').count()) === 1 && (await textOf(D[0], 'display-banner')).includes('다시 연결하는 중'));
  await H.evaluate(() => document.activeElement?.blur());
  await byId(H, 'result-prev').click();
  await byId(H, 'command-error').waitFor();
  check('offline: a command shows the existing offline message', (await textOf(H, 'command-error')).includes(OFFLINE));
  await shotHost(H, 'offline');
  await shotTo(D[1], 'disp-offline-1280x720');
  room.refuse = false;
  await byId(H, 'connection-banner').waitFor({ state: 'detached', timeout: 12000 });
  await byId(D[0], 'display-banner').waitFor({ state: 'detached', timeout: 12000 });
  check('offline: both screens recover and the message clears', (await byId(H, 'command-error').count()) === 0);

  await byId(H, 'fullscreen').waitFor();
  check('fullscreen: the host button has an accessible name', (await byId(H, 'fullscreen').getAttribute('aria-label')) === '전체화면');
  await byId(H, 'fullscreen').click();
  const fs = await H.waitForFunction(() => document.fullscreenElement?.getAttribute('aria-label') ?? null, null, { timeout: 3000 }).then((handle) => handle.jsonValue()).catch(() => null);
  check('fullscreen: the results area goes fullscreen', fs === '결과 확인', String(fs));
  if (fs) {
    check('fullscreen: the controls stay inside the results area', (await byId(H, 'result-next').isVisible()) && (await byId(H, 'fullscreen').getAttribute('aria-label')) === '전체화면 나가기');
    await shotTo(H, 'op-fullscreen-1280');
    await byId(H, 'fullscreen').click();
    await H.waitForFunction(() => document.fullscreenElement === null);
  }
  await byId(D[0], 'display-fullscreen').waitFor();
  check('fullscreen: the display button is small and named', (await byId(D[0], 'display-fullscreen').getAttribute('aria-label')) === '전체화면' && (await box(byId(D[0], 'display-fullscreen'))).width <= 48);

  await stepTo(H, 6);
  await waitRest(D[0]);
  const reduced = await openDisplay(browser, room, D1280, { reduced: true, problems });
  await byId(reduced.page, 'display-paper').waitFor();
  await clearRecorded(reduced.page);
  await H.keyboard.press('ArrowRight');
  await waitText(reduced.page, 'display-position', '7 / 8');
  await waitRest(reduced.page);
  const quiet = unfoldFacts(await recorded(reduced.page));
  check('reduced motion: the next paper fades in and never unfolds', quiet.plays.includes('fade') && !quiet.steps.includes('slip') && quiet.ms < 600, JSON.stringify(quiet));
  await reduced.ctx.close();

  check('freeform walk: page errors', problems.length === 0, problems.join(' | '));

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'open-composer').waitFor();
  for (const page of D) await byId(page, 'display-lobby').waitFor();
  check('dismiss: both displays are back on the lobby', (await byId(D[0], 'display-paper').count()) === 0 && (await byId(D[1], 'display-code').isVisible()));

  await Promise.all([host.ctx.close(), d1.ctx.close(), d2.ctx.close()]);
}

const box = async (locator) => (await locator.boundingBox()) ?? { width: 0, height: 0 };

async function runChoice(browser) {
  const problems = [];
  const room = newRoom();
  const host = await openHost(browser, room, HOST, { problems });
  const d1 = await openDisplay(browser, room, D1920, { problems });
  const d2 = await openDisplay(browser, room, D1280, { problems });
  const H = host.page;
  const D = [d1.page, d2.page];

  await composeVote(H, { title: '오늘 점심은 뭐가 좋을까요?', kind: 'choice', anonymity: 'named', options: OPTIONS });
  const picks = [0, 0, 1, 1, 3, 0, 1];
  picks.forEach((optionIndex, i) => room.submitAs(room.participants[i].nickname, { kind: 'choice', optionIndex }));
  await waitText(D[0], 'display-progress', `7 / ${room.participants.length}`);
  await closeVote(H);
  await byId(H, 'result-pile').waitFor();
  check('choice: the host offers 전체 공개 and no 작성자 보기 on a named vote', (await byId(H, 'reveal-all').isVisible()) && (await byId(H, 'toggle-author').count()) === 0);

  await byId(H, 'result-next').click();
  await byId(D[0], 'display-paper').waitFor();
  await waitRest(D[0]);
  const author = authorAt(room, 0);
  check('named: the signature is on the paper on the host and on both displays', (await textOf(H, 'result-signature')) === `— ${author}` && (await textOf(D[0], 'display-signature')) === `— ${author}`);
  await waitRest(D[1]);
  check('named: a choice paper lists every option and rings the chosen one', (await byId(D[0], 'display-paper').locator('.pface-opt span').allInnerTexts()).join() === OPTIONS.join() && (await byId(D[0], 'display-paper').locator('.pface-opt:has(.pface-ring) span').allInnerTexts()).length === 1);
  await shotDisplays(D[0], D[1], 'named');
  await shotHost(H, 'named');
  check('choice: no cumulative tally while stepping one by one', (await byId(H, 'result-graph').count()) === 0 && (await byId(D[0], 'display-graph').count()) === 0);

  await byId(H, 'reveal-all').click();
  await byId(H, 'result-graph').waitFor();
  await byId(D[0], 'display-graph').waitFor();
  const expected = OPTIONS.map((_, i) => picks.filter((p) => p === i).length);
  const countsOf = async (page, prefix) => Promise.all(OPTIONS.map((_, i) => textOf(page, `${prefix}-${i}`)));
  check('graph: host counts are exact numbers in the options\' order', (await countsOf(H, 'graph-count')).join() === expected.join(), (await countsOf(H, 'graph-count')).join());
  check('graph: both displays show the same counts', (await countsOf(D[0], 'display-graph-count')).join() === expected.join() && (await countsOf(D[1], 'display-graph-count')).join() === expected.join());
  check('graph: a zero count is shown as 0', expected.includes(0) ? (await countsOf(D[0], 'display-graph-count')).includes('0') : true);
  check('graph: rows keep the original option order', (await H.locator('[data-testid^="graph-row-"] .graph-label').allInnerTexts()).map((t) => t.replace('최다', '').trim()).join() === OPTIONS.join());
  const leaders = await H.locator('.graph-row.lead').count();
  check('graph: the leading option is highlighted, here a tie of 돈가스 and 김치찜 at three', leaders === 2 && (await byId(H, 'graph-row-0').getAttribute('class')).includes('lead') && (await byId(H, 'graph-row-1').getAttribute('class')).includes('lead'));
  check('graph: the bars grow on mount', (await D[0].evaluate(() => getComputedStyle(document.querySelector('.graph-bar')).animationName)) === 'graph-grow');
  check('graph: the paper stage is gone and one-by-one controls are replaced', (await byId(H, 'result-next').count()) === 0 && (await byId(H, 'reveal-one').isVisible()));
  await displayFits(D[0], 'display graph 1920x1080');
  await displayFits(D[1], 'display graph 1280x720');
  await shotDisplays(D[0], D[1], 'graph');
  await shotHost(H, 'graph');

  await byId(H, 'toggle-hidden').click();
  await byId(D[0], 'display-folded').waitFor();
  check('graph: hidden, the display shows the folded paper and no counts', (await byId(D[0], 'display-graph').count()) === 0 && (await byId(H, 'result-graph').isVisible()));
  await byId(H, 'toggle-hidden').click();
  await byId(D[0], 'display-graph').waitFor();

  await byId(H, 'reveal-one').click();
  await byId(H, 'result-paper').waitFor();
  check('graph: 다시 한 장씩 보기 returns to the paper where it was', (await textOf(H, 'result-position')) === '1 / 7' && (await byId(D[0], 'display-graph').count()) === 0);

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'open-composer').waitFor();

  await composeVote(H, { title: '가장 많이 먹는 날은?', kind: 'choice', anonymity: 'anonymous', options: ['월', '화', '수', '목', '금', '토', '일', '공휴일'] });
  [0, 2, 2, 7, 5].forEach((optionIndex, i) => room.submitAs(room.participants[i].nickname, { kind: 'choice', optionIndex }));
  await closeVote(H);
  await byId(H, 'reveal-all').click();
  await byId(D[0], 'display-graph-count-7').waitFor();
  check('graph: eight options all show, the last as 1', (await textOf(D[0], 'display-graph-count-7')) === '1' && (await textOf(H, 'graph-count-7')) === '1');
  await displayFits(D[0], 'display 8-option graph 1920x1080');
  await displayFits(D[1], 'display 8-option graph 1280x720');
  await shotDisplays(D[0], D[1], 'graph8');
  await shotHost(H, 'graph8');
  await byId(H, 'dismiss-vote').click();
  await byId(H, 'open-composer').waitFor();

  check('choice walk: page errors', problems.length === 0, problems.join(' | '));
  await Promise.all([host.ctx.close(), d1.ctx.close(), d2.ctx.close()]);
}

async function runEdges(browser) {
  const problems = [];

  const empty = newRoom();
  const eh = await openHost(browser, empty, HOST, { problems });
  const ed = await openDisplay(browser, empty, D1280, { problems });
  const ed2 = await openDisplay(browser, empty, D1920, { problems });
  await composeVote(eh.page, { title: '아무도 안 낸 투표', kind: 'freeform', anonymity: 'anonymous' });
  await closeVote(eh.page);
  check('empty: the host says plainly that nothing came in', (await textOf(eh.page, 'results-empty')).includes('낸 용지가 없어요'));
  check('empty: no control that cannot work', (await Promise.all(['result-next', 'result-prev', 'result-position', 'toggle-hidden', 'toggle-author', 'reveal-all', 'fullscreen'].map((id) => byId(eh.page, id).count()))).every((n) => n === 0));
  check('empty: new vote and the display link stay', (await byId(eh.page, 'dismiss-vote').isVisible()) && (await byId(eh.page, 'open-display').isVisible()));
  await byId(ed.page, 'display-empty').waitFor();
  check('empty: the display says so', (await textOf(ed.page, 'display-empty')).includes('낸 용지가 없어요'));
  await displayFits(ed.page, 'display empty 1280x720');
  await shotHost(eh.page, 'empty');
  await shotDisplays(ed2.page, ed.page, 'empty');
  await byId(eh.page, 'dismiss-vote').click();
  await byId(eh.page, 'open-composer').waitFor();

  const longTitle = '가'.repeat(30) + ' 이번 분기 팀 회고에서 가장 먼저 개선해야 한다고 생각하는 점을 적어 주세요';
  await composeVote(eh.page, { title: longTitle.slice(0, 60), kind: 'freeform', anonymity: 'named' });
  empty.submitAs('민준', { kind: 'text', text: '한 장뿐인 의견' });
  await waitText(ed.page, 'display-progress', `1 / ${empty.participants.length}`);
  await displayFits(ed.page, 'display long title voting 1280x720');
  await displayFits(ed2.page, 'display long title voting 1920x1080');
  check('long title: the display title wraps inside its box', await ed.page.evaluate(() => {
    const title = document.querySelector('[data-testid="display-title"]');
    return title.scrollWidth <= title.clientWidth + 1;
  }));
  await shotDisplays(ed2.page, ed.page, 'voting-longtitle');
  await shotHost(eh.page, 'voting-longtitle');
  await closeVote(eh.page);
  check('one ballot: 0 / 1, previous off, next on', (await textOf(eh.page, 'result-position')) === '0 / 1' && (await byId(eh.page, 'result-prev').isDisabled()) && (await byId(eh.page, 'result-next').isEnabled()));
  await shotDisplays(ed2.page, ed.page, 'one-pile');
  await shotHost(eh.page, 'one-pile');
  await byId(eh.page, 'result-next').click();
  await byId(ed.page, 'display-paper').waitFor();
  check('one ballot: 1 / 1 on both, next off, the last-paper line', (await textOf(eh.page, 'result-position')) === '1 / 1' && (await textOf(ed.page, 'display-position')) === '1 / 1' && (await byId(eh.page, 'result-next').isDisabled()) && (await byId(eh.page, 'result-prev').isDisabled()));
  check('one ballot: the signature of a named vote reads 민준', (await textOf(ed.page, 'display-signature')) === '— 민준');
  await shotDisplays(ed2.page, ed.page, 'one-paper');
  await shotHost(eh.page, 'one-paper');
  await displayFits(ed.page, 'display one paper 1280x720');

  await ed.page.setViewportSize(PHONE_LANDSCAPE);
  await settle(ed.page);
  await displayFits(ed.page, 'display paper phone landscape');
  await shotTo(ed.page, 'disp-paper-844x390');
  await ed.page.setViewportSize(D1280);

  const wrongToken = await openDisplay(browser, empty, D1280, { problems, token: 'x'.repeat(24) });
  await byId(wrongToken.page, 'display-error').waitFor();
  const connectionsAfter = empty.connections;
  await wrongToken.page.waitForTimeout(2200);
  check('wrong token: a plain message and no retry loop', (await textOf(wrongToken.page, 'display-error')).includes('주소가 올바르지 않아요') && empty.connections === connectionsAfter, `${empty.connections} vs ${connectionsAfter}`);
  check('wrong token: no vote or controls are shown', (await byId(wrongToken.page, 'display-lobby').count()) === 0 && (await byId(wrongToken.page, 'display-fullscreen').count()) === 0);
  await shotTo(wrongToken.page, 'disp-error-1280x720');
  const shortToken = await openDisplay(browser, empty, D1280, { problems, token: 'abc' });
  await byId(shortToken.page, 'display-error').waitFor();
  check('wrong token: a token of the wrong shape is refused without asking the server', empty.connections === connectionsAfter, `${empty.connections} vs ${connectionsAfter}`);
  const wrongRoom = await openDisplay(browser, empty, D1280, { problems, code: '9999' });
  await byId(wrongRoom.page, 'display-error').waitFor();
  check('wrong room: the display says the room cannot be found', (await textOf(wrongRoom.page, 'display-error')).includes('방을 찾을 수 없어요'));
  await shotTo(wrongRoom.page, 'disp-noroom-1280x720');
  for (const x of [wrongToken, shortToken, wrongRoom]) await x.ctx.close();

  check('edge walk: page errors', problems.length === 0, problems.join(' | '));
  await Promise.all([eh.ctx.close(), ed.ctx.close(), ed2.ctx.close()]);
}

async function runOperatorFit(browser) {
  const room = newRoom();
  room.fill(30);
  const problems = [];
  const host = await openHost(browser, room, { width: 390, height: 844 }, { problems });
  const H = host.page;
  await composeVote(H, { title: '오늘 점심은 뭐가 좋을까요?', kind: 'choice', anonymity: 'anonymous', options: OPTIONS });
  [0, 1, 1, 2, 3, 1].forEach((optionIndex, i) => room.submitAs(room.participants[i].nickname, { kind: 'choice', optionIndex }));
  await closeVote(H);
  for (const width of OPERATOR_WIDTHS) {
    await H.setViewportSize({ width, height: width >= 1024 ? 800 : 844 });
    await settle(H);
    await noOverflow(H, `operator pile @${width}`);
    await byId(H, 'result-next').click();
    await byId(H, 'result-paper').waitFor();
    await noOverflow(H, `operator paper @${width}`);
    const stageIn = await H.evaluate(() => {
      const stage = document.querySelector('[data-testid="results-stage"]').getBoundingClientRect();
      const paper = document.querySelector('[data-testid="result-paper"]').getBoundingClientRect();
      return paper.left >= stage.left - 1 && paper.right <= stage.right + 1 && paper.top >= stage.top - 1 && paper.bottom <= stage.bottom + 1;
    });
    check(`operator paper @${width}: the paper sits inside its stage`, stageIn);
    const layout = await H.evaluate(() => {
      const stage = document.querySelector('[data-testid="results-stage"]').getBoundingClientRect();
      const side = document.querySelector('.results-side')?.getBoundingClientRect();
      return { besideStage: side ? side.left >= stage.right - 2 : false };
    });
    check(`operator @${width}: ${width >= 1024 ? 'the control panel sits beside the stage' : 'one column, the panel below the stage'}`, layout.besideStage === (width >= 1024));
    const bar = await byId(H, 'dismiss-vote').evaluate((el) => (el.closest('.bar-actions') ? 'top' : el.closest('.bar-bottom') ? 'bottom' : 'none'));
    check(`operator @${width}: the vote actions sit in the ${width >= 1024 ? 'top' : 'bottom'} bar`, bar === (width >= 1024 ? 'top' : 'bottom'), bar);
    await byId(H, 'reveal-all').click();
    await byId(H, 'result-graph').waitFor();
    await noOverflow(H, `operator graph @${width}`);
    await byId(H, 'reveal-one').click();
    await byId(H, 'result-paper').waitFor();
  }
  check('operator fit: page errors', problems.length === 0, problems.join(' | '));
  await host.ctx.close();
}

mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) if (file.startsWith('results-')) rmSync(path.join(OUT, file));
const vite = await startViteNode();
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  await runFreeform(browser);
  await runChoice(browser);
  await runEdges(browser);
  await runOperatorFit(browser);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
