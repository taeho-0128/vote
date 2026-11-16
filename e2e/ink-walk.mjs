// The handwriting paper, walked with real mouse and touch input against the fake server:
// drawing, erasing, undo, mode switching, drafts, limits, submits, palm rejection and page scroll.
import { normalizeBallotContent } from '../shared/vote.ts';
import { createFakeRoom } from './fake-server.mjs';
import { ORIGIN, box, byId, check, joinAs, noHorizontalScroll, shot, watchPage } from './kit.mjs';

const PAPER_W = 1000;
const PAPER_H = 1333;
const FREEFORM = { kind: 'freeform' };
const DRAFT_KEY = 'hanpyo:ballot:v1';
const FULL_NOTICE = '용지가 가득 찼어요. 지우거나 되돌려 주세요.';

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const draft = async (page) => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)) ?? 'null');
const strokesOf = async (page) => (await draft(page))?.strokes ?? [];
const count = (page, id) => byId(page, id).count();
const pressed = (page, id) => byId(page, id).getAttribute('aria-pressed');

async function inkPixels(page) {
  await frames(page);
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="ink-canvas"]');
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
}

// Whether any pixel within `r` logical units of the point is inked.
async function inkedNear(page, x, y, r = 6) {
  await frames(page);
  return page.evaluate(
    ([lx, ly, lr, w, h]) => {
      const c = document.querySelector('[data-testid="ink-canvas"]');
      const sx = c.width / w;
      const sy = c.height / h;
      const x0 = Math.max(0, Math.floor((lx - lr) * sx));
      const y0 = Math.max(0, Math.floor((ly - lr) * sy));
      const data = c.getContext('2d').getImageData(x0, y0, Math.max(1, Math.ceil(lr * 2 * sx)), Math.max(1, Math.ceil(lr * 2 * sy))).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    },
    [x, y, r, PAPER_W, PAPER_H],
  );
}

// Brings the canvas to the middle of the viewport, clear of the sticky bars, and maps paper units to screen points.
async function surface(page) {
  const canvas = byId(page, 'ink-canvas');
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = await box(canvas);
  return {
    b,
    at: ([x, y]) => [b.x + (x / PAPER_W) * b.width, b.y + (y / PAPER_H) * b.height],
  };
}

async function drag(page, points, steps = 3) {
  const { at } = await surface(page);
  const [sx, sy] = at(points[0]);
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid'), [sx, sy]);
  if (hit !== 'ink-canvas') throw new Error(`drag starts over ${hit}, not the canvas`);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps });
  await page.mouse.up();
}

const wave = (x0, x1, y, amp, turns = 3) =>
  Array.from({ length: 41 }, (_, i) => [x0 + ((x1 - x0) * i) / 40, y + Math.sin((i / 40) * Math.PI * 2 * turns) * amp]);

const tick = [[150, 250], [230, 340], [370, 130]];

async function writeSample(page) {
  await byId(page, 'tool-pen').click();
  await drag(page, wave(120, 880, 200, 40));
  await byId(page, 'tool-pen-thick').click();
  await drag(page, tick, 6);
  await byId(page, 'tool-pen').click();
  await drag(page, wave(120, 880, 380, 28, 4));
  await drag(page, Array.from({ length: 25 }, (_, i) => [500 + Math.cos((i / 24) * Math.PI * 2) * 160, 700 + Math.sin((i / 24) * Math.PI * 2) * 160]));
}

