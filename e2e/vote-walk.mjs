// The voting lifecycle, walked with a host and three participants against the fake server:
// compose, start, write and submit both papers, close, dismiss, plus every refusal the screens handle.
import { createFakeRoom } from './fake-server.mjs';
import { ORIGIN, box, byId, check, joinAs, noHorizontalScroll, shot, watchPage } from './kit.mjs';

const OFFLINE = '연결이 끊겨서 보내지 못했어요';

const text = async (page, id) => (await byId(page, id).textContent()) ?? '';
const count = (page, id) => byId(page, id).count();
const waitText = (page, id, expected) =>
  page.waitForFunction(([i, e]) => document.querySelector(`[data-testid="${i}"]`)?.textContent === e, [id, expected]);
const focusedId = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const lengthOf = (s) => [...s].length;

async function typeMode(page) {
  await byId(page, 'mode-type').check();
  await byId(page, 'ballot-text').waitFor();
}

async function pressSubmit(page) {
  await byId(page, 'ballot-submit').click();
  await byId(page, 'ballot-confirm').waitFor();
}

async function composeVote(host, { title, kind, anonymity, options = [] }) {
  await byId(host, 'open-composer').click();
  await byId(host, 'vote-title').fill(title);
  await byId(host, kind === 'choice' ? 'paper-choice' : 'paper-freeform').check();
  await byId(host, anonymity === 'named' ? 'anon-named' : 'anon-anonymous').check();
  for (let i = 0; i < options.length; i++) {
    if (i >= 2) await byId(host, 'option-add').click();
    await byId(host, `option-input-${i}`).fill(options[i]);
  }
}

