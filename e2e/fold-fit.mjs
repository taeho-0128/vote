// Typed text on the paper (D-36, D-42), walked against the fake server: the longest texts the contract accepts must fit the
// writing textarea and the folding face at every paper size, the text sits in the middle of the paper across and down
// the ruled lines in both, the caps hold against typing, paste and Enter, and the sending mark keeps moving under
// reduced motion.
// Run from the project root: npx tsx e2e/fold-fit.mjs (it imports web/src/textFit.ts)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { TEXT_MAX, TEXT_MAX_LINES } from '../shared/vote.ts';
import { fitText, rowsAvailable, rowsNeeded } from '../web/src/textFit.ts';
import { countAgain, geometryOf, inkOf, judge, judgeCount, judgeInk, measure } from './center-kit.mjs';
import { at, join, names, openRoom, phasesOf, submitWithPointer, untilPageTime } from './fold-kit.mjs';
import { EDGE, OUT, byId, check, failures, startVite, stopVite } from './kit.mjs';

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

const cut = (text, count) => [...text].slice(0, count).join('');
const rows = (count, line) => Array.from({ length: count }, () => line).join('\n');
const SENTENCE = '이번 달에는 발표 준비를 도와주고 늦게까지 남아서 자료를 다듬어 준 덕분에 팀 모두가 마음 편하게 발표를 마칠 수 있었어요. 정말 고맙습니다. ';

const TEXTS = {
  short: '서연이요!',
  three: '서연이요!\n발표 자료 같이 만들어 줘서\n정말 고마웠어요',
  paragraph200: cut(SENTENCE.repeat(3), TEXT_MAX),
  lines12: rows(TEXT_MAX_LINES, '가나다라마바사아자차카타파하서'),
  widest200: '빠'.repeat(TEXT_MAX),
  singles12: rows(TEXT_MAX_LINES, '네'),
  shortThenLong: `${rows(11, '네')}\n${cut(SENTENCE.repeat(2), 178)}`,
  latin200: cut('abcdefghijklmno '.repeat(14), TEXT_MAX),
  emoji: `${rows(11, '😀')}\n${'😀'.repeat(80)}`,
};
const PICTURED = ['short', 'three', 'paragraph200', 'lines12'];
const PICTURE_WIDTHS = [390, 1280];

const fontsFor = (page, text) =>
  page.evaluate(async (t) => {
    await document.fonts.load("20px 'Nanum Pen Script'", t);
    await document.fonts.ready;
    return document.fonts.check("20px 'Nanum Pen Script'", t);
  }, text);

const textarea = (page) => byId(page, 'ballot-text');
const SUBMIT_BAR = 90;

// The real textarea's pixels, read in a scratch page. The caret and focus ring are put away first. A paper that reaches
// the page's fixed submit bar has the bar painted over it in a screenshot, so it is skipped.
async function textareaInk(page, analyzer, g, signed) {
  await page.evaluate(() => document.activeElement?.blur());
  const box = await page.locator('.paper').boundingBox();
  if (box.y + box.height > page.viewportSize().height - SUBMIT_BAR) return null;
  const png = await page.locator('.paper').screenshot();
  const widthPx = box.width;
  const limit = Math.round((g.height - (signed ? g.padBottom : 0)) * widthPx);
  return inkOf(analyzer, png, limit);
}

// Rows a browser draws for this element's text at its own width, size and wrapping, measured on a hidden copy.
const MEASURE = `(el) => {
  const cs = getComputedStyle(el);
  const field = 'value' in el;
  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', left: '0', top: '0',
    width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 'px',
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal',
  });
  mirror.textContent = field ? el.value : el.textContent;
  document.body.append(mirror);
  const drawn = mirror.getBoundingClientRect().height / parseFloat(cs.lineHeight);
  mirror.remove();
  const paper = el.closest(field ? '.paper' : '.pface').clientWidth;
  return { drawn: Math.round(drawn), pitch: parseFloat(cs.lineHeight) / paper, paper };
}`;

