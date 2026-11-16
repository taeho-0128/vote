// The submit moment, walked against the fake server: the three ballot kinds fold into the box, with frames, phases,
// the vibration, the count, reload, reduced motion, a refused submit and overflow at every width.
// Run from the project root: npx tsx e2e/fold-walk.mjs (the fake server imports shared/*.ts)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { KINDS, OPTIONS, OTHERS, at, buzzesOf, countsOf, join, names, openRoom, phasesOf, submitWithPointer, untilPageTime } from './fold-kit.mjs';
import { EDGE, ORIGIN, OUT, SIZES, box, byId, check, failures, startVite, stopVite } from './kit.mjs';

const OFFSETS = [0.2, 0.7, 1.3, 1.8, 2.6, 3.2, 4.2];
const TEXT = '서연이요!\n발표 자료 같이 만들어 줘서 정말 고마웠어요';

async function drawInk(page) {
  const canvas = byId(page, 'ink-canvas');
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await box(canvas);
  const spot = ([x, y]) => [b.x + (x / 1000) * b.width, b.y + (y / 1333) * b.height];
  const stroke = async (points) => {
    await page.mouse.move(...spot(points[0]));
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...spot(p), { steps: 3 });
    await page.mouse.up();
  };
  const wave = (y, amp, turns) => Array.from({ length: 41 }, (_, i) => [120 + (760 * i) / 40, y + Math.sin((i / 40) * Math.PI * 2 * turns) * amp]);
  await stroke(wave(200, 40, 3));
  await byId(page, 'tool-pen-thick').click();
  await stroke([[150, 250], [230, 340], [370, 130]]);
  await byId(page, 'tool-pen').click();
  await stroke(wave(380, 28, 4));
  await stroke(Array.from({ length: 25 }, (_, i) => [500 + Math.cos((i / 24) * Math.PI * 2) * 160, 700 + Math.sin((i / 24) * Math.PI * 2) * 160]));
  await page.mouse.click(...spot([800, 900]));
}

async function writeBallot(page, kind) {
  if (kind === 'ink') await drawInk(page);
  if (kind === 'text') {
    await byId(page, 'mode-type').check();
    await byId(page, 'ballot-text').fill(TEXT);
  }
  if (kind === 'choice') await byId(page, 'ballot-option-2').click();
}

async function submitWithKeyboard(page) {
  await byId(page, 'ballot-submit').focus();
  await page.keyboard.press('Enter');
  await byId(page, 'ballot-cancel').waitFor();
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  await page.keyboard.press('Tab');
  const second = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  await page.keyboard.press('Enter');
  return { first, second };
}

const metrics = (page) =>
  page.evaluate(() => {
    const title = document.querySelector('[data-testid="vote-title-view"]')?.getBoundingClientRect();
    const badge = document.querySelector('[data-testid="anon-badge"]')?.getBoundingClientRect();
    const scene = document.querySelector('.scene')?.getBoundingClientRect();
    return {
      t: performance.now(),
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      titleTop: title?.top ?? NaN,
      titleVisible: !!title && title.width > 0,
      badgeVisible: !!badge && badge.width > 0,
      sceneBottom: scene?.bottom ?? NaN,
      sceneWidth: scene?.width ?? NaN,
    };
  });

async function checkFace(page, kind, tag) {
  const face = page.locator('.fold-face .pface');
  const sheet = await face.count();
  check(`${tag}: the folding paper carries a face`, sheet === 1);
  if (kind === 'ink') {
    const parts = await face.locator('.pface-ink').evaluate((svg) => ({ paths: svg.querySelectorAll('path').length, dots: svg.querySelectorAll('circle').length }));
    check(`${tag}: the face draws every stroke the participant wrote`, parts.paths === 4 && parts.dots === 1, JSON.stringify(parts));
  }
  if (kind === 'text') {
    check(`${tag}: the face shows the typed text and the signature`, (await face.locator('.pface-text').textContent()) === TEXT && (await face.locator('.pface-sig').textContent()) === '— 하늘');
    const hand = await face.locator('.pface-sheet').evaluate((el) => getComputedStyle(el).fontFamily);
    check(`${tag}: the face writes in the hand font`, hand.includes('Nanum Pen Script'), hand);
  }
  if (kind === 'choice') {
    const options = await face.locator('.pface-opt span').allInnerTexts();
    const ringed = await face.locator('.pface-opt:has(.pface-ring) span').allInnerTexts();
    check(`${tag}: the face lists every option and rings only the chosen one`, options.join() === OPTIONS.join() && ringed.join() === '비빔밥', `${options} / ${ringed}`);
    check(`${tag}: the choice face is signed`, (await face.locator('.pface-sig').textContent()) === '— 하늘');
  }
}