async function checkComposer(host, room, tag, width) {
  const wide = width >= 1024;
  await byId(host, 'open-composer').click();
  await byId(host, 'vote-title').waitFor();
  check(`composer ${tag}: start-vote disabled on an empty form`, await byId(host, 'start-vote').isDisabled());
  check(`composer ${tag}: a fresh form shows no error`, (await count(host, 'composer-error')) === 0);
  check(`composer ${tag}: open-composer gone while composing`, (await count(host, 'open-composer')) === 0);

  const composer = await box(host.locator('.composer'));
  const roster = await box(byId(host, 'roster'));
  const beside = composer.x + composer.width <= roster.x + 2 && composer.y < roster.y + roster.height;
  const below = roster.y >= composer.y + composer.height - 2;
  check(`composer ${tag}: ${wide ? 'left column beside the roster' : 'one column above the roster'}`, wide ? beside : below, JSON.stringify({ composer, roster }));
  check(`composer ${tag}: join card folded in place of the full card`, (await count(host, 'qr')) === 1 && !(await byId(host, 'qr').isVisible()) && (await count(host, 'join-fold')) === 1);
  await host.locator('[data-testid="join-fold"] summary').click();
  check(`composer ${tag}: QR reachable from the fold`, await byId(host, 'qr').isVisible());
  await host.locator('[data-testid="join-fold"] summary').click();
  check(`composer ${tag}: fold collapses again`, !(await byId(host, 'qr').isVisible()));
  const inBar = await byId(host, 'start-vote').evaluate((el) => (el.closest('.bar-actions') ? 'top' : el.closest('.bar-bottom') ? 'bottom' : 'nowhere'));
  check(`composer ${tag}: start-vote in the ${wide ? 'top' : 'bottom'} bar`, inBar === (wide ? 'top' : 'bottom'), inBar);

  await byId(host, 'vote-title').fill('가'.repeat(70));
  check(`composer ${tag}: title over 60 shows the title error`, (await text(host, 'composer-error')).includes('1~60자') && (await byId(host, 'start-vote').isDisabled()));
  await byId(host, 'vote-title').fill('오늘 점심은 뭐가 좋을까요?');
  check(`composer ${tag}: valid free-form title clears the error and enables start`, (await count(host, 'composer-error')) === 0 && (await byId(host, 'start-vote').isEnabled()));

  await byId(host, 'paper-choice').check();
  check(`composer ${tag}: choice shows two option rows, remove locked at the minimum`, (await count(host, 'option-input-1')) === 1 && (await count(host, 'option-input-2')) === 0 && (await byId(host, 'option-remove-0').isDisabled()) && (await byId(host, 'option-remove-1').isDisabled()));
  check(`composer ${tag}: empty options block start with a message`, (await text(host, 'composer-error')).includes('비어 있는 보기') && (await byId(host, 'start-vote').isDisabled()));
  await byId(host, 'option-input-0').fill('김치찜');
  await byId(host, 'option-input-1').fill('김치찜');
  check(`composer ${tag}: duplicate options`, (await text(host, 'composer-error')).includes('같은 보기'));
  await byId(host, 'option-input-1').fill('가'.repeat(31));
  check(`composer ${tag}: option over 30`, (await text(host, 'composer-error')).includes('30자'));
  await byId(host, 'option-input-1').fill('돈가스');
  check(`composer ${tag}: two good options enable start`, (await count(host, 'composer-error')) === 0 && (await byId(host, 'start-vote').isEnabled()));

  for (let i = 2; i < 8; i++) {
    await byId(host, 'option-add').click();
    if (i === 2) check(`composer ${tag}: adding an option focuses it`, (await focusedId(host)) === 'option-input-2', String(await focusedId(host)));
  }
  check(`composer ${tag}: eight options lock option-add`, (await byId(host, 'option-add').isDisabled()) && (await count(host, 'option-input-7')) === 1 && (await byId(host, 'option-remove-7').isEnabled()));
  check(`composer ${tag}: blank added options block start`, (await byId(host, 'start-vote').isDisabled()) && (await text(host, 'composer-error')).includes('비어 있는 보기'));
  for (let i = 7; i >= 4; i--) await byId(host, `option-remove-${i}`).click();
  check(`composer ${tag}: removing back to four`, (await count(host, 'option-input-4')) === 0 && (await count(host, 'option-input-3')) === 1);
  await byId(host, 'option-input-2').fill('비빔밥');
  await byId(host, 'option-input-3').fill('샐러드');
  await byId(host, 'anon-named').check();
  check(`composer ${tag}: named selected`, (await byId(host, 'anon-named').isChecked()) && !(await byId(host, 'anon-anonymous').isChecked()));
  check(`composer ${tag}: four options valid`, (await count(host, 'composer-error')) === 0 && (await byId(host, 'start-vote').isEnabled()));
  await noHorizontalScroll(host, `composer ${tag}`);
  await shot(host, 'vote-composer', width);

  await byId(host, 'paper-freeform').check();
  check(`composer ${tag}: free-form hides the options`, (await count(host, 'option-input-0')) === 0);
  await byId(host, 'paper-choice').check();
  check(`composer ${tag}: switching back keeps the options`, (await byId(host, 'option-input-3').inputValue()) === '샐러드');

  const other = wide ? 800 : 1100;
  await host.setViewportSize({ width: other, height: 900 });
  await host.waitForTimeout(150);
  const flipped = await byId(host, 'start-vote').evaluate((el) => (el.closest('.bar-actions') ? 'top' : el.closest('.bar-bottom') ? 'bottom' : 'nowhere'));
  check(`composer ${tag}: crossing the breakpoint moves the actions and keeps the form`, flipped === (wide ? 'bottom' : 'top') && (await byId(host, 'vote-title').inputValue()) === '오늘 점심은 뭐가 좋을까요?' && (await byId(host, 'start-vote').isEnabled()), flipped);
  await host.setViewportSize({ width, height: host.viewportSize()?.height ?? 900 });

  await byId(host, 'cancel-composer').click();
  check(`composer ${tag}: cancel returns to the lobby`, (await count(host, 'open-composer')) === 1 && (await count(host, 'vote-title')) === 0);
}