async function checkLayout(page, tag, size) {
  const paper = await box(page.locator('.paper'));
  const wide = size.width >= 720;
  check(`ink ${tag}: the paper keeps 3:4`, Math.abs(paper.width / paper.height - 0.75) < 0.004, `${paper.width}x${paper.height}`);
  check(`ink ${tag}: the paper fits the page width`, paper.x >= 0 && paper.x + paper.width <= size.width, JSON.stringify(paper));
  const column = Math.min(size.width, 480) - 36;
  const expected = Math.min(column, 420, Math.max(wide ? 320 : 250, (size.height - 470) * 0.75));
  check(`ink ${tag}: paper width follows the height of the screen between its limits`, Math.abs(paper.width - expected) < 1.5, `${paper.width} vs ${expected}`);
  check(`ink ${tag}: ${wide ? 'a larger screen gets at least 320' : 'a phone gets 250 to 300'}`, wide ? paper.width >= 319 : paper.width >= 249 && paper.width <= 301, String(paper.width));
  const seg = await box(page.locator('.seg'));
  check(`ink ${tag}: mode switch spans the paper width above it`, Math.abs(seg.width - paper.width) < 2 && seg.y + seg.height <= paper.y, JSON.stringify({ seg, paper }));
  const tools = await Promise.all(['tool-pen', 'tool-pen-thick', 'tool-eraser', 'tool-undo', 'tool-clear'].map(async (id) => box(byId(page, id))));
  check(`ink ${tag}: every tool is at least 44px and inside the paper width`, tools.every((t) => t.width >= 44 && t.height >= 44 && t.x >= paper.x - 1 && t.x + t.width <= paper.x + paper.width + 1), JSON.stringify(tools));
  check(`ink ${tag}: tools sit below the paper without overlap`, tools.every((t) => t.y >= paper.y + paper.height - 1));
  const touchAction = await byId(page, 'ink-canvas').evaluate((el) => getComputedStyle(el).touchAction);
  check(`ink ${tag}: canvas has touch-action none`, touchAction === 'none', touchAction);
}