async function runKind(browser, size, kind, { frames, keyboard }) {
  const tag = `${kind} @${size.width}`;
  const problems = [];
  const room = openRoom(kind);
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await writeBallot(page, kind);

  check(`${tag}: writing phase before submit`, (await byId(page, 'fold-stage').getAttribute('data-phase')) === 'writing' && (await byId(page, 'ballot-box').count()) === 0);
  room.latency = 700;
  let keys = null;
  if (keyboard) keys = await submitWithKeyboard(page);
  else await submitWithPointer(page);
  if (keys) check(`${tag}: keyboard opens the confirm on 돌아가기 and Tab reaches 제출하기`, keys.first === 'ballot-cancel' && keys.second === 'ballot-confirm', JSON.stringify(keys));

  await byId(page, 'ballot-sending').waitFor();
  check(`${tag}: sending shows 제출하는 중… and locks the paper and button`, (await byId(page, 'ballot-sending').textContent())?.includes('제출하는 중…') === true && (await byId(page, 'ballot-submit').isDisabled()) && (await byId(page, 'fold-stage').evaluate((el) => el.inert)) && (await byId(page, 'fold-stage').getAttribute('data-phase')) === 'sending');
  check(`${tag}: focus moves to the sending status`, (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'ballot-sending');
  check(`${tag}: no animation runs while sending`, (await page.evaluate(() => document.querySelectorAll('.scene').length)) === 0);
  if (frames) {
    await page.screenshot({ path: path.join(OUT, `fold-${kind}-${size.width}-sending.png`) });
  }
  room.latency = 0;

  await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'folding'));
  const start = at(await phasesOf(page), 'folding');
  await checkFace(page, kind, tag);

  const shots = [];
  for (const [i, offset] of OFFSETS.entries()) {
    await untilPageTime(page, start + offset * 1000);
    const m = await metrics(page);
    if (frames) await page.screenshot({ path: path.join(OUT, `fold-${kind}-${size.width}-${i + 1}.png`) });
    shots.push({ offset, ...m, lag: m.t - start - offset * 1000 });
  }
  await byId(page, 'ballot-submitted').waitFor();

  const phases = await phasesOf(page);
  check(`${tag}: stage phases run writing, sending, folding, done in order`, names(phases) === 'writing,sending,folding,done', names(phases));
  const done = at(phases, 'done') - start;
  check(`${tag}: folding lasts about 3.4 to 3.9 seconds`, done > 3300 && done < 4000, `${Math.round(done)}ms`);

  const buzzes = await buzzesOf(page);
  check(`${tag}: the phone buzzes exactly once for 30 ms`, buzzes.length === 1 && buzzes[0].pattern === 30, JSON.stringify(buzzes));
  const landing = buzzes[0] ? buzzes[0].t - start : NaN;
  check(`${tag}: the buzz comes when the slip lands`, landing > 2950 && landing < 3500, `${Math.round(landing)}ms`);

  const counts = await countsOf(page);
  check(`${tag}: the count rises from ${OTHERS} to ${OTHERS + 1} and stays`, counts.join() === `${OTHERS},${OTHERS + 1}`, counts.join());
  check(`${tag}: box-count is the bare number`, (await byId(page, 'box-count').textContent()) === String(OTHERS + 1));

  check(`${tag}: nothing scrolled and the page never overflowed during the moment`, shots.every((s) => s.scrollY === 0 && s.scrollWidth <= s.innerWidth), JSON.stringify(shots.map((s) => [s.scrollY, s.scrollWidth])));
  check(`${tag}: the title and badge stay put and visible during the moment`, shots.every((s) => s.titleVisible && s.badgeVisible && Math.abs(s.titleTop - shots[0].titleTop) < 0.5));
  if (size.width === 390 || size.width === 1280) {
    check(`${tag}: the stage fits the viewport without scrolling`, shots.every((s) => s.scrollHeight <= s.innerHeight && s.sceneBottom <= s.innerHeight), JSON.stringify(shots.map((s) => [s.scrollHeight, s.innerHeight, Math.round(s.sceneBottom)])));
  }
  check(`${tag}: the stage is between 280 and 420 wide`, shots.every((s) => s.sceneWidth >= 279.5 && s.sceneWidth <= 420.5), String(shots[0].sceneWidth));

  const resting = await byId(page, 'fold-stage').getAttribute('data-phase');
  const live = await byId(page, 'ballot-submitted').evaluate((el) => el.closest('[aria-live]')?.getAttribute('aria-live'));
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.closest('[aria-live]')?.getAttribute('aria-live') === 'polite' && !!el.querySelector('[data-testid="ballot-submitted"]');
  });
  check(`${tag}: done says 제출했어요 in a polite live region and focus lands there`, resting === 'done' && live === 'polite' && focus && (await byId(page, 'ballot-submitted').textContent())?.includes('제출했어요. 마감을 기다리는 중이에요.') === true);
  check(`${tag}: the paper and the submit bar are gone after the box takes the ballot`, (await byId(page, 'ballot-submit').count()) === 0 && (await page.locator('.fold-paper').count()) === 0 && (await byId(page, 'ballot-box').isVisible()));
  if (frames) await page.screenshot({ path: path.join(OUT, `fold-${kind}-${size.width}-done.png`) });

  await page.reload();
  await byId(page, 'ballot-submitted').waitFor();
  await page.waitForTimeout(600);
  const after = await phasesOf(page);
  const animations = await page.evaluate(() => document.getAnimations().length);
  check(`${tag}: reload shows the static box at once, with no folding`, names(after) === 'static' && (await countsOf(page)).join() === String(OTHERS + 1) && animations === 0, `${names(after)} ${animations}`);
  check(`${tag}: static plays no buzz`, (await buzzesOf(page)).length === 0);
  check(`${tag}: static fits without overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (frames) await page.screenshot({ path: path.join(OUT, `fold-${kind}-${size.width}-static.png`) });

  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

async function runReduced(browser, size) {
  const tag = `reduced motion @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await writeBallot(page, 'text');
  await submitWithPointer(page);
  await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'folding'));
  const start = at(await phasesOf(page), 'folding');
  await untilPageTime(page, start + 200);
  const during = await page.evaluate(() => ({
    fold: document.querySelector('.fold-top')?.getAnimations().length,
    flap: document.querySelector('.fold-flap')?.getAnimations().length,
    paper: document.querySelector('.fold-paper')?.getAnimations().length,
  }));
  await page.screenshot({ path: path.join(OUT, `fold-reduced-${size.width}-1.png`) });
  check(`${tag}: no fold animates, the paper moves and fades toward the box`, during.fold === 0 && during.flap === 0 && during.paper === 1, JSON.stringify(during));
  await byId(page, 'ballot-submitted').waitFor();
  const phases = await phasesOf(page);
  check(`${tag}: phases still run sending, folding, done`, names(phases) === 'writing,sending,folding,done', names(phases));
  const done = at(phases, 'done') - start;
  check(`${tag}: the simplified moment is short`, done > 400 && done < 1400, `${Math.round(done)}ms`);
  const buzzes = await buzzesOf(page);
  check(`${tag}: one buzz of 30 ms`, buzzes.length === 1 && buzzes[0].pattern === 30, JSON.stringify(buzzes));
  check(`${tag}: the count still rises`, (await countsOf(page)).join() === `${OTHERS},${OTHERS + 1}`);
  await page.screenshot({ path: path.join(OUT, `fold-reduced-${size.width}-done.png`) });
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

