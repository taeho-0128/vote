// Every screen at every width. One fake room lives through its whole lifecycle with a host, participants and a display,
// and each state it passes through is swept: nine widths and a landscape phone for the operator and participant screens,
// five frames for the display. Each sweep audits the page and keeps screenshots and a contact sheet in e2e/out.
import { DISPLAY_SIZES, OPERATOR_SIZES, contactSheet, focusAudit, sweep } from './finish-kit.mjs';
import { check, byId, joinAs, ORIGIN, settle, watchPage } from './kit.mjs';
import { INK, NICKS, OPTIONS, closeVote, composeVote, newRoom, openDisplay, openHost } from './results-kit.mjs';

const HOST = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const filter = process.argv[3];

const sheets = [];

async function states(browser, page, name, sizes, options) {
  if (filter && !name.includes(filter)) return;
  const files = await sweep(page, name, sizes, options);
  const narrow = files.filter((f) => !/-(768|1024|1280|1440|1920)x/.test(f));
  const wide = files.filter((f) => /-(768|1024|1280|1440|1920)x/.test(f));
  for (const [part, group] of [['n', narrow], ['w', wide]]) {
    if (group.length === 0) continue;
    const total = group.reduce((sum, f) => sum + Number(/-(\d+)x\d+\.png$/.exec(f)[1]), 0);
    sheets.push(await contactSheet(browser, `${name}-${part}`, group, { scale: Math.min(1, 2400 / (total + group.length * 10)) }));
  }
  await page.setViewportSize(options?.restore ?? HOST);
  await settle(page);
}

const drawInk = async (page) => {
  const canvas = byId(page, 'ink-canvas');
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  for (const [fx, fy, tx, ty] of [[0.2, 0.2, 0.8, 0.3], [0.2, 0.45, 0.7, 0.6], [0.3, 0.7, 0.6, 0.72]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * ((fx + tx) / 2), box.y + box.height * ((fy + ty) / 2 + 0.05), { steps: 6 });
    await page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 6 });
    await page.mouse.up();
  }
};

