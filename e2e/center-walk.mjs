// Typed text in the middle of the paper (D-42) on the screens that show a finished vote: the host's results, the public
// display and the printed report. The writing screen and the fold are in fold-fit.mjs.
// Run from the project root: npx tsx e2e/center-walk.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { TEXT_MAX, TEXT_MAX_LINES } from '../shared/vote.ts';
import { fitText, rowsNeeded } from '../web/src/textFit.ts';
import { countAgain, geometryOf, judge, judgeCount } from './center-kit.mjs';
import { pdfPages, stubPrint } from './finish-kit.mjs';
import { NICKS, newRoom, openDisplay, waitRest } from './results-kit.mjs';
import { EDGE, ORIGIN, OUT, byId, check, failures, startViteNode, stopVite, watchPage } from './kit.mjs';

const cut = (text, count) => [...text].slice(0, count).join('');
const rows = (count, line) => Array.from({ length: count }, () => line).join('\n');
const SENTENCE = '이번 달에는 발표 준비를 도와주고 늦게까지 남아서 자료를 다듬어 준 덕분에 팀 모두가 마음 편하게 발표를 마칠 수 있었어요. 정말 고맙습니다. ';

const TEXTS = {
  short: '서연이요!',
  three: '서연이요!\n발표 자료 같이 만들어 줘서\n정말 고마웠어요',
  paragraph200: cut(SENTENCE.repeat(3), TEXT_MAX),
  lines12: rows(TEXT_MAX_LINES, '가나다라마바사아자차카타파하서'),
  singles12: rows(TEXT_MAX_LINES, '네'),
  widest200: '빠'.repeat(TEXT_MAX),
};
const NAMES = Object.keys(TEXTS);
const PICTURED = ['short', 'three', 'paragraph200', 'lines12'];
const WIDTHS = [
  { display: { width: 390, height: 844 }, host: { width: 390, height: 844 } },
  { display: { width: 1280, height: 720 }, host: { width: 1280, height: 800 } },
];
const TITLE = '이번 달 MVP는 누구인가요?';

