// Shared by the fold walks: a joined participant with the page-side recorders for phases, counts and the buzz.
import { createFakeRoom } from './fake-server.mjs';
import { ORIGIN, byId, watchPage } from './kit.mjs';

export const OTHERS = 7;
export const OPTIONS = ['김치찜', '돈가스', '비빔밥', '샐러드'];
export const KINDS = {
  ink: { paper: { kind: 'freeform' }, anonymity: 'anonymous' },
  text: { paper: { kind: 'freeform' }, anonymity: 'named' },
  choice: { paper: { kind: 'choice', options: OPTIONS }, anonymity: 'named' },
};

const record = () => {
  window.__buzz = [];
  window.__phases = [];
  window.__counts = [];
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (pattern) => {
      window.__buzz.push({ pattern, t: performance.now() });
      return true;
    },
  });
  const sample = () => {
    const phase = document.querySelector('[data-testid="fold-stage"]')?.getAttribute('data-phase');
    if (phase && window.__phases.at(-1)?.phase !== phase) window.__phases.push({ phase, t: performance.now() });
    const value = document.querySelector('[data-testid="box-count"]')?.textContent;
    if (value != null && window.__counts.at(-1)?.value !== value) window.__counts.push({ value, t: performance.now() });
  };
  new MutationObserver(sample).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
};

export const phasesOf = (page) => page.evaluate(() => window.__phases);
export const countsOf = (page) => page.evaluate(() => window.__counts.map((c) => c.value));
export const buzzesOf = (page) => page.evaluate(() => window.__buzz);
export const names = (phases) => phases.map((p) => p.phase).join(',');
export const at = (phases, phase) => phases.find((p) => p.phase === phase)?.t ?? NaN;
export const untilPageTime = (page, target) =>
  page.evaluate(
    (t) =>
      new Promise((resolve) => {
        const tick = () => (performance.now() >= t ? resolve() : requestAnimationFrame(tick));
        tick();
      }),
    target,
  );

export async function join(browser, size, room, nickname, problems, { reduced = false, scale = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ko-KR', deviceScaleFactor: scale, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(record);
  const page = await ctx.newPage();
  watchPage(page, problems);
  await room.install(page);
  await page.goto(`${ORIGIN}/r/${room.code}?nick=${encodeURIComponent(nickname)}`);
  await page.locator('.pill', { hasText: `· ${nickname}` }).waitFor();
  await byId(page, 'vote-title-view').waitFor();
  return { ctx, page };
}

export function openRoom(kind) {
  const room = createFakeRoom();
  room.vote = { id: 'v1', title: '이번 달 MVP는 누구인가요?', anonymity: KINDS[kind].anonymity, paper: KINDS[kind].paper };
  room.stage = 'voting';
  room.submitMany(OTHERS);
  return room;
}

export async function submitWithPointer(page) {
  await byId(page, 'ballot-submit').click();
  await byId(page, 'ballot-confirm').click();
}