async function openPage(browser, room, url, size, problems, { reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}${url}`);
  return { ctx, page };
}

async function staticScreens(browser) {
  const problems = [];
  const room = newRoom();

  const home = await openPage(browser, room, '/', PHONE, problems);
  await byId(home.page, 'home-join').waitFor();
  await states(browser, home.page, 'home', OPERATOR_SIZES);
  await byId(home.page, 'home-join').click();
  await home.page.locator('.form-error').waitFor();
  await states(browser, home.page, 'home-error', OPERATOR_SIZES);
  check('home: keyboard reaches every control and each shows a focus mark', (await focusAudit(home.page)).length === 0, (await focusAudit(home.page)).join());
  await home.ctx.close();

  const nf = await openPage(browser, room, '/nowhere', PHONE, problems);
  await byId(nf.page, 'not-found').waitFor();
  await states(browser, nf.page, 'not-found', OPERATOR_SIZES);
  await nf.ctx.close();

  const form = await openPage(browser, room, `/r/${room.code}`, PHONE, problems);
  await byId(form.page, 'nickname-input').waitFor();
  await states(browser, form.page, 'join-form', OPERATOR_SIZES);
  await byId(form.page, 'nickname-submit').click();
  await form.page.locator('#join-error').waitFor();
  await states(browser, form.page, 'join-form-error', OPERATOR_SIZES);
  await form.ctx.close();

  const wrong = await openPage(browser, room, '/r/9999?nick=%EA%B0%80', PHONE, problems);
  await byId(wrong.page, 'join-error').waitFor();
  await states(browser, wrong.page, 'join-wrong-code', OPERATOR_SIZES);
  await wrong.ctx.close();

  const hostless = await openPage(browser, room, '/host/9999', PHONE, problems);
  await byId(hostless.page, 'host-error').waitFor();
  await states(browser, hostless.page, 'host-error', OPERATOR_SIZES);
  await hostless.ctx.close();

  const badDisplay = await openPage(browser, room, `/d/${room.code}/${'x'.repeat(24)}`, { width: 1920, height: 1080 }, problems);
  await byId(badDisplay.page, 'display-error').waitFor();
  await states(browser, badDisplay.page, 'disp-error', DISPLAY_SIZES, { fullPage: false, restore: { width: 1920, height: 1080 } });
  await badDisplay.ctx.close();
  check('static screens: page errors', problems.length === 0, problems.join(' | '));
}

async function lifecycle(browser) {
  const problems = [];
  const room = newRoom();
  const host = await openHost(browser, room, HOST, { problems });
  const H = host.page;
  const disp = await openDisplay(browser, room, { width: 1920, height: 1080 }, { problems });
  const D = disp.page;
  const part = await joinAs(browser, PHONE, room, '현지', problems);
  const P = part.page;
  const DISP = { fullPage: false, restore: { width: 1920, height: 1080 } };

  await states(browser, H, 'host-lobby', OPERATOR_SIZES);
  await states(browser, P, 'p-lobby', OPERATOR_SIZES, { restore: PHONE });
  await states(browser, D, 'disp-lobby', DISPLAY_SIZES, DISP);
  room.fill(60);
  room.add('아주긴닉네임이름여덟');
  await H.waitForTimeout(300);
  await states(browser, H, 'host-lobby-many', OPERATOR_SIZES);
  await states(browser, D, 'disp-lobby-many', DISPLAY_SIZES, DISP);
  await states(browser, P, 'p-lobby-many', OPERATOR_SIZES, { restore: PHONE });

  await byId(H, 'open-composer').click();
  await byId(H, 'vote-title').fill('이번 모임에서 가장 좋았던 순간은 언제였나요?');
  await states(browser, H, 'host-composer', OPERATOR_SIZES);
  await byId(H, 'paper-choice').check();
  for (let i = 0; i < OPTIONS.length; i++) {
    if (i >= 2) await byId(H, 'option-add').click();
    await byId(H, `option-input-${i}`).fill(OPTIONS[i]);
  }
  for (let i = 4; i < 8; i++) {
    await byId(H, 'option-add').click();
    await byId(H, `option-input-${i}`).fill(`아주 긴 보기 이름 ${i + 1}번 점심 메뉴 후보`);
  }
  await byId(H, 'vote-title').fill('가'.repeat(60));
  await states(browser, H, 'host-composer-choice-full', OPERATOR_SIZES);
  await byId(H, 'vote-title').fill('x'.repeat(70));
  await states(browser, H, 'host-composer-error', OPERATOR_SIZES);
  await byId(H, 'cancel-composer').click();

  await composeVote(H, { title: '이번 모임에서 가장 좋았던 순간은 언제였나요?', kind: 'freeform', anonymity: 'anonymous' });
  await P.locator('[data-testid="fold-stage"]').waitFor();
  await states(browser, P, 'p-write-ink', OPERATOR_SIZES, { restore: PHONE });
  await drawInk(P);
  await states(browser, P, 'p-write-ink-drawn', OPERATOR_SIZES, { restore: PHONE });
  await byId(P, 'mode-type').check();
  await byId(P, 'ballot-text').fill('오늘 모임에서 가장 기억에 남는 순간은 처음 만난 사람들과 함께 웃으며 이야기를 나누던 시간이었어요.');
  await states(browser, P, 'p-write-type', OPERATOR_SIZES, { restore: PHONE });
  await byId(P, 'ballot-submit').click();
  await byId(P, 'ballot-confirm').waitFor();
  await states(browser, P, 'p-confirm', OPERATOR_SIZES, { restore: PHONE });
  await byId(P, 'ballot-cancel').click();

  await states(browser, H, 'host-voting', OPERATOR_SIZES);
  await states(browser, D, 'disp-voting', DISPLAY_SIZES, DISP);
  await byId(H, 'open-display').click();
  await byId(H, 'display-link').waitFor();
  await states(browser, H, 'host-display-dialog', OPERATOR_SIZES);
  await byId(H, 'display-close').click();

  await byId(P, 'ballot-submit').click();
  await byId(P, 'ballot-confirm').click();
  await byId(P, 'ballot-submitted').waitFor();
  await P.waitForTimeout(4500);
  await states(browser, P, 'p-submitted', OPERATOR_SIZES, { restore: PHONE });
  NICKS.slice(0, 5).forEach((nick, i) => room.submitAs(nick, i === 2 ? { kind: 'ink', strokes: INK } : { kind: 'text', text: `${i + 1}번째 의견이에요. 점심은 국밥이 좋겠어요` }));
  await H.waitForTimeout(300);
  await byId(H, 'close-vote').click();
  await byId(H, 'confirm-close').waitFor();
  await states(browser, H, 'host-close-confirm', OPERATOR_SIZES);
  await byId(H, 'confirm-close').click();
  await byId(H, 'result-pile').waitFor();
  await states(browser, H, 'host-results-pile', OPERATOR_SIZES);
  await states(browser, D, 'disp-pile', DISPLAY_SIZES, DISP);
  await states(browser, P, 'p-closed', OPERATOR_SIZES, { restore: PHONE });

  await byId(H, 'result-next').click();
  await byId(H, 'result-paper').waitFor();
  await H.waitForTimeout(2200);
  await states(browser, H, 'host-results-paper', OPERATOR_SIZES);
  await states(browser, D, 'disp-paper', DISPLAY_SIZES, DISP);
  await H.setViewportSize(PHONE);
  await byId(H, 'settings-toggle').click();
  await H.setViewportSize(HOST);
  await byId(H, 'toggle-author').click();
  await states(browser, H, 'host-results-author', OPERATOR_SIZES);
  await byId(H, 'toggle-hidden').click();
  await H.waitForTimeout(500);
  await states(browser, H, 'host-results-hidden', OPERATOR_SIZES);
  await states(browser, D, 'disp-hidden', DISPLAY_SIZES, DISP);
  await byId(H, 'toggle-hidden').click();
  await H.waitForTimeout(400);
  for (let i = 0; i < 5; i++) {
    const at = await byId(H, 'result-position').textContent();
    if (at?.startsWith('5')) break;
    await byId(H, 'result-next').click();
    await H.waitForTimeout(450);
  }
  await H.waitForTimeout(1800);
  await states(browser, H, 'host-results-last', OPERATOR_SIZES);

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'export-confirm').waitFor();
  await states(browser, H, 'host-dismiss-confirm', OPERATOR_SIZES);
  await H.keyboard.press('Escape');

  await byId(H, 'result-prev').click();
  await H.waitForTimeout(300);
  await byId(H, 'result-paper').waitFor();
  room.setExpiresIn(24 * 60_000 + 20_000);
  await byId(H, 'expiry-banner').waitFor();
  await states(browser, H, 'host-results-expiry', OPERATOR_SIZES);
  room.setExpiresIn(41_000);
  await H.waitForTimeout(400);
  await states(browser, H, 'host-results-expiry-seconds', [OPERATOR_SIZES[0], OPERATOR_SIZES[2], OPERATOR_SIZES[5]]);
  room.setExpiresIn(6 * 3600 * 1000);
  await H.waitForTimeout(300);

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'export-confirm-skip').click();
  await byId(H, 'open-composer').waitFor();

  await composeVote(H, { title: '어디서 점심을 먹을까요?', kind: 'choice', anonymity: 'named', options: OPTIONS });
  await states(browser, H, 'host-voting-named', OPERATOR_SIZES);
  await byId(P, 'ballot-option-1').waitFor();
  await states(browser, P, 'p-choice', OPERATOR_SIZES, { restore: PHONE });
  await byId(P, 'ballot-option-1').check();
  await states(browser, P, 'p-choice-picked', OPERATOR_SIZES, { restore: PHONE });
  room.submitAs('민준', { kind: 'choice', optionIndex: 1 });
  room.submitAs('서연', { kind: 'choice', optionIndex: 1 });
  room.submitAs('지후', { kind: 'choice', optionIndex: 3 });
  room.submitAs('도윤', { kind: 'choice', optionIndex: 0 });
  await closeVote(H);
  await byId(H, 'result-next').click();
  await byId(H, 'result-paper').waitFor();
  await H.waitForTimeout(2200);
  await states(browser, H, 'host-results-choice-paper', OPERATOR_SIZES);
  await states(browser, D, 'disp-choice-paper', DISPLAY_SIZES, DISP);
  await byId(H, 'reveal-all').click();
  await byId(H, 'result-graph').waitFor();
  await H.waitForTimeout(1300);
  await states(browser, H, 'host-results-graph', OPERATOR_SIZES);
  await states(browser, D, 'disp-graph', DISPLAY_SIZES, DISP);
  await byId(H, 'reveal-one').click();
  await byId(H, 'dismiss-vote').click();
  await byId(H, 'export-confirm-skip').click();

  await composeVote(H, { title: '아무도 안 낸 투표', kind: 'freeform', anonymity: 'anonymous' });
  await closeVote(H);
  await byId(H, 'results-empty').waitFor();
  await states(browser, H, 'host-results-empty', OPERATOR_SIZES);
  await states(browser, D, 'disp-empty', DISPLAY_SIZES, DISP);

  check('lifecycle: page errors', problems.length === 0, problems.join(' | '));
  await Promise.all([host.ctx.close(), disp.ctx.close(), part.ctx.close()]);
}

export async function runLayout(browser) {
  await staticScreens(browser);
  await lifecycle(browser);
  console.log(`contact sheets: ${sheets.filter(Boolean).length}`);
}