export async function runVoteWalk(browser, size) {
  const { width } = size;
  const tag = `@${width}`;
  const wide = width >= 1024;
  const problems = [];
  const room = createFakeRoom();
  const extraContexts = [];

  const hostCtx = await browser.newContext({ viewport: size, locale: 'ko-KR' });
  const host = await hostCtx.newPage();
  watchPage(host, problems);
  await room.install(host);
  await host.goto(`${ORIGIN}/`);
  await byId(host, 'home-create-room').click();
  await host.waitForURL('**/host/4827');
  await byId(host, 'roster-item').first().waitFor();

  await checkComposer(host, room, tag, width);

  const a = await joinAs(browser, size, room, '하늘', problems);
  const b = await joinAs(browser, size, room, '보리', problems);
  extraContexts.push(a.ctx, b.ctx);
  const pageA = a.page;
  const pageB = b.page;
  check(`participant ${tag}: lobby unchanged`, (await pageA.textContent('body'))?.includes('운영자가 투표를 만드는 중이에요.') === true);

  await composeVote(host, { title: '이번 달 MVP는 누구인가요?', kind: 'freeform', anonymity: 'anonymous' });
  room.refuseNext = 'bad_vote';
  await byId(host, 'start-vote').click();
  await byId(host, 'command-error').waitFor();
  check(`refusal ${tag}: bad_vote shown near the action and the composer stays`, (await text(host, 'command-error')).includes('투표 설정이 올바르지 않아요') && (await byId(host, 'start-vote').isEnabled()) && (await count(host, 'vote-title')) === 1);
  const errorHome = await byId(host, 'command-error').evaluate((el) => (el.closest('.bar-bottom') ? 'bottom' : el.closest('.banners') ? 'banners' : 'elsewhere'));
  check(`refusal ${tag}: error sits in the ${wide ? 'banner under the top bar' : 'bottom bar'}`, errorHome === (wide ? 'banners' : 'bottom'), errorHome);
  await shot(host, 'vote-refusal', width);
  room.refuseNext = 'wrong_stage';
  await byId(host, 'start-vote').click();
  await host.waitForFunction(() => document.querySelector('[data-testid="command-error"]')?.textContent?.includes('지금 단계에서는'));
  check(`refusal ${tag}: wrong_stage replaces the message and start works again`, await byId(host, 'start-vote').isEnabled());
  await byId(host, 'start-vote').click();
  await byId(host, 'submitted-count').waitFor();
  const sent = room.commands('startVote').at(-1).draft;
  check(`host ${tag}: start-vote sent the draft`, sent.title === '이번 달 MVP는 누구인가요?' && sent.paper.kind === 'freeform' && sent.anonymity === 'anonymous', JSON.stringify(sent));
  check(`host ${tag}: refusal cleared once the vote started`, (await count(host, 'command-error')) === 0);
  check(`host ${tag}: voting shows the title`, (await text(host, 'vote-heading')) === '이번 달 MVP는 누구인가요?');
  check(`host ${tag}: submitted-count is exactly "0 / 16"`, (await text(host, 'submitted-count')) === '0 / 16', await text(host, 'submitted-count'));
  check(`host ${tag}: voting actions`, (await count(host, 'close-vote')) === 1 && (await count(host, 'open-composer')) === 0 && (await count(host, 'start-vote')) === 0 && (await host.locator('button:disabled').count()) === 0 && (await byId(host, 'open-display').isEnabled()));
  check(`host ${tag}: every roster item has data-submitted`, (await host.locator('[data-testid="roster-item"]:not([data-submitted])').count()) === 0);
  check(`host ${tag}: join QR still reachable while voting`, (await count(host, 'join-fold')) === 1);

  await pageA.getByTestId('vote-title-view').waitFor();
  await pageB.getByTestId('vote-title-view').waitFor();
  check(`participant ${tag}: title and anonymous badge`, (await text(pageA, 'vote-title-view')) === '이번 달 MVP는 누구인가요?' && (await text(pageA, 'anon-badge')).trim() === '공개 화면에 이름이 표시되지 않아요');
  check(`participant ${tag}: submit disabled on an empty paper`, await byId(pageA, 'ballot-submit').isDisabled());
  check(`participant ${tag}: a fresh free-form paper opens in write mode`, (await byId(pageA, 'mode-write').isChecked()) && (await count(pageA, 'ballot-text')) === 0);
  await typeMode(pageA);
  await byId(pageA, 'ballot-text').fill('   ');
  check(`participant ${tag}: whitespace only stays disabled`, await byId(pageA, 'ballot-submit').isDisabled());
  const written = '서연이요!\n발표 자료 같이 만들어 줘서 정말 고마웠어요';
  await byId(pageA, 'ballot-text').fill(written);
  check(`participant ${tag}: counter matches`, (await text(pageA, 'ballot-count')) === `${lengthOf(written)} / 200`, await text(pageA, 'ballot-count'));
  check(`participant ${tag}: text enables submit`, await byId(pageA, 'ballot-submit').isEnabled());
  check(`participant ${tag}: draft stored under the vote id`, (await stored(pageA, 'hanpyo:ballot:v1'))?.includes('서연이요') === true);
  await noHorizontalScroll(pageA, `paper free-form ${tag}`);
  await shot(pageA, 'vote-paper-freeform', width);

  await pageA.reload();
  await byId(pageA, 'ballot-text').waitFor();
  check(`participant ${tag}: reload restores the typed draft`, (await byId(pageA, 'ballot-text').inputValue()) === written);

  await byId(pageA, 'ballot-text').click();
  await pageA.keyboard.press('Control+A');
  await pageA.keyboard.insertText('가'.repeat(250));
  check(`participant ${tag}: hard limit of 200`, lengthOf(await byId(pageA, 'ballot-text').inputValue()) === 200 && (await text(pageA, 'ballot-count')) === '200 / 200', String(lengthOf(await byId(pageA, 'ballot-text').inputValue())));
  await byId(pageA, 'ballot-text').fill(written);

  await pressSubmit(pageA);
  check(`participant ${tag}: confirm names the consequence`, (await pageA.locator('dialog.confirm h2').textContent()) === '제출하면 고칠 수 없어요');
  check(`participant ${tag}: confirm focuses 돌아가기 first`, (await focusedId(pageA)) === 'ballot-cancel', String(await focusedId(pageA)));
  await shot(pageA, 'vote-confirm', width);
  await pageA.keyboard.press('Escape');
  await byId(pageA, 'ballot-confirm').waitFor({ state: 'hidden' });
  await pressSubmit(pageA);
  await byId(pageA, 'ballot-cancel').click();
  await byId(pageA, 'ballot-confirm').waitFor({ state: 'hidden' });
  check(`participant ${tag}: escape and 돌아가기 send nothing`, room.commands('submitBallot').length === 0 && (await byId(pageA, 'ballot-text').inputValue()) === written);

  room.refuseNext = 'bad_ballot';
  await pressSubmit(pageA);
  await byId(pageA, 'ballot-confirm').click();
  await byId(pageA, 'ballot-error').waitFor();
  check(`refusal ${tag}: bad_ballot shows near submit and the paper stays`, (await text(pageA, 'ballot-error')).includes('용지 내용이 올바르지 않아요') && (await byId(pageA, 'ballot-submit').isEnabled()) && (await byId(pageA, 'ballot-text').inputValue()) === written);
  await shot(pageA, 'vote-ballot-error', width);

  await pressSubmit(pageA);
  await byId(pageA, 'ballot-confirm').click();
  await byId(pageA, 'ballot-submitted').waitFor();
  check(`participant ${tag}: submitted state`, (await text(pageA, 'ballot-submitted')).includes('제출했어요. 마감을 기다리는 중이에요.') && (await count(pageA, 'ballot-text')) === 0 && (await count(pageA, 'ballot-submit')) === 0 && (await count(pageA, 'ballot-error')) === 0);
  check(`participant ${tag}: server got the normalized text once`, room.commands('submitBallot').length === 2 && room.ballotOf('하늘')?.text === written, JSON.stringify(room.ballotOf('하늘')));
  check(`participant ${tag}: stored draft cleared after submit`, (await stored(pageA, 'hanpyo:ballot:v1')) === null);
  await shot(pageA, 'vote-submitted', width);
  await pageA.reload();
  await byId(pageA, 'ballot-submitted').waitFor();
  check(`participant ${tag}: reload shows submitted from the snapshot`, (await count(pageA, 'ballot-text')) === 0);

  await waitText(host, 'submitted-count', '1 / 16');
  room.submitMany(9);
  await waitText(host, 'submitted-count', '10 / 16');
  room.add('늦게온사람');
  await waitText(host, 'submitted-count', '10 / 17');
  check(`host ${tag}: a late joiner raises the denominator`, (await text(host, 'submitted-count')) === '10 / 17');
  const flags = await host.locator('[data-testid="roster-item"]').evaluateAll((els) => els.map((e) => e.dataset.submitted));
  const firstDone = flags.indexOf('true');
  check(`host ${tag}: pending people listed first`, flags.filter((f) => f === 'false').length === 7 && firstDone === 7 && flags.slice(firstDone).every((f) => f === 'true'), flags.join());
  check(`host ${tag}: stamps only on submitted`, (await host.locator('[data-submitted="true"] .stamp').count()) === 10 && (await host.locator('[data-submitted="false"] .stamp').count()) === 0);
  await noHorizontalScroll(host, `host voting ${tag}`);
  await shot(host, 'vote-host-voting', width);

  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').waitFor();
  check(`host ${tag}: close asks once with the pending count`, (await host.locator('dialog.confirm h2').textContent()) === '아직 7명이 안 냈어요. 지금 마감할까요?');
  await shot(host, 'vote-host-confirm-close', width);
  await byId(host, 'cancel-close').click();
  await byId(host, 'confirm-close').waitFor({ state: 'hidden' });
  check(`host ${tag}: 돌아가기 keeps voting and sends nothing`, room.commands('closeVote').length === 0 && (await count(host, 'submitted-count')) === 1);

  room.refuseNext = 'stale_vote';
  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').click();
  await byId(host, 'command-error').waitFor();
  check(`refusal ${tag}: stale_vote shown, still voting, close enabled again`, (await text(host, 'command-error')).includes('이미 지난 투표') && (await byId(host, 'close-vote').isEnabled()) && (await count(host, 'submitted-count')) === 1);
  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').click();
  await byId(host, 'closed-count').waitFor();
  check(`host ${tag}: closed shows the ballot count as a bare number`, (await text(host, 'closed-count')) === '10', await text(host, 'closed-count'));
  check(`host ${tag}: closed opens the results at the folded pile`, (await text(host, 'result-position')) === '0 / 10' && (await count(host, 'result-pile')) === 1);
  check(`host ${tag}: closed actions`, (await count(host, 'dismiss-vote')) === 1 && (await count(host, 'close-vote')) === 0 && (await count(host, 'command-error')) === 0);
  check(`host ${tag}: the results screen replaces the roster`, (await count(host, 'roster')) === 0);
  await noHorizontalScroll(host, `host closed ${tag}`);
  await shot(host, 'vote-host-closed', width);

  await pageB.getByTestId('vote-closed-notice').waitFor();
  await pageA.getByTestId('vote-closed-notice').waitFor();
  const noticeA = await text(pageA, 'vote-closed-notice');
  const noticeB = await text(pageB, 'vote-closed-notice');
  check(`participant ${tag}: closed notice for a submitter`, noticeA.includes('마감됐어요. 운영자가 결과를 보여줄 거예요.') && !noticeA.includes('참여하지 않았어요'));
  check(`participant ${tag}: closed notice for someone who never submitted`, noticeB.includes('마감됐어요. 운영자가 결과를 보여줄 거예요.') && noticeB.includes('이번 투표에는 참여하지 않았어요.'));
  await noHorizontalScroll(pageB, `participant closed ${tag}`);
  await shot(pageB, 'vote-closed-participant', width);

  room.refuseNext = 'wrong_stage';
  await byId(host, 'dismiss-vote').click();
  await byId(host, 'command-error').waitFor();
  check(`refusal ${tag}: dismiss refused shows a message and the button works again`, await byId(host, 'dismiss-vote').isEnabled());
  await byId(host, 'dismiss-vote').click();
  await byId(host, 'open-composer').waitFor();
  check(`host ${tag}: dismiss returns to the lobby with a clean slate`, (await count(host, 'command-error')) === 0 && (await count(host, 'vote-title')) === 0 && (await count(host, 'qr')) === 1 && (await byId(host, 'qr').isVisible()));
  await pageB.getByText('운영자가 투표를 만드는 중이에요.').waitFor();
  check(`participant ${tag}: back to the waiting lobby`, (await count(pageB, 'vote-closed-notice')) === 0 && (await count(pageB, 'vote-title-view')) === 0);

  await composeVote(host, { title: '오늘 점심은 뭐가 좋을까요?', kind: 'choice', anonymity: 'named', options: ['김치찜', '돈가스', '비빔밥', '샐러드'] });
  await byId(host, 'start-vote').click();
  await byId(host, 'submitted-count').waitFor();
  check(`host ${tag}: choice draft reached the server`, room.vote.paper.kind === 'choice' && room.vote.paper.options.join() === '김치찜,돈가스,비빔밥,샐러드' && room.vote.anonymity === 'named');

  await byId(pageB, 'ballot-option-3').waitFor();
  check(`participant ${tag}: named badge carries the nickname`, (await text(pageB, 'anon-badge')).trim() === '공개 화면에 ‘보리’ 이름이 표시돼요');
  check(`participant ${tag}: options in order, none chosen, submit disabled`, (await pageB.locator('.opt-text').allInnerTexts()).join() === '김치찜,돈가스,비빔밥,샐러드' && (await pageB.locator('input[name="ballot-option"]:checked').count()) === 0 && (await byId(pageB, 'ballot-submit').isDisabled()));
  const ring = (page, i) => page.evaluate((n) => parseFloat(getComputedStyle(document.querySelector(`[data-testid="ballot-option-${n}"]`).parentElement.querySelector('path')).strokeDashoffset), i);
  await byId(pageB, 'ballot-option-1').click();
  await pageB.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="ballot-option-1"]').parentElement.querySelector('path')).strokeDashoffset) === 0);
  check(`participant ${tag}: tapping draws the circle`, (await ring(pageB, 1)) === 0 && (await ring(pageB, 0)) === 1);
  await byId(pageB, 'ballot-option-2').click();
  await pageB.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="ballot-option-2"]').parentElement.querySelector('path')).strokeDashoffset) === 0);
  check(`participant ${tag}: one choice only`, (await pageB.locator('input[name="ballot-option"]:checked').count()) === 1 && (await byId(pageB, 'ballot-option-2').isChecked()) && !(await byId(pageB, 'ballot-option-1').isChecked()) && (await ring(pageB, 1)) === 1);
  check(`participant ${tag}: the paper shows the signature`, (await pageB.locator('.sig').textContent()) === '— 보리');
  await noHorizontalScroll(pageB, `paper choice ${tag}`);
  await shot(pageB, 'vote-paper-choice', width);
  await pageB.reload();
  await byId(pageB, 'ballot-option-2').waitFor();
  check(`participant ${tag}: reload restores the chosen option`, await byId(pageB, 'ballot-option-2').isChecked());
  await pressSubmit(pageB);
  await byId(pageB, 'ballot-confirm').click();
  await byId(pageB, 'ballot-submitted').waitFor();
  check(`participant ${tag}: choice submitted as an option index`, JSON.stringify(room.ballotOf('보리')) === JSON.stringify({ kind: 'choice', optionIndex: 2 }), JSON.stringify(room.ballotOf('보리')));

  // The vote closes behind the participant's back: the server refuses with wrong_stage and the paper stays usable.
  await pageA.getByTestId('ballot-option-0').waitFor();
  await byId(pageA, 'ballot-option-0').click();
  room.stage = 'closed';
  await pressSubmit(pageA);
  await byId(pageA, 'ballot-confirm').click();
  await byId(pageA, 'ballot-error').waitFor();
  check(`refusal ${tag}: wrong_stage shown near submit, paper intact`, (await text(pageA, 'ballot-error')).includes('지금 단계에서는') && (await byId(pageA, 'ballot-submit').isEnabled()) && (await byId(pageA, 'ballot-option-0').isChecked()));
  room.stage = 'voting';
  room.refuseNext = 'already_submitted';
  await pressSubmit(pageA);
  await byId(pageA, 'ballot-confirm').click();
  await byId(pageA, 'ballot-submitted').waitFor();
  check(`refusal ${tag}: already_submitted turns into the submitted state`, (await count(pageA, 'ballot-submit')) === 0 && (await count(pageA, 'ballot-error')) === 0);

  // A dropped connection loses the command. Both screens say so, and neither stays stuck once the socket is back.
  const c = await joinAs(browser, size, room, '다람', problems);
  extraContexts.push(c.ctx);
  await byId(c.page, 'ballot-option-0').click();
  room.dropAll();
  await byId(c.page, 'connection-banner').waitFor({ timeout: 3000 });
  await byId(host, 'connection-banner').waitFor({ timeout: 3000 });
  await pressSubmit(c.page);
  await byId(c.page, 'ballot-confirm').click();
  await byId(c.page, 'ballot-error').waitFor();
  await byId(host, 'close-vote').click();
  await byId(host, 'confirm-close').click();
  await byId(host, 'command-error').waitFor();
  check(`refusal ${tag}: offline copy on both screens`, (await text(c.page, 'ballot-error')).includes(OFFLINE) && (await text(host, 'command-error')).includes(OFFLINE));
  await shot(c.page, 'vote-offline', width);
  room.refuse = false;
  await byId(c.page, 'connection-banner').waitFor({ state: 'detached', timeout: 12000 });
  await byId(host, 'connection-banner').waitFor({ state: 'detached', timeout: 12000 });
  await c.page.waitForFunction(() => !document.querySelector('[data-testid="ballot-error"]'));
  await host.waitForFunction(() => !document.querySelector('[data-testid="command-error"]'));
  check(`refusal ${tag}: reconnecting clears the offline message and the buttons work`, (await byId(c.page, 'ballot-submit').isEnabled()) && (await byId(host, 'close-vote').isEnabled()) && (await byId(c.page, 'ballot-option-0').isChecked()));
  await pressSubmit(c.page);
  await byId(c.page, 'ballot-confirm').click();
  await byId(c.page, 'ballot-submitted').waitFor();

  // Everyone has submitted, so closing needs no question.
  room.submitMany(room.participants.length);
  await waitText(host, 'submitted-count', `${room.participants.length} / ${room.participants.length}`);
  await byId(host, 'close-vote').click();
  await byId(host, 'closed-count').waitFor();
  check(`host ${tag}: no confirm when nobody is pending`, !(await byId(host, 'confirm-close').isVisible()));
  check(`host ${tag}: closed-count matches ballots`, (await text(host, 'closed-count')) === String(room.participants.length));
  await byId(host, 'dismiss-vote').click();
  await byId(host, 'open-composer').waitFor();

  await composeVote(host, { title: '이번 주 한 줄 소감', kind: 'freeform', anonymity: 'named' });
  await byId(host, 'start-vote').click();
  await byId(host, 'submitted-count').waitFor();
  await byId(pageB, 'mode-type').waitFor();
  await typeMode(pageB);
  check(`participant ${tag}: named free-form badge`, (await text(pageB, 'anon-badge')).trim() === '공개 화면에 ‘보리’ 이름이 표시돼요');
  await byId(pageB, 'ballot-text').fill('발표 자료 같이 만들어 줘서 정말 고마웠어요. 다음에도 같이 해요!');
  check(`participant ${tag}: signature on the free-form paper`, (await pageB.locator('.sig').textContent()) === '— 보리');
  await noHorizontalScroll(pageB, `paper free-form named ${tag}`);
  await shot(pageB, 'vote-paper-freeform-named', width);

  const d = await joinAs(browser, size, room, '무저장', problems, { blockStorage: true });
  extraContexts.push(d.ctx);
  await typeMode(d.page);
  await byId(d.page, 'ballot-text').fill('저장소가 막혀 있어도 돼요');
  await pressSubmit(d.page);
  await byId(d.page, 'ballot-confirm').click();
  await byId(d.page, 'ballot-submitted').waitFor();
  check(`participant ${tag}: voting works with localStorage blocked`, room.ballotOf('무저장')?.text === '저장소가 막혀 있어도 돼요');

  check(`vote walk page errors ${tag}`, problems.length === 0, problems.join(' | '));
  for (const ctx of [hostCtx, ...extraContexts]) await ctx.close();
}