async function checkKeyboard(page, tag) {
  await byId(page, 'mode-write').focus();
  await page.keyboard.press('ArrowRight');
  check(`ink ${tag}: arrow key moves the mode switch to typing`, await byId(page, 'mode-type').isChecked());
  await page.keyboard.press('ArrowLeft');
  check(`ink ${tag}: arrow key moves it back to writing`, await byId(page, 'mode-write').isChecked() && (await count(page, 'ink-canvas')) === 1);

  await byId(page, 'mode-write').focus();
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { id: el.getAttribute('data-testid'), style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  check(`ink ${tag}: tab from the mode switch reaches the pen with a visible focus ring`, focus.id === 'tool-pen' && focus.style !== 'none' && focus.width >= 2, JSON.stringify(focus));
  await byId(page, 'tool-pen-thick').focus();
  await page.keyboard.press('Space');
  await byId(page, 'tool-eraser').focus();
  await page.keyboard.press('Enter');
  check(`ink ${tag}: space and enter pick tools`, (await pressed(page, 'tool-eraser')) === 'true' && (await pressed(page, 'tool-pen-thick')) === 'false' && (await pressed(page, 'tool-pen')) === 'false');
  await byId(page, 'tool-pen').click();
  const names = await Promise.all(['tool-pen', 'tool-pen-thick', 'tool-eraser', 'tool-undo', 'tool-clear'].map((id) => byId(page, id).getAttribute('aria-label')));
  check(`ink ${tag}: each tool has its accessible name`, names.join() === '펜,굵은 펜,지우개,되돌리기,전체 지우기', names.join());
  const canvas = byId(page, 'ink-canvas');
  const described = await canvas.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby'))?.textContent ?? '');
  check(`ink ${tag}: canvas is named and described for screen readers`, (await canvas.getAttribute('aria-label')) === '손글씨 용지' && described.includes('손가락이나 펜') && described.includes('타이핑'), described);
}

async function checkDrawing(page, tag, size) {
  check(`ink ${tag}: write is the default mode`, (await byId(page, 'mode-write').isChecked()) && (await count(page, 'ballot-text')) === 0);
  check(`ink ${tag}: pen is the starting tool`, (await pressed(page, 'tool-pen')) === 'true' && (await pressed(page, 'tool-pen-thick')) === 'false' && (await pressed(page, 'tool-eraser')) === 'false');
  check(`ink ${tag}: empty paper has no submit, hint or notice`, (await byId(page, 'ballot-submit').isDisabled()) && (await count(page, 'mode-hint')) === 0 && (await count(page, 'ink-full-notice')) === 0);
  check(`ink ${tag}: undo and clear start disabled`, (await byId(page, 'tool-undo').isDisabled()) && (await byId(page, 'tool-clear').isDisabled()));
  await checkLayout(page, tag, size);
  check(`ink ${tag}: empty canvas has no ink`, (await inkPixels(page)) === 0);
  await noHorizontalScroll(page, `ink empty ${tag}`);
  await shot(page, 'ink-empty', size.width);

  await drag(page, wave(120, 880, 200, 40));
  check(`ink ${tag}: a mouse stroke puts pixels on the canvas`, (await inkPixels(page)) > 200);
  let strokes = await strokesOf(page);
  check(`ink ${tag}: the stroke is stored as thin integer points`, strokes.length === 1 && strokes[0].w === 'thin' && strokes[0].pts.every(Number.isInteger) && strokes[0].pts.length >= 8, JSON.stringify(strokes).slice(0, 120));
  check(`ink ${tag}: the stored stroke stays on the paper`, strokes[0].pts.every((v, i) => v >= 0 && v <= (i % 2 === 0 ? PAPER_W : PAPER_H)));
  check(`ink ${tag}: simplifying thinned the 120 mouse samples`, strokes[0].pts.length < 120 * 2, String(strokes[0].pts.length));
  check(`ink ${tag}: a stroke enables submit and undo and clear`, (await byId(page, 'ballot-submit').isEnabled()) && (await byId(page, 'tool-undo').isEnabled()) && (await byId(page, 'tool-clear').isEnabled()));
  check(`ink ${tag}: the stroke lands where the pointer went`, (await inkedNear(page, 120, 200)) && (await inkedNear(page, 500, 200, 60)));

  await byId(page, 'tool-pen-thick').click();
  check(`ink ${tag}: picking the thick pen flips aria-pressed`, (await pressed(page, 'tool-pen-thick')) === 'true' && (await pressed(page, 'tool-pen')) === 'false');
  await drag(page, tick, 6);
  strokes = await strokesOf(page);
  check(`ink ${tag}: the thick pen stores w thick`, strokes.length === 2 && strokes[1].w === 'thick');
  await byId(page, 'tool-pen').click();

  const tap = await surface(page);
  await page.mouse.click(...tap.at([800, 900]));
  strokes = await strokesOf(page);
  check(`ink ${tag}: a tap stores a dot`, strokes.length === 3 && strokes[2].pts.length === 2, JSON.stringify(strokes[2]));
  check(`ink ${tag}: the dot is painted`, await inkedNear(page, 800, 900, 4));
  await byId(page, 'tool-undo').click();

  await drag(page, [[100, 1000], [300, 1000], [500, 1000], [700, 1000], [900, 1000]]);
  const before = await strokesOf(page);
  check(`ink ${tag}: a long straight stroke is stored with few points`, before.length === 3 && before[2].pts.length === 4, JSON.stringify(before[2]));
  await byId(page, 'tool-eraser').click();
  check(`ink ${tag}: the eraser is pressed and the pens are not`, (await pressed(page, 'tool-eraser')) === 'true' && (await pressed(page, 'tool-pen')) === 'false');
  await drag(page, [[500, 930], [500, 1070]], 8);
  const erased = await strokesOf(page);
  const pieces = erased.filter((s) => s.pts[1] > 900);
  const xs = pieces.map((s) => [Math.min(...s.pts.filter((_, i) => i % 2 === 0)), Math.max(...s.pts.filter((_, i) => i % 2 === 0))]).sort((a, b) => a[0] - b[0]);
  check(`ink ${tag}: erasing across a stroke splits it in two`, erased.length === 4 && pieces.length === 2, `${erased.length} strokes`);
  check(`ink ${tag}: the pieces leave a gap in the middle and keep their ends`, xs.length === 2 && xs[0][1] < 500 && xs[1][0] > 500 && xs[1][0] - xs[0][1] >= 40 && xs[0][0] === 100 && xs[1][1] === 900, JSON.stringify(xs));
  check(`ink ${tag}: the erased gap is blank on the canvas and the rest is inked`, !(await inkedNear(page, 500, 1000, 4)) && (await inkedNear(page, 250, 1000, 6)) && (await inkedNear(page, 750, 1000, 6)));
  check(`ink ${tag}: the other strokes survive the erase`, erased.slice(0, 2).every((s, i) => JSON.stringify(s) === JSON.stringify(before[i])));
  await shot(page, 'ink-erased', size.width);

  await byId(page, 'tool-undo').click();
  const afterUndo = await strokesOf(page);
  check(`ink ${tag}: one undo puts the erased stroke back whole`, JSON.stringify(afterUndo) === JSON.stringify(before) && (await inkedNear(page, 500, 1000, 4)));
  await byId(page, 'tool-undo').click();
  check(`ink ${tag}: the next undo removes the stroke before it`, (await strokesOf(page)).length === 2);

  await byId(page, 'tool-pen').click();
  await drag(page, wave(120, 880, 380, 28, 4));
  await drag(page, Array.from({ length: 25 }, (_, i) => [500 + Math.cos((i / 24) * Math.PI * 2) * 160, 700 + Math.sin((i / 24) * Math.PI * 2) * 160]));
  const full = await strokesOf(page);
  await byId(page, 'tool-clear').click();
  check(`ink ${tag}: clear all empties the paper and the stored draft`, (await strokesOf(page)).length === 0 && (await inkPixels(page)) === 0 && (await byId(page, 'ballot-submit').isDisabled()) && (await byId(page, 'tool-clear').isDisabled()));
  await byId(page, 'tool-undo').click();
  check(`ink ${tag}: one undo brings every cleared stroke back`, JSON.stringify(await strokesOf(page)) === JSON.stringify(full) && full.length === 4 && (await inkPixels(page)) > 400, `${full.length} strokes`);
  await noHorizontalScroll(page, `ink strokes ${tag}`);
  await shot(page, 'ink-strokes', size.width);
}

async function checkModes(page, tag, size) {
  const written = await strokesOf(page);
  const pixels = await inkPixels(page);
  const onPage = async () => {
    const [b, scroll] = [await box(page.locator('.paper')), await page.evaluate(() => window.scrollY)];
    return { ...b, y: b.y + scroll };
  };
  const writePaper = await onPage();
  await byId(page, 'mode-type').check();
  await byId(page, 'ballot-text').waitFor();
  check(`ink ${tag}: typing mode swaps the canvas and tools for the text paper`, (await count(page, 'ink-canvas')) === 0 && (await count(page, 'tool-pen')) === 0 && (await byId(page, 'ballot-count').textContent()) === '0 / 200');
  const typedPaper = await onPage();
  check(`ink ${tag}: the paper does not move or resize between modes`, ['x', 'y', 'width', 'height'].every((k) => Math.abs(typedPaper[k] - writePaper[k]) < 1), JSON.stringify({ writePaper, typedPaper }));
  check(`ink ${tag}: an empty typing mode with strokes elsewhere cannot submit`, await byId(page, 'ballot-submit').isDisabled());
  check(`ink ${tag}: the hint points back to writing`, (await byId(page, 'mode-hint').textContent()) === '손으로 쓴 내용은 쓰기 모드에서 낼 수 있어요.');
  check(`ink ${tag}: the strokes stay in the stored draft while typing`, JSON.stringify(await strokesOf(page)) === JSON.stringify(written) && (await draft(page)).mode === 'type');
  await shot(page, 'ink-mode-type-hint', size.width);

  await byId(page, 'ballot-text').fill('타이핑으로 쓴 한 줄이에요');
  check(`ink ${tag}: typing enables submit and clears the hint`, (await byId(page, 'ballot-submit').isEnabled()) && (await count(page, 'mode-hint')) === 0);
  await shot(page, 'ink-mode-type', size.width);

  await byId(page, 'mode-write').check();
  await byId(page, 'ink-canvas').waitFor();
  check(`ink ${tag}: switching back keeps the strokes on screen and in the draft`, (await inkPixels(page)) === pixels && JSON.stringify(await strokesOf(page)) === JSON.stringify(written));
  check(`ink ${tag}: undo history survives the round trip`, await byId(page, 'tool-undo').isEnabled());
  check(`ink ${tag}: no hint while the selected mode has content`, (await count(page, 'mode-hint')) === 0 && (await byId(page, 'ballot-submit').isEnabled()));
  check(`ink ${tag}: the typed text is stored beside the strokes`, (await draft(page)).text === '타이핑으로 쓴 한 줄이에요' && (await draft(page)).mode === 'write');

  await byId(page, 'tool-clear').click();
  check(`ink ${tag}: an emptied write mode with typed text shows the hint for typing`, (await byId(page, 'mode-hint').textContent()) === '타이핑한 내용은 타이핑 모드에서 낼 수 있어요.' && (await byId(page, 'ballot-submit').isDisabled()));
  await shot(page, 'ink-mode-write-hint', size.width);
  await byId(page, 'tool-undo').click();
  await byId(page, 'mode-type').check();
  check(`ink ${tag}: the typed text is intact after the round trip`, (await byId(page, 'ballot-text').inputValue()) === '타이핑으로 쓴 한 줄이에요');
  await byId(page, 'mode-write').check();
  await byId(page, 'ink-canvas').waitFor();
}

async function checkResizeAndReload(page, tag, size) {
  const written = await strokesOf(page);
  const probe = written[0];
  const [px, py] = [probe.pts[0], probe.pts[1]];
  const narrower = size.width >= 720 ? { width: 600, height: size.height } : { width: size.width + 80, height: size.height };
  await page.setViewportSize(narrower);
  await page.waitForTimeout(250);
  const sized = await byId(page, 'ink-canvas').evaluate((el) => [el.width, el.clientWidth]);
  check(`ink ${tag}: a resize keeps the canvas bitmap in step with its box`, sized[0] === Math.round(sized[1] * 1), JSON.stringify(sized));
  check(`ink ${tag}: after a resize the strokes are redrawn from the stored points`, (await inkedNear(page, px, py, 8)) && (await inkPixels(page)) > 400);
  await page.setViewportSize(size);
  await page.waitForTimeout(250);

  await page.reload();
  await byId(page, 'ink-canvas').waitFor();
  check(`ink ${tag}: reload restores the write mode and the strokes`, JSON.stringify(await strokesOf(page)) === JSON.stringify(written) && (await inkPixels(page)) > 400 && (await byId(page, 'mode-write').isChecked()));
  check(`ink ${tag}: a reload leaves nothing to undo but still restores the typed draft`, (await byId(page, 'tool-undo').isDisabled()) && (await draft(page)).text === '타이핑으로 쓴 한 줄이에요');
  await byId(page, 'mode-type').check();
  check(`ink ${tag}: the typed draft survived the reload`, (await byId(page, 'ballot-text').inputValue()) === '타이핑으로 쓴 한 줄이에요');
  await page.reload();
  await byId(page, 'ballot-text').waitFor();
  check(`ink ${tag}: reload restores the last selected mode`, await byId(page, 'mode-type').isChecked());

  await page.evaluate(
    ([key, text]) => localStorage.setItem(key, JSON.stringify({ kind: 'freeform', mode: 'write', text, strokes: [{ w: 'thin', pts: [1, 2, 'x'] }] })),
    [DRAFT_KEY, '남은 글'],
  );
  await page.reload();
  await byId(page, 'ink-canvas').waitFor();
  check(`ink ${tag}: damaged strokes are dropped and the rest of the draft survives`, (await inkPixels(page)) === 0 && (await byId(page, 'tool-clear').isDisabled()));
  await byId(page, 'mode-type').check();
  check(`ink ${tag}: the text next to damaged strokes is kept`, (await byId(page, 'ballot-text').inputValue()) === '남은 글');
  await page.evaluate((key) => localStorage.setItem(key, 'not json'), DRAFT_KEY);
  await page.reload();
  await byId(page, 'ink-canvas').waitFor();
  check(`ink ${tag}: an unreadable draft opens a clean write paper`, (await byId(page, 'mode-write').isChecked()) && (await byId(page, 'ballot-submit').isDisabled()));
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ kind: 'text', text: '예전 초안' })), DRAFT_KEY);
  await page.reload();
  await byId(page, 'ballot-text').waitFor();
  check(`ink ${tag}: a draft stored by the typing-only version still restores`, (await byId(page, 'ballot-text').inputValue()) === '예전 초안');
}

