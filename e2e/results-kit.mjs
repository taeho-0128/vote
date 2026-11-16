// Shared by the results walk: pages for the host and the display, the page-side recorder of what plays, and the
// helpers that ask a page what it shows. Everything here runs against the fake server's state, never the page's own.
import { createFakeRoom } from './fake-server.mjs';
import { ORIGIN, byId, watchPage } from './kit.mjs';

export const NICKS = ['민준', '서연', '지후', '도윤', '예은', '시우', '하린', '주원'];

export const wave = (y, amp, turns) =>
  Array.from({ length: 41 }, (_, i) => [120 + Math.round((760 * i) / 40), Math.round(y + Math.sin((i / 40) * Math.PI * 2 * turns) * amp)]).flat();

export const INK = [
  { w: 'thin', pts: wave(260, 50, 3) },
  { w: 'thick', pts: wave(480, 40, 2) },
  { w: 'thin', pts: wave(700, 60, 4) },
  { w: 'thin', pts: [500, 900] },
];

export const LONG_TEXT = '델타 오늘 모임에서 가장 기억에 남는 순간은 처음 만난 사람들과 함께 웃으며 이야기를 나누던 시간이었어요. '
  .repeat(2)
  .slice(0, 198);

export const TEXTS = {
  민준: { kind: 'text', text: '알파 점심은 국밥이 좋겠어요' },
  서연: { kind: 'text', text: '베타 다 같이 산책해요\n해가 지기 전에' },
  지후: { kind: 'ink', strokes: INK },
  도윤: { kind: 'text', text: LONG_TEXT },
  예은: { kind: 'text', text: '엡실론 조용한 곳이면 좋겠어요' },
  시우: { kind: 'text', text: '제타 음악은 작게 틀어 주세요' },
  하린: { kind: 'text', text: '에타 마지막까지 고마웠습니다' },
  주원: { kind: 'text', text: '세타 한 줄 의견입니다' },
};

export const OPTIONS = ['김치찜', '돈가스', '비빔밥', '샐러드'];

// Starts at rest in the lobby with the host's token already stored, the way a browser that made the room would be.
export const newRoom = () => createFakeRoom();

const record = () => {
  window.__rec = [];
  let lastPlay;
  let lastStep;
  const sample = () => {
    const play = document.querySelector('[data-testid="stage"]')?.getAttribute('data-play') ?? null;
    const step = document.querySelector('.unfold')?.getAttribute('data-step') ?? null;
    if (play !== lastPlay) {
      lastPlay = play;
      window.__rec.push({ k: 'play', v: play, t: performance.now() });
    }
    if (step !== lastStep) {
      lastStep = step;
      window.__rec.push({ k: 'step', v: step, t: performance.now() });
    }
  };
  new MutationObserver(sample).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-play', 'data-step'],
  });
};

export async function openHost(browser, room, size, { reduced = false, problems = [] } = {}) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([key, token]) => localStorage.setItem(key, token), [`hanpyo:host:${room.code}`, room.hostToken]);
  await ctx.addInitScript(record);
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/host/${room.code}`);
  await byId(page, 'roster').waitFor();
  return { ctx, page };
}

export async function openDisplay(browser, room, size, { reduced = false, problems = [], code = room.code, token = room.displayToken } = {}) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(record);
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/d/${code}/${token}`);
  await byId(page, 'display-root').waitFor();
  return { ctx, page };
}

export const recorded = (page) => page.evaluate(() => window.__rec.map((entry) => ({ ...entry })));
export const clearRecorded = (page) => page.evaluate(() => void (window.__rec.length = 0));

export const textOf = async (page, id) => (await byId(page, id).textContent()) ?? '';

export const waitText = (page, id, expected) =>
  page.waitForFunction(([testId, wanted]) => document.querySelector(`[data-testid="${testId}"]`)?.textContent === wanted, [id, expected]);

export const waitRest = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid="stage"]')?.getAttribute('data-play') === 'rest', null, { timeout: 8000 });

// Everything a person could read or inspect on the page: its markup, its text and its attributes.
export const wholePage = (page) => page.evaluate(() => `${document.documentElement.outerHTML}\n${document.body.innerText}`);

export const found = (haystack, needles) => needles.filter((needle) => haystack.includes(needle));

export const contentText = (content) => (content?.kind === 'text' ? content.text : null);

// The paper the room's shuffled order puts at a position.
export const orderedContent = (room, index) => room.ballots.get(room.reveal.order[index]);
export const authorAt = (room, index) => room.participants.find((p) => p.id === room.reveal.order[index])?.nickname;

export async function composeVote(host, { title, kind, anonymity, options = [] }) {
  await byId(host, 'open-composer').click();
  await byId(host, 'vote-title').fill(title);
  await byId(host, kind === 'choice' ? 'paper-choice' : 'paper-freeform').check();
  await byId(host, anonymity === 'named' ? 'anon-named' : 'anon-anonymous').check();
  for (let i = 0; i < options.length; i++) {
    if (i >= 2) await byId(host, 'option-add').click();
    await byId(host, `option-input-${i}`).fill(options[i]);
  }
  await byId(host, 'start-vote').click();
  await byId(host, 'submitted-count').waitFor();
}

export async function closeVote(host) {
  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').click({ timeout: 1500 }).catch(() => undefined);
  await byId(host, 'results-stage').or(byId(host, 'results-empty')).waitFor();
}

// Steps the host to a position with the keyboard, one press at a time so every press reaches the server.
export async function stepTo(host, target) {
  await host.evaluate(() => document.activeElement?.blur());
  for (let guard = 0; guard < 40; guard++) {
    const now = Number.parseInt((await textOf(host, 'result-position')).replace(/^-/, '0'), 10);
    if (now === target) return;
    await host.keyboard.press(now < target ? 'ArrowRight' : 'ArrowLeft');
    await waitText(host, 'result-position', `${now + (now < target ? 1 : -1)} / ${(await textOf(host, 'result-position')).split(' / ')[1]}`);
  }
  throw new Error(`could not reach position ${target}`);
}

// "새 투표 만들기" asks first when the closed vote was never exported. The walks that are not about export skip the question.
export async function dismissVote(page) {
  await byId(page, 'dismiss-vote').click();
  await byId(page, 'export-confirm-skip').click({ timeout: 1200 }).catch(() => undefined);
}
