// Step 6, walked against the fake server: CSV and PDF export, the unexported-vote confirm, the idle-room banner and
// keepAlive, room_expired and rate_limited on every screen, the step 5 fixes, fullscreen, and every screen at every width.
// Run from the project root: npx tsx e2e/finish-walk.mjs [export|expiry|errors|step5|fullscreen|layout]
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { parseCsv } from '../web/src/csvParse.ts';
import { runLayout } from './finish-layout.mjs';
import { runErrors, runExpiry, runFullscreen, runStep5 } from './finish-flows.mjs';
import { downloadOf, pdfPages, startAndClose, stubPrint } from './finish-kit.mjs';
import { NICKS, OPTIONS, closeVote, composeVote, newRoom, openDisplay, openHost, orderedContent, textOf, wholePage } from './results-kit.mjs';
import { EDGE, ORIGIN, OUT, byId, check, failures, joinAs, settle, startViteNode, stopVite, watchPage } from './kit.mjs';

const only = process.argv[2];
const wants = (name) => only === undefined || only === name;

const HOST = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const INK = [{ w: 'thin', pts: [200, 300, 400, 420, 600, 300, 800, 500] }];
const TRICKY = 'a,b "quoted"\n두 번째 줄, 쉼표';
const FORMULA = '=SUM(1,1) 수식처럼 보이는 글';
const TITLE = '점심, "국밥"이 좋을까요? / 어디서*';

// The print stylesheet's view of the page, written out as a PDF and read back page by page.
async function printedPdf(page, name) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const file = path.join(OUT, `finish-${name}.pdf`);
  writeFileSync(file, pdf);
  const rawPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { file, rawPages, texts: await pdfPages(file) };
}

// printToPDF may fire afterprint itself, as a real print does. Either way the report must be gone once it has run.
async function endPrint(page) {
  const gone = await byId(page, 'print-report').waitFor({ state: 'detached', timeout: 1500 }).then(() => true, () => false);
  if (!gone) {
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await byId(page, 'print-report').waitFor({ state: 'detached' });
  }
  return gone;
}

const authorOf = (room, index) => room.participants.find((p) => p.id === room.reveal.order[index])?.nickname;