async function runRefused(browser, size) {
  const tag = `refused @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await writeBallot(page, 'text');
  room.refuseNext = 'bad_ballot';
  await submitWithPointer(page);
  await byId(page, 'ballot-error').waitFor();
  await page.waitForTimeout(1500);
  const phases = await phasesOf(page);
  check(`${tag}: a refused ballot goes sending then straight back to writing`, names(phases) === 'writing,sending,writing', names(phases));
  check(`${tag}: nothing folded, nothing buzzed, no box`, (await page.locator('.scene').count()) === 0 && (await buzzesOf(page)).length === 0 && (await byId(page, 'ballot-box').count()) === 0);
  check(`${tag}: the error shows, the paper and the button are usable again`, (await byId(page, 'ballot-error').isVisible()) && (await byId(page, 'ballot-submit').isEnabled()) && (await byId(page, 'ballot-text').inputValue()) === TEXT);
  check(`${tag}: focus returns to the submit button`, (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'ballot-submit');
  const callout = await byId(page, 'ballot-error').evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: s.borderLeftWidth, top: s.borderTopWidth };
  });
  check(`${tag}: the error callout has a full 1px border, not a thick side bar`, callout.left === '1px' && callout.top === '1px', JSON.stringify(callout));
  await page.screenshot({ path: path.join(OUT, `fold-refused-${size.width}.png`) });

  await byId(page, 'ballot-submit').click();
  await byId(page, 'ballot-confirm').click();
  await byId(page, 'ballot-submitted').waitFor();
  check(`${tag}: the retry the server accepts does fold`, names(await phasesOf(page)) === 'writing,sending,writing,sending,folding,done');
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

async function runInkNotice(browser, size) {
  const tag = `ink notice @${size.width}`;
  const problems = [];
  const room = openRoom('ink');
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  const canvas = byId(page, 'ink-canvas');
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await box(canvas);
  for (let i = 0; i < 300; i++) await page.mouse.click(b.x + 8 + (i % 20) * ((b.width - 16) / 20), b.y + 8 + Math.floor(i / 20) * ((b.height - 16) / 15));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await byId(page, 'ink-full-notice').waitFor();
  const style = await byId(page, 'ink-full-notice').evaluate((el) => {
    const s = getComputedStyle(el);
    return { left: s.borderLeftWidth, top: s.borderTopWidth, color: s.borderLeftColor, bg: s.backgroundColor };
  });
  check(`${tag}: the full-paper notice has a full 1px border`, style.left === '1px' && style.top === '1px', JSON.stringify(style));
  await page.screenshot({ path: path.join(OUT, `fold-ink-notice-${size.width}.png`) });
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

async function runHardening(browser, size) {
  const tag = `hardening @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  room.vote = { ...room.vote, title: `${'가'.repeat(30)} 이번 달 가장 고마웠던 동료에게 한마디 남겨 주세요 정말로` };
  for (let i = 0; i < 120; i++) room.ballots.set(`x${i}`, { kind: 'text', text: '고마워요' });
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await byId(page, 'mode-type').check();
  await byId(page, 'ballot-text').fill('가나다라마바사아자차'.repeat(20));
  await submitWithPointer(page);
  await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'folding'));
  const start = at(await phasesOf(page), 'folding');
  await untilPageTime(page, start + 1500);
  const mid = await metrics(page);
  check(`${tag}: a long title and a 200-character paper never overflow sideways`, mid.scrollWidth <= mid.innerWidth);
  check(`${tag}: the stage takes the room a long title leaves`, mid.sceneBottom <= mid.innerHeight + 1 || mid.sceneWidth <= 281, JSON.stringify(mid));
  await page.screenshot({ path: path.join(OUT, `fold-long-${size.width}-mid.png`) });
  room.stage = 'closed';
  room.broadcast();
  await byId(page, 'vote-closed-notice').waitFor({ timeout: 8000 });
  const phases = await phasesOf(page);
  const counts = (await countsOf(page)).join();
  check(`${tag}: a vote closing mid-fold still finishes the fold, then says it closed`, names(phases) === 'writing,sending,folding,done' && counts === '127,128', `${names(phases)} ${counts}`);
  await page.screenshot({ path: path.join(OUT, `fold-long-${size.width}-closed.png`) });
  check(`${tag}: a three-digit count stays on the plate`, await byId(page, 'box-count').evaluate((el) => el.getBoundingClientRect().right <= el.closest('.box-plate').getBoundingClientRect().right + 0.5));
  await ctx.close();

  const second = await join(browser, size, openRoom('choice'), '하늘', problems);
  await writeBallot(second.page, 'choice');
  await submitWithPointer(second.page);
  await second.page.waitForFunction(() => window.__phases.some((p) => p.phase === 'folding'));
  await second.page.waitForTimeout(900);
  await second.page.goto(`${ORIGIN}/`);
  await second.page.waitForTimeout(500);
  check(`${tag}: leaving mid-fold cancels cleanly`, problems.length === 0, problems.join(' | '));
  await second.ctx.close();
}

mkdirSync(OUT, { recursive: true });
const vite = await startVite();
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const size of SIZES) {
    const frames = size.width === 390 || size.width === 1280;
    for (const kind of Object.keys(KINDS)) await runKind(browser, size, kind, { frames, keyboard: kind === 'choice' && size.width === 1280 });
  }
  await runReduced(browser, SIZES[0]);
  await runRefused(browser, SIZES[0]);
  await runInkNotice(browser, SIZES[0]);
  await runHardening(browser, SIZES[0]);
  await runHardening(browser, SIZES[2]);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