async function submit(page) {
  await byId(page, 'ballot-submit').click();
  await byId(page, 'ballot-confirm').click();
  await byId(page, 'ballot-submitted').waitFor();
}

async function fillToTheLimit(page, tag, size) {
  const { at } = await surface(page);
  for (let i = 0; i < 300; i++) {
    const col = i % 20;
    const row = Math.floor(i / 20);
    await page.mouse.click(...at([60 + col * 44, 80 + row * 60]));
  }
  check(`ink ${tag}: 300 strokes fit`, (await strokesOf(page)).length === 300 && (await count(page, 'ink-full-notice')) === 0);
  await page.mouse.click(...at([500, 960]));
  await byId(page, 'ink-full-notice').waitFor();
  check(`ink ${tag}: the 301st stroke is refused with the notice`, (await byId(page, 'ink-full-notice').textContent()) === FULL_NOTICE && (await strokesOf(page)).length === 300);
  check(`ink ${tag}: the notice is announced as a status`, (await byId(page, 'ink-full-notice').getAttribute('role')) === 'status');
  check(`ink ${tag}: a full paper can still be submitted`, await byId(page, 'ballot-submit').isEnabled());
  await byId(page, 'tool-eraser').click();
  await drag(page, [[40, 70], [60, 90]], 4);
  check(`ink ${tag}: the eraser works on a full paper and clears the notice`, (await count(page, 'ink-full-notice')) === 0 && (await strokesOf(page)).length === 299);
  await byId(page, 'tool-pen').click();
  await page.mouse.click(...at([500, 960]));
  check(`ink ${tag}: room freed by an erase accepts a stroke again`, (await strokesOf(page)).length === 300);
  await page.mouse.click(...at([540, 980]));
  await byId(page, 'ink-full-notice').waitFor();
  await byId(page, 'tool-undo').click();
  check(`ink ${tag}: undo clears the notice`, (await count(page, 'ink-full-notice')) === 0 && (await strokesOf(page)).length === 299);
  await page.mouse.click(...at([540, 980]));
  await page.mouse.click(...at([580, 980]));
  await byId(page, 'ink-full-notice').waitFor();
  await noHorizontalScroll(page, `ink full ${tag}`);
  await shot(page, 'ink-full', size.width);
}