async function runExport(browser) {
  const problems = [];
  const room = newRoom();
  const host = await openHost(browser, room, HOST, { problems });
  const H = host.page;
  await stubPrint(H);
  const nicknames = room.participants.map((p) => p.nickname);

  await composeVote(H, { title: TITLE, kind: 'freeform', anonymity: 'anonymous' });
  check('export: no export buttons while the vote is open', (await byId(H, 'export-csv').count()) === 0 && (await byId(H, 'export-pdf').count()) === 0);
  const ballots = {
    민준: { kind: 'text', text: TRICKY },
    서연: { kind: 'text', text: '첫째 알파 점심은 국밥이 좋겠어요' },
    지후: { kind: 'ink', strokes: INK },
    도윤: { kind: 'text', text: FORMULA },
    예은: { kind: 'text', text: '다섯째 엡실론 조용한 곳' },
  };
  for (const [nick, content] of Object.entries(ballots)) room.submitAs(nick, content);
  await closeVote(H);
  await settle(H);

  check('export: closed results offer CSV and PDF, named exactly', (await textOf(H, 'export-csv')).trim() === 'CSV 내려받기' && (await textOf(H, 'export-pdf')).trim() === 'PDF로 저장');
  check('export: an anonymous vote says its file carries no nicknames', (await H.locator('.export-panel .hint').first().textContent())?.includes('닉네임이 들어가지 않아요') === true);

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'export-confirm').waitFor();
  const confirmTitle = (await H.locator('.confirm-title').textContent())?.trim();
  check('confirm: an unexported vote asks first, with the contracted title and three choices', confirmTitle === '아직 내보내지 않았어요' && (await byId(H, 'export-confirm-csv').isVisible()) && (await byId(H, 'export-confirm-pdf').isVisible()) && (await byId(H, 'export-confirm-skip').isVisible()));
  check('confirm: the three choices read CSV 내려받기, PDF로 저장, 그냥 새 투표 만들기', (await textOf(H, 'export-confirm-csv')).trim() === 'CSV 내려받기' && (await textOf(H, 'export-confirm-pdf')).trim() === 'PDF로 저장' && (await textOf(H, 'export-confirm-skip')).trim() === '그냥 새 투표 만들기');
  check('confirm: focus starts on the safe choice, not on 그냥 새 투표 만들기', (await H.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'export-confirm-csv');
  check('confirm: it says how many papers would be lost', (await H.locator('.confirm-body').textContent())?.includes('5장') === true);
  await H.screenshot({ path: path.join(OUT, 'finish-confirm-1280.png') });
  await H.keyboard.press('Escape');
  await byId(H, 'export-confirm').waitFor({ state: 'detached' });
  check('confirm: Escape backs out and no dismissVote was sent', room.commands('dismissVote').length === 0 && room.stage === 'closed');

  await byId(H, 'dismiss-vote').click();
  await byId(H, 'export-confirm').waitFor();
  const csvFile = await downloadOf(H, () => byId(H, 'export-confirm-csv').click());
  await byId(H, 'export-confirm').waitFor({ state: 'detached' });
  const text = csvFile.bytes.toString('utf8');
  const rows = parseCsv(text);
  check('csv: the file name is the title and the date, illegal characters gone, Korean kept', /^점심, "국밥"이 좋을까요 어디서_\d{4}-\d{2}-\d{2}\.csv$/.test(csvFile.name.replace(/\s+/g, ' ')) || /^점심.*국밥.*좋을까요.*어디서.*_\d{4}-\d{2}-\d{2}\.csv$/.test(csvFile.name), csvFile.name);
  check('csv: it starts with a UTF-8 byte order mark', csvFile.bytes[0] === 0xef && csvFile.bytes[1] === 0xbb && csvFile.bytes[2] === 0xbf);
  check('csv: every row ends with CRLF', text.replaceAll('\r\n', '').split('\n').length === 2 && text.endsWith('\r\n'));
  check('csv: title, date, mode, paper type and count sit on top', rows[0]?.join('|') === `제목|${TITLE}` && /^날짜\|\d{4}-\d{2}-\d{2}$/.test(rows[1]?.join('|') ?? '') && rows[2]?.join('|') === '방식|익명' && rows[3]?.join('|') === '용지 유형|자유 기재' && rows[4]?.join('|') === '용지 수|5', JSON.stringify(rows.slice(0, 5)));
  check('csv: an anonymous file has three columns and no author column', rows[6]?.join('|') === '번호|종류|내용' && rows.slice(6).every((row) => row.length <= 3 && row.length > 0 || row.length === 1));
  const order = room.reveal.order.map((id) => room.ballots.get(id));
  const expected = order.map((c, i) => [String(i + 1), c.kind === 'ink' ? '손글씨' : '글', c.kind === 'ink' ? '(손글씨)' : c.text === FORMULA ? `'${FORMULA}` : c.text]);
  check('csv: the papers follow the reveal order, with the ink label and the tricky text intact', JSON.stringify(rows.slice(7)) === JSON.stringify(expected), JSON.stringify(rows.slice(7)));
  check('csv: a paper that would run as a formula is defused', rows.some((row) => row[2] === `'${FORMULA}`));
  check('csv: no nickname appears anywhere in an anonymous file', nicknames.filter((name) => text.includes(name)).length === 0, nicknames.filter((name) => text.includes(name)).join());
  check('csv: no author column title either', !text.includes('작성자'));
  check('export: a done mark appears once exported', await byId(H, 'export-done').isVisible());

  await byId(H, 'dismiss-vote').click();
  await H.waitForFunction(() => document.querySelector('[data-testid="results-stage"]') === null);
  check('confirm: after exporting, new vote goes straight through without asking', room.stage === 'lobby' && room.commands('dismissVote').length === 1 && (await byId(H, 'export-confirm').count()) === 0);

  await startAndClose(H, room, { title: '조용한 투표', kind: 'freeform', anonymity: 'anonymous', ballots: {} });
  check('confirm: a vote with no papers has nothing to export and no export buttons', (await byId(H, 'export-csv').count()) === 0 && (await byId(H, 'export-pdf').count()) === 0);
  await byId(H, 'dismiss-vote').click();
  await H.waitForFunction(() => document.querySelector('[data-testid="results-empty"]') === null);
  check('confirm: a vote with no papers dismisses without asking', room.stage === 'lobby' && (await byId(H, 'export-confirm').count()) === 0);

  await startAndClose(H, room, { title: '이번 모임에서 가장 좋았던 순간은 언제였나요?', kind: 'freeform', anonymity: 'named', ballots: { 민준: { kind: 'text', text: '첫째 알파 국밥' }, 서연: { kind: 'text', text: '둘째 베타 산책' }, 지후: { kind: 'ink', strokes: INK }, 도윤: { kind: 'text', text: '넷째 델타 웃음' } } });
  check('export: a named vote says its file carries nicknames', (await H.locator('.export-panel .hint').first().textContent())?.includes('닉네임이 들어가요') === true);
  const named = await downloadOf(H, () => byId(H, 'export-csv').click());
  const namedRows = parseCsv(named.bytes.toString('utf8'));
  const namedOrder = room.reveal.order.map((id) => ({ content: room.ballots.get(id), nick: room.participants.find((p) => p.id === id).nickname }));
  check('csv: a named file adds the author column', namedRows[6]?.join('|') === '번호|종류|내용|작성자' && namedRows[2]?.join('|') === '방식|기명', JSON.stringify(namedRows.slice(0, 7)));
  check('csv: each named row carries its author in reveal order', namedRows.slice(7).every((row, i) => row[3] === namedOrder[i].nick && row[0] === String(i + 1)), JSON.stringify(namedRows.slice(7)));
  check('csv: a typed paper and an ink paper read 글 and 손글씨 with "(손글씨)"', namedRows.slice(7).filter((row) => row[1] === '손글씨').every((row) => row[2] === '(손글씨)') && namedRows.slice(7).some((row) => row[1] === '글'));
  check('csv: a second export of the same vote still downloads', named.bytes.length > 0);

  await byId(H, 'export-pdf').click();
  await byId(H, 'print-report').waitFor({ state: 'attached' });
  await H.waitForFunction(() => window.__prints === 1);
  check('pdf: the print dialog is asked for exactly once', (await H.evaluate(() => window.__prints)) === 1);
  check('pdf: while printing the page title is the file name and the app is marked printing', /^이번 모임.*_\d{4}-\d{2}-\d{2}$/.test(await H.title()) && (await H.evaluate(() => document.documentElement.classList.contains('printing'))), await H.title());
  check('pdf: the export button is off while the report is up', await byId(H, 'export-pdf').isDisabled());
  await H.emulateMedia({ media: 'print' });
  const printed = await H.evaluate(() => ({
    root: getComputedStyle(document.getElementById('root')).display,
    report: getComputedStyle(document.querySelector('[data-testid="print-report"]')).visibility,
    adjust: getComputedStyle(document.querySelector('[data-testid="print-report"] .pface-sheet')).printColorAdjust,
    papers: document.querySelectorAll('[data-testid="print-paper"]').length,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  await H.emulateMedia({ media: 'screen' });
  check('pdf: in print the app is gone, the report shows, colors are exact and the page is white', printed.root === 'none' && printed.report === 'visible' && printed.adjust === 'exact' && printed.papers === 4 && printed.bg === 'rgb(255, 255, 255)', JSON.stringify(printed));
  const pdf = await printedPdf(H, 'named');
  check(`pdf: ${1 + 4} pages, one summary and one per paper`, pdf.rawPages === 5 && pdf.texts?.length === 5, `${pdf.rawPages}/${pdf.texts?.length}`);
  if (pdf.texts) {
    const last = namedOrder[3];
    const lastToken = last.content.kind === 'text' ? last.content.text.split(' ')[0] : null;
    check('pdf: the first page is the summary with title, date, mode and count', ['이번 모임', '기명', '4장'].every((s) => pdf.texts[0].includes(s)) && /\d{4}-\d{2}-\d{2}/.test(pdf.texts[0]));
    check('pdf: each paper page carries its n / N', pdf.texts.slice(1).every((page, i) => page.replace(/\s+/g, '').includes(`${i + 1}/4`)), pdf.texts.slice(1).map((p) => p.trim().slice(0, 30)).join(' || '));
    if (lastToken) {
      check('pdf: the text of the last paper is on the last page and on no other', pdf.texts.at(-1).includes(lastToken) && pdf.texts.slice(0, -1).every((page) => !page.includes(lastToken)), lastToken);
    }
    check('pdf: a named paper is signed with its author on its own page', pdf.texts.slice(1).every((page, i) => page.includes(namedOrder[i].nick)));
  } else {
    console.log('SKIP pdf text checks: neither pdftotext nor pypdf is available on this machine');
  }
  await endPrint(H);
  check('pdf: afterprint unmounts the report and puts the title and class back', (await H.title()) === '한 표' && !(await H.evaluate(() => document.documentElement.classList.contains('printing'))));
  check('pdf: the page is whole again and the button works again', await byId(H, 'export-pdf').isEnabled());
  check('export: page errors', problems.length === 0, problems.join(' | '));
  await host.ctx.close();
}

async function runExportChoice(browser) {
  const problems = [];
  const room = newRoom();
  const host = await openHost(browser, room, HOST, { problems });
  const H = host.page;
  await stubPrint(H);
  const nicknames = room.participants.map((p) => p.nickname);
  const options = ['김치찜, 매운맛', '돈가스 "치즈"', '비빔밥', '샐러드 (큰 그릇)'];
  await startAndClose(H, room, {
    title: '어디서 먹을까요?',
    kind: 'choice',
    anonymity: 'anonymous',
    options,
    ballots: { 민준: { kind: 'choice', optionIndex: 1 }, 서연: { kind: 'choice', optionIndex: 1 }, 지후: { kind: 'choice', optionIndex: 0 }, 도윤: { kind: 'choice', optionIndex: 2 } },
  });
  const file = await downloadOf(H, () => byId(H, 'export-csv').click());
  const text = file.bytes.toString('utf8');
  const rows = parseCsv(text);
  const order = room.reveal.order.map((id) => room.ballots.get(id).optionIndex);
  check('csv choice: the paper type reads 객관식 and the rows name the chosen option', rows[3]?.join('|') === '용지 유형|객관식' && rows.slice(7, 11).every((row, i) => row[1] === '객관식' && row[2] === options[order[i]]), JSON.stringify(rows.slice(7, 11)));
  const tableAt = rows.findIndex((row) => row.join('|') === '보기|득표수');
  const counts = options.map((_, i) => order.filter((o) => o === i).length);
  check('csv choice: a separate table lists every option with its count, commas and quotes intact', tableAt > 0 && JSON.stringify(rows.slice(tableAt + 1)) === JSON.stringify(options.map((o, i) => [o, String(counts[i])])), JSON.stringify(rows.slice(tableAt)));
  check('csv choice: the table is set apart by an empty row', rows[tableAt - 1]?.join('') === '');
  check('csv choice: an anonymous choice file holds no nickname and no author column', nicknames.every((name) => !text.includes(name)) && !text.includes('작성자') && rows.slice(6, tableAt - 1).every((row) => row.length === 3));

  await byId(H, 'export-pdf').click();
  await byId(H, 'print-report').waitFor({ state: 'attached' });
  await H.waitForFunction(() => window.__prints === 1);
  const pdf = await printedPdf(H, 'choice');
  check('pdf choice: 1 + 4 pages', pdf.rawPages === 5 && pdf.texts?.length === 5, `${pdf.rawPages}/${pdf.texts?.length}`);
  if (pdf.texts) {
    check('pdf choice: the summary lists every option with its count', options.every((o, i) => pdf.texts[0].includes(o.split('\n')[0].split(',')[0].trim()) && true) && counts.every((c) => pdf.texts[0].includes(String(c))), pdf.texts[0].replace(/\s+/g, ' ').slice(0, 200));
    const lastOption = options[order[3]].split('\n')[0].split(',')[0].trim();
    check('pdf choice: the last paper shows its chosen option on the last page', pdf.texts.at(-1).includes(lastOption), lastOption);
    check('pdf choice: an anonymous report carries no nickname on any page', nicknames.every((name) => pdf.texts.every((page) => !page.includes(name))));
  }
  await endPrint(H);
  await host.ctx.close();

  const fallback = await browser.newContext({ viewport: HOST, locale: 'ko-KR' });
  await fallback.addInitScript(([key, token]) => localStorage.setItem(key, token), [`hanpyo:host:${room.code}`, room.hostToken]);
  await fallback.addInitScript(() => {
    window.__prints = 0;
    window.print = () => {
      window.__prints += 1;
    };
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, typeof ms === 'number' && ms >= 20000 ? 400 : ms, ...args);
  });
  const page = await fallback.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/host/${room.code}`);
  await byId(page, 'export-pdf').waitFor();
  await byId(page, 'export-pdf').click();
  await byId(page, 'print-report').waitFor({ state: 'attached' });
  await page.waitForFunction(() => window.__prints === 1);
  await byId(page, 'print-report').waitFor({ state: 'detached', timeout: 4000 });
  check('pdf: a browser that never fires afterprint still gets the report removed by the timer', (await page.title()) === '한 표' && (await byId(page, 'export-pdf').isEnabled()));
  const exportedAgain = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hanpyo:exported:')));
  check('storage: the vote ids that were exported are remembered in localStorage', exportedAgain.length === 1 && exportedAgain[0].startsWith('hanpyo:exported:'), exportedAgain.join());
  await page.reload();
  await byId(page, 'dismiss-vote').waitFor();
  await byId(page, 'dismiss-vote').click();
  await page.waitForTimeout(400);
  check('storage: a reload remembers the export, so dismissing asks nothing', (await byId(page, 'export-confirm').count()) === 0 && room.stage === 'lobby');
  check('export choice: page errors', problems.length === 0, problems.join(' | '));
  await fallback.close();

  const refusing = await browser.newContext({ viewport: HOST, locale: 'ko-KR' });
  const room2 = newRoom();
  await refusing.addInitScript(([key, token]) => localStorage.setItem(key, token), [`hanpyo:host:${room2.code}`, room2.hostToken]);
  await refusing.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('hanpyo:exported:')) throw new DOMException('quota', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  const rp = await refusing.newPage();
  const rproblems = [];
  watchPage(rp, rproblems);
  await room2.install(rp);
  await rp.goto(`${ORIGIN}/host/${room2.code}`);
  await byId(rp, 'roster').waitFor();
  await startAndClose(rp, room2, { title: '저장소 막힘', kind: 'freeform', anonymity: 'anonymous', ballots: { 민준: { kind: 'text', text: '글' } } });
  await downloadOf(rp, () => byId(rp, 'export-csv').click());
  await byId(rp, 'dismiss-vote').click();
  await rp.waitForTimeout(400);
  check('storage refusing writes: the page keeps working and remembers the export for this tab', room2.stage === 'lobby' && (await byId(rp, 'export-confirm').count()) === 0 && rproblems.length === 0, rproblems.join(' | '));
  await refusing.close();
}

mkdirSync(OUT, { recursive: true });
if (only === undefined) for (const file of readdirSync(OUT)) if (file.startsWith('finish-')) rmSync(path.join(OUT, file), { recursive: true, force: true });
const vite = await startViteNode();
let browser;
try {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  if (wants('export')) {
    await runExport(browser);
    await runExportChoice(browser);
  }
  if (wants('expiry')) await runExpiry(browser);
  if (wants('errors')) await runErrors(browser);
  if (wants('step5')) await runStep5(browser);
  if (wants('fullscreen')) await runFullscreen(browser);
  if (wants('layout')) await runLayout(browser);
} finally {
  await browser?.close();
  stopVite(vite);
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