const writingMetrics = (page) =>
  page.evaluate(`(() => {
    const el = document.querySelector('[data-testid="ballot-text"]');
    const m = (${MEASURE})(el);
    return { ...m, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, value: el.value };
  })()`);

// Where the last drawn line of the folding face ends, against the paper's box and the signature's reserved strip.
const faceMetrics = (page) =>
  page.evaluate(`(() => {
    const p = document.querySelector('.fold-bot-face .pface-text');
    const face = p.closest('.pface').getBoundingClientRect();
    const m = (${MEASURE})(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = [...range.getClientRects()];
    const sig = document.querySelector('.fold-bot-face .pface-sig')?.getBoundingClientRect();
    return {
      ...m,
      scrollHeight: p.scrollHeight,
      clientHeight: p.clientHeight,
      lastBottom: Math.max(...rects.map((r) => r.bottom)),
      maxRight: Math.max(...rects.map((r) => r.right)),
      minLeft: Math.min(...rects.map((r) => r.left)),
      faceTop: face.top, faceBottom: face.bottom, faceLeft: face.left, faceRight: face.right,
      sigTop: sig ? sig.top : null,
      text: p.textContent,
    };
  })()`);

async function typedCase(browser, analyzer, size, name, { signed, pictured }) {
  const text = TEXTS[name];
  const tag = `${name} ${signed ? 'signed' : 'anonymous'} @${size.width}`;
  const kind = signed ? 'signed' : 'anon';
  const problems = [];
  const room = openRoom('text');
  if (!signed) room.vote = { ...room.vote, anonymity: 'anonymous' };
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await byId(page, 'mode-type').check();
  const loaded = await fontsFor(page, text);
  await byId(page, 'ballot-text').fill(text);
  await page.waitForTimeout(200);

  const w = await writingMetrics(page);
  const model = fitText(text, signed);
  const modeled = rowsNeeded(text, model.pitch);
  check(`${tag}: the hand font is loaded, so the measurements mean something`, loaded);
  check(`${tag}: the typing textarea never scrolls`, w.scrollHeight <= w.clientHeight && w.scrollWidth <= w.clientWidth, `${w.scrollHeight} > ${w.clientHeight}`);
  check(`${tag}: the textarea picked the step the function gave`, Math.abs(w.pitch - model.pitch) < 0.0015, `${w.pitch} vs ${model.pitch}`);
  check(`${tag}: the model never counts fewer rows than the browser draws in the textarea`, w.drawn <= modeled, `${w.drawn} drawn, ${modeled} modeled`);
  console.log(`     ${tag}: pitch ${model.pitch}, lead ${model.lead}, rows drawn ${w.drawn}, modeled ${modeled}, available ${rowsAvailable(model.pitch, signed)}`);

  const wg = await geometryOf(textarea(page));
  const wm = judge(`${tag} textarea`, wg, { pitch: model.pitch, signed, rows: modeled });
  judgeCount(`${tag} textarea`, wg, await countAgain(textarea(page)));
  const ink = await textareaInk(page, analyzer, wg, signed);
  if (ink) judgeInk(`${tag} textarea`, wg, ink);
  console.log(`     ${tag}: textarea block ${Number(wm.vertical.toFixed(2))} lines from the middle`);
  if (pictured) {
    await page.locator('.paper').screenshot({ path: path.join(OUT, `center-write-${name}-${kind}-${size.width}.png`) });
  }

  await submitWithPointer(page);
  await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'folding'));
  const start = at(await phasesOf(page), 'folding');
  await untilPageTime(page, start + 80);
  if (pictured) await page.screenshot({ path: path.join(OUT, `center-fold-${name}-${kind}-${size.width}.png`) });
  const f = await faceMetrics(page);
  check(`${tag}: the folded face shows every character of the text`, f.text === text.trim());
  check(`${tag}: the face is not clipped`, f.scrollHeight <= f.clientHeight, `${f.scrollHeight} > ${f.clientHeight}`);
  check(`${tag}: the last line is inside the paper's box`, f.lastBottom <= f.faceBottom + 0.5 && f.maxRight <= f.faceRight + 0.5 && f.minLeft >= f.faceLeft - 0.5, JSON.stringify({ lastBottom: f.lastBottom, faceBottom: f.faceBottom, maxRight: f.maxRight, faceRight: f.faceRight }));
  if (signed) check(`${tag}: the last line stays above the signature`, f.lastBottom <= f.sigTop + 0.5, `${f.lastBottom} > ${f.sigTop}`);
  check(`${tag}: the face and the textarea agree on the size`, Math.abs(f.pitch - w.pitch) < 0.0015, `${f.pitch} vs ${w.pitch}`);
  check(`${tag}: the model never counts fewer rows than the browser draws on the face`, f.drawn <= modeled, `${f.drawn} drawn, ${modeled} modeled`);
  const fg = await geometryOf(page.locator('.fold-bot-face .pface-text'));
  const fm = judge(`${tag} fold face`, fg, { pitch: model.pitch, signed, rows: modeled });
  judgeCount(`${tag} fold face`, fg, await countAgain(page.locator('.fold-bot-face .pface-text')));
  check(`${tag}: the face and the textarea draw the same rows`, fg.lines.length === wg.lines.length, `${fg.lines.length} vs ${wg.lines.length}`);
  check(`${tag}: the face and the textarea put the block at the same height`, Math.abs(fm.blockTop - wm.blockTop) < 0.004 && Math.abs(fm.blockBottom - wm.blockBottom) < 0.004, `${fm.blockTop} vs ${wm.blockTop}`);
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// The placeholder is one row of text and is centered like any other.
async function emptyCase(browser, analyzer, size, signed) {
  const tag = `empty ${signed ? 'signed' : 'anonymous'} @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  if (!signed) room.vote = { ...room.vote, anonymity: 'anonymous' };
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await byId(page, 'mode-type').check();
  await fontsFor(page, '여기에 적어 주세요');
  await page.waitForTimeout(200);
  const model = fitText('', signed);
  const g = await geometryOf(textarea(page));
  judge(`${tag} placeholder`, g, { pitch: model.pitch, signed, rows: rowsNeeded('', model.pitch) });
  const ink = await textareaInk(page, analyzer, g, signed);
  if (ink) judgeInk(`${tag} placeholder`, g, ink);
  await page.locator('.paper').screenshot({ path: path.join(OUT, `center-write-empty-${signed ? 'signed' : 'anon'}-${size.width}.png`) });
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

async function typingCase(browser, size) {
  const tag = `typing @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await byId(page, 'mode-type').check();
  await fontsFor(page, TEXTS.paragraph200);
  const field = byId(page, 'ballot-text');
  await field.focus();
  const text = TEXTS.paragraph200;
  const seen = [];
  const leads = [];
  const worst = { below: -Infinity, over: -Infinity, vertical: 0, sideways: 0, off: -Infinity, outside: 0 };
  let scrolled = 0;
  for (let i = 0; i < text.length; i += 10) {
    await page.keyboard.insertText(text.slice(i, i + 10));
    const m = await writingMetrics(page);
    seen.push(m.pitch);
    if (m.scrollHeight > m.clientHeight) scrolled += 1;
    const g = await geometryOf(field);
    const pos = measure(g);
    leads.push(Math.round(pos.slots[0]));
    const typedPitch = fitText(m.value, true).pitch;
    const strip = (pos.areaBottom - pos.areaTop) / g.pitch - rowsAvailable(typedPitch, true);
    worst.vertical = Math.max(worst.vertical, Math.abs(pos.vertical));
    worst.over = Math.max(worst.over, Math.abs(pos.vertical) - (0.5 + strip / 2 + pos.offGridLimit + 0.02));
    worst.below = Math.max(worst.below, pos.vertical - pos.offGridLimit);
    worst.sideways = Math.max(worst.sideways, pos.sideways);
    worst.off = Math.max(worst.off, pos.offGrid - pos.offGridLimit);
    if (!pos.inside || !pos.consecutive) worst.outside += 1;
  }
  check(`${tag}: 200 characters typed in tens never make the textarea scroll`, scrolled === 0, `${scrolled} of ${seen.length} steps scrolled`);
  const steps = [...new Set(seen.map((p) => p.toFixed(3)))];
  check(`${tag}: the size only shrinks, in a few steps, while typing`, seen.every((p, i) => i === 0 || p <= seen[i - 1] + 0.0005) && steps.length >= 3 && steps.length <= 9, steps.join(' '));
  check(`${tag}: every step keeps the block within half a ruled line plus half the strip under the last row of the middle, and never below it`, worst.over <= 0 && worst.below <= 0, `worst ${worst.vertical.toFixed(2)} lines, ${worst.over.toFixed(2)} over`);
  check(`${tag}: every step keeps each line centered across the paper`, worst.sideways <= 0.02, `worst ${worst.sideways.toFixed(3)}`);
  check(`${tag}: every step keeps the text on the ruled lines and inside the area, so the caret line is always visible`, worst.off <= 0 && worst.outside === 0, `off ${worst.off.toFixed(3)}, outside ${worst.outside}`);
  check(`${tag}: the lead is a whole number of rows at every step and is smaller at 200 characters than at 10`, leads.every((l) => Number.isInteger(l) && l >= 0) && leads[0] > leads.at(-1), leads.join(' '));
  console.log(`     ${tag}: lead per step ${leads.join(' ')}`);
  check(`${tag}: all 200 characters are there`, [...(await writingMetrics(page)).value].length === TEXT_MAX);
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

const lineCount = (value) => value.split('\n').length;

async function limitsCase(browser, size) {
  const tag = `caps @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  const { ctx, page } = await join(browser, size, room, '하늘', problems);
  await byId(page, 'mode-type').check();
  const field = byId(page, 'ballot-text');
  const value = () => field.inputValue();

  await field.fill(rows(13, '가나다'));
  const filled = await value();
  check(`${tag}: 13 lines set in one go are cut to ${TEXT_MAX_LINES}`, lineCount(filled) === TEXT_MAX_LINES && filled === rows(TEXT_MAX_LINES, '가나다'), JSON.stringify(filled));

  await field.fill('');
  await field.focus();
  await page.keyboard.insertText(rows(13, '가나다'));
  const pasted = await value();
  check(`${tag}: 13 pasted lines are trimmed to ${TEXT_MAX_LINES}`, lineCount(pasted) === TEXT_MAX_LINES, JSON.stringify(pasted));

  await field.fill('');
  await field.focus();
  await page.keyboard.insertText('가'.repeat(250));
  check(`${tag}: 250 pasted characters are trimmed to ${TEXT_MAX}`, [...(await value())].length === TEXT_MAX);
  await field.fill('가'.repeat(250));
  check(`${tag}: 250 characters set in one go are cut to ${TEXT_MAX}`, [...(await value())].length === TEXT_MAX);

  await field.fill(rows(TEXT_MAX_LINES, '가나다'));
  await field.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  check(`${tag}: a 13th Enter at the end adds nothing`, lineCount(await value()) === TEXT_MAX_LINES);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  check(`${tag}: a 13th Enter in the middle adds nothing`, lineCount(await value()) === TEXT_MAX_LINES);
  await page.keyboard.type('라');
  check(`${tag}: typing still works at the line cap`, (await value()).includes('라'));

  await field.fill(rows(5, '가나다'));
  await field.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  check(`${tag}: Enter below the cap still opens a line`, lineCount(await value()) === 6);

  await field.fill(`가\t나${'\n'.repeat(3)}다`);
  check(`${tag}: a pasted tab becomes a space`, !(await value()).includes('\t'));

  const w = await writingMetrics(page);
  check(`${tag}: the counter keeps counting characters`, (await byId(page, 'ballot-count').textContent()) === `${[...w.value].length} / ${TEXT_MAX}`);

  await field.fill(rows(TEXT_MAX_LINES, '가나다'));
  await page.reload();
  await byId(page, 'vote-title-view').waitFor();
  check(`${tag}: a draft with the typed text survives a reload within the caps`, lineCount(await byId(page, 'ballot-text').inputValue()) === TEXT_MAX_LINES);
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

async function spinnerCase(browser, size, reduced) {
  const tag = `sending mark ${reduced ? 'under reduced motion' : 'with motion'} @${size.width}`;
  const problems = [];
  const room = openRoom('text');
  const { ctx, page } = await join(browser, size, room, '하늘', problems, { reduced });
  await byId(page, 'mode-type').check();
  await byId(page, 'ballot-text').fill('고마워요');
  room.latency = 2500;
  await submitWithPointer(page);
  await byId(page, 'ballot-sending').waitFor();
  await page.waitForTimeout(300);
  const running = await page.evaluate(() =>
    document.getAnimations().map((a) => ({ name: a.animationName, state: a.playState, target: a.effect?.target?.className })),
  );
  const mine = running.filter((a) => a.target === 'spinner');
  check(`${tag}: the spinner has a running animation`, mine.length === 1 && mine[0].state === 'running', JSON.stringify(running));
  if (reduced) {
    check(`${tag}: it is the in-place pulse, not a spin`, mine[0]?.name === 'spinner-pulse');
    const readings = [];
    for (let i = 0; i < 6; i++) {
      readings.push(await page.evaluate(() => getComputedStyle(document.querySelector('.spinner')).opacity));
      await page.waitForTimeout(220);
    }
    const lo = Math.min(...readings.map(Number));
    const hi = Math.max(...readings.map(Number));
    check(`${tag}: its opacity visibly changes over time`, hi - lo > 0.2 && hi <= 1, readings.join(' '));
    check(`${tag}: nothing else animates`, running.every((a) => a.target === 'spinner'), JSON.stringify(running));
  } else {
    check(`${tag}: it spins`, mine[0]?.name === 'spin');
  }
  await page.screenshot({ path: path.join(OUT, `fit-sending-${reduced ? 'reduced' : 'motion'}-${size.width}.png`) });
  room.latency = 0;
  await byId(page, 'ballot-submitted').waitFor({ timeout: 8000 });
  check(`${tag}: the moment still ends in the done state`, names(await phasesOf(page)) === 'writing,sending,folding,done');
  check(`${tag}: page errors`, problems.length === 0, problems.join(' | '));
  await ctx.close();
}

mkdirSync(OUT, { recursive: true });
const vite = await startVite();
let browser;
let analyzer;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  analyzer = await (await browser.newContext()).newPage();
  for (const size of WIDTHS) {
    for (const name of Object.keys(TEXTS)) {
      await typedCase(browser, analyzer, size, name, { signed: true, pictured: PICTURED.includes(name) && PICTURE_WIDTHS.includes(size.width) });
    }
  }
  for (const size of WIDTHS.slice(1)) {
    for (const name of Object.keys(TEXTS)) {
      await typedCase(browser, analyzer, size, name, { signed: false, pictured: PICTURED.includes(name) && PICTURE_WIDTHS.includes(size.width) });
    }
  }
  for (const size of WIDTHS) {
    for (const signed of [true, false]) await emptyCase(browser, analyzer, size, signed);
  }
  await typingCase(browser, WIDTHS[0]);
  await typingCase(browser, WIDTHS[1]);
  await limitsCase(browser, WIDTHS[1]);
  await spinnerCase(browser, WIDTHS[1], true);
  await spinnerCase(browser, WIDTHS[1], false);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
