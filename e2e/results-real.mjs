// The results screens against the real server: an anonymous free-form vote and a named choice vote, a host, three
// phones and two displays. The server serves the built web app, so run `npm run build` first.
// Run from the project root: npx tsx e2e/results-real.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { EDGE, byId, check, failures } from './kit.mjs';

const PORT = 3102;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const text = async (page, id) => ((await byId(page, id).textContent()) ?? '').trim();
const wait = (page, id, expected) =>
  page.waitForFunction(([i, e]) => document.querySelector(`[data-testid="${i}"]`)?.textContent?.trim() === e, [id, expected]);
const NICKS = ['하늘', '민준', '서연'];
const PAPERS = ['발표 자료 같이 만들어 줘서 고마웠어요', '맨날 청소를 먼저 해 주는 사람', '가장 조용히 도와준 사람'];

let browser;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) break;
    } catch {
      /* the server is still starting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_/.test(m.text())) errors.push(`${who}: ${m.text()}`);
    });
  };

  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const host = await hostCtx.newPage();
  watch(host, 'host');
  await host.goto(BASE);
  await byId(host, 'home-create-room').click();
  await host.waitForURL(/\/host\/\d{4}$/);
  const code = (await byId(host, 'room-code').innerText()).replace(/\s+/g, '');

  const phones = [];
  for (const nick of NICKS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
    const page = await ctx.newPage();
    watch(page, nick);
    await page.goto(`${BASE}/r/${code}?nick=${encodeURIComponent(nick)}`);
    await byId(page, 'my-nickname').waitFor();
    phones.push({ ctx, page });
  }

  await byId(host, 'open-display').click();
  const link = await byId(host, 'display-link').inputValue();
  check('real: the display link carries the code and a token', new RegExp(`/d/${code}/[\\w-]{16,}$`).test(link), link);
  const popup = host.context().waitForEvent('page');
  await byId(host, 'display-open-window').click();
  const displayPage = await popup;
  watch(displayPage, 'display');
  await byId(displayPage, 'display-lobby').waitFor();
  await wait(displayPage, 'display-count', '3');
  check('real: the display lobby lists the three people', (await byId(displayPage, 'display-chip').count()) === 3);
  await host.keyboard.press('Escape');

  const displayCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR' });
  const display2 = await displayCtx.newPage();
  watch(display2, 'display2');
  await display2.goto(link);
  await byId(display2, 'display-lobby').waitFor();

  const start = async (title, kind, anonymity, options = []) => {
    await byId(host, 'open-composer').click();
    await byId(host, 'vote-title').fill(title);
    await byId(host, kind === 'choice' ? 'paper-choice' : 'paper-freeform').click();
    await byId(host, anonymity === 'named' ? 'anon-named' : 'anon-anonymous').click();
    for (let i = 0; i < options.length; i++) {
      if (i >= 2) await byId(host, 'option-add').click();
      await byId(host, `option-input-${i}`).fill(options[i]);
    }
    await byId(host, 'start-vote').click();
    await byId(host, 'submitted-count').waitFor();
  };

  await start('이번 달 MVP는?', 'freeform', 'anonymous');
  await byId(displayPage, 'display-voting').waitFor();
  check('real: the display shows the title and 0 / 3', (await text(displayPage, 'display-progress')) === '0 / 3');
  for (let i = 0; i < 3; i++) {
    const page = phones[i].page;
    await byId(page, 'mode-type').click();
    await byId(page, 'ballot-text').fill(PAPERS[i]);
    await byId(page, 'ballot-submit').click();
    await byId(page, 'ballot-confirm').click();
    await byId(page, 'ballot-submitted').waitFor();
  }
  await wait(displayPage, 'display-progress', '3 / 3');
  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').click({ timeout: 1500 }).catch(() => undefined);
  await byId(host, 'result-pile').waitFor();
  await byId(displayPage, 'display-pile').waitFor();
  check('real: close opens the folded pile on the host and the display', (await text(host, 'result-position')) === '0 / 3');

  const seen = [];
  for (let n = 1; n <= 3; n++) {
    await byId(host, 'result-next').click();
    await wait(host, 'result-position', `${n} / 3`);
    await wait(displayPage, 'display-position', `${n} / 3`);
    await byId(displayPage, 'display-paper').waitFor();
    await byId(display2, 'display-paper').waitFor();
    const shown = await byId(displayPage, 'display-paper').locator('.pface-text').textContent();
    seen.push(shown);
    check(`real: paper ${n} is the same on the host and both displays`, shown === (await byId(host, 'result-paper').locator('.pface-text').textContent()) && shown === (await byId(display2, 'display-paper').locator('.pface-text').textContent()));
    const page = await displayPage.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
    check(`real: paper ${n} leaves no nickname and no unopened paper on the display`, NICKS.every((nick) => !page.includes(nick)) && PAPERS.filter((paper) => !seen.includes(paper)).every((paper) => !page.includes(paper)));
    await displayPage.waitForTimeout(1800);
  }
  check('real: the shuffled order showed every paper once', new Set(seen).size === 3 && PAPERS.every((paper) => seen.includes(paper)));

  await byId(host, 'toggle-hidden').click();
  await byId(displayPage, 'display-folded').waitFor();
  check('real: hiding folds the paper on the display and leaves no content', (await byId(displayPage, 'display-paper').count()) === 0 && !(await displayPage.evaluate(() => document.documentElement.outerHTML)).includes(seen[2]));
  await byId(host, 'toggle-hidden').click();
  await byId(displayPage, 'display-paper').waitFor();

  await displayPage.reload();
  await byId(displayPage, 'display-paper').waitFor();
  check('real: a reloaded display resumes on the same paper', (await text(displayPage, 'display-position')) === '3 / 3');

  await byId(host, 'toggle-author').click();
  const label = await text(host, 'author-label');
  check('real: the host sees the writer only when asked, and the display still does not', NICKS.some((nick) => label.includes(nick)));
  const displayHtml = await displayPage.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
  check('real: the writer is not on the display', NICKS.every((nick) => !displayHtml.includes(nick)));
  await byId(host, 'result-prev').click();
  await wait(host, 'result-position', '2 / 3');
  await byId(host, 'dismiss-vote').click();
  await byId(host, 'open-composer').waitFor();
  await byId(displayPage, 'display-lobby').waitFor();

  await start('점심 메뉴는?', 'choice', 'named', ['김치찜', '돈가스', '비빔밥']);
  const picks = [0, 0, 2];
  for (let i = 0; i < 3; i++) {
    const page = phones[i].page;
    await byId(page, `ballot-option-${picks[i]}`).click();
    await byId(page, 'ballot-submit').click();
    await byId(page, 'ballot-confirm').click();
    await byId(page, 'ballot-submitted').waitFor();
  }
  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').click({ timeout: 1500 }).catch(() => undefined);
  await byId(host, 'result-pile').waitFor();
  await byId(host, 'result-next').click();
  await byId(displayPage, 'display-paper').waitFor();
  const signature = await text(displayPage, 'display-signature');
  check('real: a named vote signs the paper on the display', NICKS.some((nick) => signature === `— ${nick}`), signature);
  await byId(host, 'reveal-all').click();
  await byId(displayPage, 'display-graph').waitFor();
  const counts = await Promise.all([0, 1, 2].map((i) => text(displayPage, `display-graph-count-${i}`)));
  check('real: the display graph shows 2, 0, 1', counts.join() === '2,0,1', counts.join());
  check('real: the host graph agrees', (await Promise.all([0, 1, 2].map((i) => text(host, `graph-count-${i}`)))).join() === '2,0,1');
  await byId(host, 'toggle-hidden').click();
  await byId(displayPage, 'display-folded').waitFor();
  check('real: hidden withholds the graph from the display', (await byId(displayPage, 'display-graph').count()) === 0);
  await byId(host, 'toggle-hidden').click();
  await byId(host, 'reveal-one').click();
  await byId(host, 'result-paper').waitFor();
  check('real: back to one by one', (await byId(displayPage, 'display-graph').count()) === 0);

  const wrong = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const wrongPage = await wrong.newPage();
  await wrongPage.goto(`${BASE}/d/${code}/${'z'.repeat(24)}`);
  await byId(wrongPage, 'display-error').waitFor();
  check('real: a wrong token gets the plain message', (await text(wrongPage, 'display-error')).includes('주소가 올바르지 않아요'));
  const noRoom = await wrong.newPage();
  await noRoom.goto(`${BASE}/d/9999/${'z'.repeat(24)}`);
  await byId(noRoom, 'display-error').waitFor();
  check('real: a missing room gets the plain message', (await text(noRoom, 'display-error')).includes('방을 찾을 수 없어요'));

  check('real: no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  server.kill();
}

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`);
process.exit(failures.length === 0 ? 0 : 1);