async function checkTouch(browser, room, tag, problems) {
  const size = { width: 390, height: 600 };
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR', hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/r/${room.code}?nick=${encodeURIComponent('손가락')}`);
  await byId(page, 'ink-canvas').waitFor();
  const cdp = await ctx.newCDPSession(page);
  const dispatch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (from, to, steps = 12) => {
    await dispatch('touchStart', ...from);
    for (let i = 1; i <= steps; i++) {
      await dispatch('touchMove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
      await page.waitForTimeout(16);
    }
    await dispatch('touchEnd');
    await page.waitForTimeout(150);
  };
  const scrollY = () => page.evaluate(() => window.scrollY);

  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  check(`touch ${tag}: the page is taller than the viewport, so a scroll could happen`, scrollable > 40, String(scrollable));
  const dpr = await byId(page, 'ink-canvas').evaluate((el) => [el.width, el.clientWidth, window.devicePixelRatio]);
  check(`touch ${tag}: the canvas bitmap matches devicePixelRatio`, dpr[2] === 3 && dpr[0] === Math.round(dpr[1] * 3), JSON.stringify(dpr));

  const title = await box(byId(page, 'vote-title-view'));
  await swipe([title.x + 20, title.y + title.height / 2 + 120], [title.x + 20, title.y + title.height / 2 - 40]);
  const control = await scrollY();
  check(`touch ${tag}: a swipe outside the canvas scrolls the page (the control for the check below)`, control > 20, String(control));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const b = await box(byId(page, 'ink-canvas'));
  const from = [b.x + b.width * 0.3, b.y + b.height * 0.15];
  const to = [b.x + b.width * 0.6, b.y + b.height * 0.65];
  check(`touch ${tag}: the page rests at the top before the stroke`, (await scrollY()) === 0, String(await scrollY()));
  await swipe(from, to);
  check(`touch ${tag}: a vertical finger stroke on the canvas does not scroll the page`, (await scrollY()) === 0, String(await scrollY()));
  const strokes = await strokesOf(page);
  check(`touch ${tag}: the finger drew a stroke`, strokes.length === 1 && strokes[0].pts.length >= 4, JSON.stringify(strokes));
  check(`touch ${tag}: and it was painted`, (await inkPixels(page)) > 100);

  await page.evaluate(([x, y]) => {
    const canvas = document.querySelector('[data-testid="ink-canvas"]');
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
  }, from);
  await swipe([b.x + b.width * 0.7, b.y + b.height * 0.15], [b.x + b.width * 0.7, b.y + b.height * 0.55]);
  check(`touch ${tag}: once a stylus has been seen, a palm on the canvas leaves no stroke`, (await strokesOf(page)).length === 1);
  await page.evaluate(([x, y]) => {
    const canvas = document.querySelector('[data-testid="ink-canvas"]');
    const fire = (type, dx, dy) =>
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', isPrimary: true, button: 0, clientX: x + dx, clientY: y + dy, bubbles: true }));
    fire('pointerdown', 0, 0);
    fire('pointermove', 20, 10);
    fire('pointermove', 40, 30);
    fire('pointerup', 40, 30);
  }, [b.x + b.width * 0.2, b.y + b.height * 0.7]);
  check(`touch ${tag}: the stylus itself still draws`, (await strokesOf(page)).length === 2);
  await ctx.close();
}

export async function runInkWalk(browser, size) {
  const { width } = size;
  const tag = `@${width}`;
  const problems = [];
  const room = createFakeRoom();
  room.vote = { id: 'v1', title: '이번 달 MVP는 누구인가요?', anonymity: 'anonymous', paper: FREEFORM };
  room.stage = 'voting';
  const contexts = [];

  const writer = await joinAs(browser, size, room, '하늘', problems);
  contexts.push(writer.ctx);
  const page = writer.page;
  await byId(page, 'mode-write').waitFor();

  await checkDrawing(page, tag, size);
  await checkKeyboard(page, tag);
  await checkModes(page, tag, size);
  await checkResizeAndReload(page, tag, size);

  await page.evaluate((key) => localStorage.removeItem(key), DRAFT_KEY);
  await page.reload();
  await byId(page, 'ink-canvas').waitFor();
  await writeSample(page);
  const sample = await strokesOf(page);
  await byId(page, 'tool-pen').focus();
  await shot(page, 'ink-tools', width);
  await submit(page);
  const sent = room.ballotOf('하늘');
  const normalized = sent ? normalizeBallotContent(sent, FREEFORM) : null;
  check(`ink ${tag}: submitting in write mode sends one ink ballot`, sent?.kind === 'ink' && !('text' in sent) && room.commands('submitBallot').length === 1, JSON.stringify(sent)?.slice(0, 100));
  check(`ink ${tag}: the ballot passes normalizeBallotContent unchanged`, normalized !== null && JSON.stringify(normalized) === JSON.stringify(sent));
  check(`ink ${tag}: the ballot carries the strokes that were on the paper`, JSON.stringify(sent?.strokes) === JSON.stringify(sample) && sample.length === 4);
  check(`ink ${tag}: the submitted state replaces the paper and the draft is gone`, (await count(page, 'ink-canvas')) === 0 && (await count(page, 'mode-write')) === 0 && (await count(page, 'tool-pen')) === 0 && (await draft(page)) === null);
  await shot(page, 'ink-submitted', width);

  const typist = await joinAs(browser, size, room, '보리', problems);
  contexts.push(typist.ctx);
  await byId(typist.page, 'ink-canvas').waitFor();
  await drag(typist.page, wave(120, 880, 200, 40));
  await byId(typist.page, 'mode-type').check();
  await byId(typist.page, 'ballot-text').fill('손글씨 말고 이 글로 낼래요');
  await submit(typist.page);
  check(`ink ${tag}: submitting in typing mode sends only the text ballot`, JSON.stringify(room.ballotOf('보리')) === JSON.stringify({ kind: 'text', text: '손글씨 말고 이 글로 낼래요' }), JSON.stringify(room.ballotOf('보리')));

  const crowded = await joinAs(browser, size, room, '다람', problems);
  contexts.push(crowded.ctx);
  await byId(crowded.page, 'ink-canvas').waitFor();
  await fillToTheLimit(crowded.page, tag, size);
  await submit(crowded.page);
  const heavy = room.ballotOf('다람');
  check(`ink ${tag}: a paper at the stroke limit still submits and passes normalizeBallotContent`, heavy?.kind === 'ink' && heavy.strokes.length === 300 && normalizeBallotContent(heavy, FREEFORM) !== null, String(heavy?.strokes?.length));

  if (width === 390) await checkTouch(browser, room, tag, problems);

  check(`ink walk page errors ${tag}`, problems.length === 0, problems.join(' | '));
  for (const ctx of contexts) await ctx.close();
}