// The host's page for a vote that is already closed, so it opens on the results and not on a roster.
async function openClosedHost(browser, room, size, problems) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR' });
  await ctx.addInitScript(([key, token]) => localStorage.setItem(key, token), [`hanpyo:host:${room.code}`, room.hostToken]);
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/host/${room.code}`);
  await byId(page, 'results-stage').waitFor();
  return { ctx, page };
}

// A closed vote of typed papers, in the order the screens will show them.
function closedRoom(signed) {
  const room = newRoom();
  room.vote = { id: 'v1', title: TITLE, anonymity: signed ? 'named' : 'anonymous', paper: { kind: 'freeform' } };
  room.stage = 'voting';
  NAMES.forEach((name, i) => room.ballots.set(room.participants.find((p) => p.nickname === NICKS[i]).id, { kind: 'text', text: TEXTS[name] }));
  room.stage = 'closed';
  room.reveal = { order: [...room.ballots.keys()], cursor: -1, mode: 'one', hidden: false };
  room.broadcast();
  return room;
}

const showPaper = async (room, index, ...pages) => {
  room.reveal.cursor = index;
  room.broadcast();
  const text = TEXTS[NAMES[index]];
  for (const [page, id] of pages) {
    await page.waitForFunction(([testId, wanted]) => document.querySelector(`[data-testid="${testId}"] .pface-text`)?.textContent === wanted, [id, text.trim()]);
    await waitRest(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
  }
};

async function resultsCase(browser, size, signed) {
  const problems = [];
  const kind = signed ? 'signed' : 'anon';
  const room = closedRoom(signed);
  const display = await openDisplay(browser, room, size.display, { problems });
  const host = await openClosedHost(browser, room, size.host, problems);
  await byId(display.page, 'display-pile').waitFor();
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];
    const text = TEXTS[name];
    const model = fitText(text, signed);
    const modeled = rowsNeeded(text, model.pitch);
    await showPaper(room, i, [display.page, 'display-paper'], [host.page, 'result-paper']);
    for (const [who, page, id, shotSize] of [
      ['display', display.page, 'display-paper', size.display],
      ['host', host.page, 'result-paper', size.host],
    ]) {
      const tag = `${name} ${kind} ${who} @${shotSize.width}`;
      const g = await geometryOf(page.locator(`[data-testid="${id}"] .pface-text`));
      const m = judge(tag, g, { pitch: model.pitch, signed, rows: modeled });
      judgeCount(tag, g, await countAgain(page.locator(`[data-testid="${id}"] .pface-text`)));
      console.log(`     ${tag}: block ${Number(m.vertical.toFixed(2))} lines from the middle, ${g.lines.length} rows drawn, ${modeled} modeled`);
      check(`${tag}: the signature is there on a named vote and absent on an anonymous one`, (await page.locator(`[data-testid="${id}"] .pface-sig`).count()) === (signed ? 1 : 0));
      if (PICTURED.includes(name) && (who === 'display' || name === 'lines12')) {
        await page.screenshot({ path: path.join(OUT, `center-${who}-${name}-${kind}-${shotSize.width}.png`) });
      }
    }
  }
  check(`results ${kind} @${size.display.width}: page errors`, problems.length === 0, problems.join(' | '));
  await display.ctx.close();
  await host.ctx.close();
}

async function printCase(browser, signed) {
  const problems = [];
  const kind = signed ? 'signed' : 'anon';
  const room = closedRoom(signed);
  const { ctx, page } = await openClosedHost(browser, room, { width: 1280, height: 800 }, problems);
  await stubPrint(page);
  await byId(page, 'export-pdf').click();
  await byId(page, 'print-report').waitFor({ state: 'attached' });
  await page.waitForFunction(() => window.__prints === 1);
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  const papers = page.locator('[data-testid="print-paper"]');
  const count = await papers.count();
  check(`print ${kind}: one page per paper`, count === NAMES.length, `${count}`);
  for (const phase of ['as counted on screen', 'after beforeprint']) {
    if (phase === 'after beforeprint') {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      await page.waitForTimeout(100);
    }
    for (let i = 0; i < count; i++) {
      const face = papers.nth(i).locator('.pface-text');
      const shown = await face.textContent();
      const name = NAMES.find((n) => TEXTS[n].trim() === shown);
      const text = TEXTS[name];
      const model = fitText(text, signed);
      const tag = `${name} ${kind} print report ${phase}`;
      const pg = await geometryOf(face);
      const pm = judge(tag, pg, { pitch: model.pitch, signed, rows: rowsNeeded(text, model.pitch) });
      judgeCount(tag, pg, await countAgain(face));
      if (phase === 'as counted on screen') console.log(`     ${tag}: block ${Number(pm.vertical.toFixed(2))} lines from the middle`);
      if (phase === 'after beforeprint' && PICTURED.includes(name)) await papers.nth(i).screenshot({ path: path.join(OUT, `center-print-${name}-${kind}.png`) });
    }
  }

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const file = path.join(OUT, `center-print-${kind}.pdf`);
  writeFileSync(file, pdf);
  await page.emulateMedia({ media: 'screen' });
  const rawPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(`print ${kind}: the PDF has a summary page and one page per paper, none added by the offset`, rawPages === 1 + NAMES.length, `${rawPages}`);
  const pages = await pdfPages(file);
  if (pages) {
    check(`print ${kind}: the text reader sees the same number of pages`, pages.length === 1 + NAMES.length, `${pages.length}`);
    NAMES.forEach((name, i) => {
      const squash = (t) => t.replace(/\s+/g, '');
      const body = squash(pages[i + 1] ?? '');
      const sig = signed ? ` ${NICKS[i]}` : '';
      check(`print ${kind}: page ${i + 2} holds all of the paper's text${sig ? ' and its signature' : ''}`, body.includes(squash(TEXTS[name])) && (!signed || body.includes(NICKS[i])), body.slice(0, 40));
    });
  } else {
    console.log('SKIP print text checks: neither pdftotext nor pypdf is available on this machine');
  }
  check(`print ${kind}: page errors`, problems.length === 0, problems.join(' | '));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await ctx.close();
}

mkdirSync(OUT, { recursive: true });
const vite = await startViteNode();
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  for (const size of WIDTHS) {
    for (const signed of [true, false]) await resultsCase(browser, size, signed);
  }
  for (const signed of [true, false]) await printCase(browser, signed);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
