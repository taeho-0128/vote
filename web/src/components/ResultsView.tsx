import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClientMsg, HostStage } from '../../../shared/protocol.ts';
import { tallyOf } from '../tally.ts';
import type { StageFace } from '../stageMachine.ts';
import { useFullscreen } from '../useFullscreen.ts';
import { useIntent } from '../useIntent.ts';
import type { useCommand } from '../useCommand.ts';
import { Icon } from './Icon.tsx';
import { PaperStage } from './PaperStage.tsx';
import type { StageIds } from './PaperStage.tsx';
import { Switch } from './Switch.tsx';
import { TallyGraph } from './TallyGraph.tsx';
import type { GraphIds } from './TallyGraph.tsx';
import { Tags } from './HostVoteCards.tsx';

type Closed = Extract<HostStage, { kind: 'closed' }>;

const STAGE_IDS: StageIds = {
  pile: 'result-pile',
  folded: 'result-folded',
  paper: 'result-paper',
  signature: 'result-signature',
};

const GRAPH_IDS: GraphIds = {
  root: 'result-graph',
  row: (index) => `graph-row-${index}`,
  count: (index) => `graph-count-${index}`,
};

// A button or switch turns Space into its own click, so the page-wide key must stay out of its way.
const NATIVE_SPACE = 'button, a[href], summary, [role="switch"], [role="button"]';
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

// A held key repeats far faster than the server answers. One command is in flight and only the newest wanted cursor
// goes next, once a view has come back; the timer frees a lost answer.
const ANSWER_TIMEOUT_MS = 1500;

interface ResultsViewProps {
  stage: Closed;
  wide: boolean;
  online: boolean;
  send: (msg: ClientMsg) => boolean;
  command: ReturnType<typeof useCommand>;
  refusal: ReactNode;
}

export function ResultsView({ stage, wide, online, send, command, refusal }: ResultsViewProps) {
  const { vote, reveal } = stage;
  const { ballots } = reveal;
  const total = ballots.length;
  const anonymous = vote.anonymity === 'anonymous';
  const choice = vote.paper.kind === 'choice';
  const area = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(area);
  const [showAuthor, setShowAuthor] = useState(false);

  const resetKey = `${online}|${command.refusal ?? ''}`;
  const [cursor, setCursor] = useIntent(reveal.cursor, resetKey);
  const [hidden, setHidden] = useIntent(reveal.hidden, resetKey);

  const wanted = useRef<number | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const post = (msg: ClientMsg): boolean => {
    const delivered = send(msg);
    if (!delivered) command.sent(false);
    return delivered;
  };

  const pump = () => {
    const want = wanted.current;
    if (want === null || inFlight.current) return;
    if (want === reveal.cursor) {
      wanted.current = null;
      return;
    }
    if (!post({ t: 'revealMove', voteId: vote.id, cursor: want })) {
      wanted.current = null;
      return;
    }
    inFlight.current = true;
    timer.current = setTimeout(() => {
      inFlight.current = false;
      pump();
    }, ANSWER_TIMEOUT_MS);
  };

  const answered = () => {
    clearTimeout(timer.current);
    inFlight.current = false;
    pump();
  };

  useEffect(answered, [reveal]);
  useEffect(() => {
    wanted.current = null;
    answered();
  }, [resetKey]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const move = (delta: 1 | -1) => {
    if (reveal.mode !== 'one' || total === 0) return;
    const from = wanted.current ?? reveal.cursor;
    if (delta < 0 && from < 1) return;
    const to = delta > 0 ? Math.min(from + 1, total - 1) : from - 1;
    if (to === from) return;
    wanted.current = to;
    setCursor(to);
    pump();
  };

  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const delta = event.key === 'ArrowRight' || event.key === ' ' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0 || document.querySelector('dialog[open]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TYPING)) return;
      if (event.key === ' ' && target?.closest(NATIVE_SPACE)) return;
      event.preventDefault();
      moveRef.current(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const paper = useMemo(() => vote.paper, [vote.id]);
  const open = reveal.cursor >= 0 ? ballots[reveal.cursor] : undefined;
  const openId = open?.id;
  const face = useMemo<StageFace>(
    () =>
      open
        ? { kind: 'paper', slot: reveal.cursor, content: open.content, signature: anonymous ? null : open.author.nickname }
        : { kind: 'pile' },
    [reveal.cursor, openId, anonymous],
  );
  const options = paper.kind === 'choice' ? paper.options : null;
  const tally = useMemo(
    () => (reveal.mode === 'all' && options ? tallyOf(ballots, options.length) : null),
    [reveal.mode, ballots, options],
  );

  const showAll = () => {
    post({ t: 'revealMode', voteId: vote.id, mode: 'all' });
  };
  const showOne = () => {
    post({ t: 'revealMode', voteId: vote.id, mode: 'one' });
  };
  const hide = (next: boolean) => {
    if (post({ t: 'setHidden', voteId: vote.id, hidden: next })) setHidden(next);
  };

  const last = total > 0 && reveal.cursor === total - 1;
  const note = reveal.cursor < 0 ? '다음을 누르면 첫 용지가 펼쳐져요.' : last ? '마지막 용지예요.' : '';

  const fullscreenButton = fullscreen.supported ? (
    <button
      type="button"
      className={wide || fullscreen.active ? 'btn ghost icon' : 'btn ghost'}
      data-testid="fullscreen"
      aria-label={fullscreen.active ? '전체화면 나가기' : '전체화면'}
      onClick={fullscreen.toggle}
    >
      <Icon name={fullscreen.active ? 'shrink' : 'expand'} />
      {wide || fullscreen.active ? null : '전체화면'}
    </button>
  ) : null;

  let body: ReactNode;
  if (total === 0) {
    body = (
      <div className="results-empty panel" data-testid="results-empty">
        <h2 className="title">낸 용지가 없어요</h2>
        <p className="sub">마감할 때까지 아무도 용지를 내지 않았어요. 새 투표를 만들어 다시 시작할 수 있어요.</p>
      </div>
    );
  } else if (tally && options) {
    body = (
      <div className="results-stage results-stage--graph" data-testid="results-stage">
        <TallyGraph options={options} tally={tally} ids={GRAPH_IDS} />
      </div>
    );
  } else {
    body = (
      <div className="results-stage" data-testid="results-stage" onClick={() => move(1)}>
        <PaperStage face={face} paper={paper} unopened={Math.max(0, total - reveal.cursor - 1)} ids={STAGE_IDS} />
      </div>
    );
  }

  const author =
    anonymous && showAuthor && reveal.mode === 'one' && total > 0 ? (
      open ? (
        <p className="results-author" data-testid="author-label">
          <b>작성자 {open.author.nickname}</b>
          <span>대화면에는 표시되지 않아요</span>
        </p>
      ) : (
        <p className="results-author">
          <span>용지를 펼치면 작성자가 여기에 나와요</span>
        </p>
      )
    ) : null;

  let nav: ReactNode = null;
  if (total > 0 && reveal.mode === 'one') {
    nav = (
      <div className="results-nav">
        <button type="button" className="btn ghost" data-testid="result-prev" disabled={cursor < 1} onClick={() => move(-1)}>
          <Icon name="left" />
          이전
        </button>
        <output className="results-pos" data-testid="result-position">
          {reveal.cursor + 1} / {total}
        </output>
        <button type="button" className="btn" data-testid="result-next" disabled={cursor >= total - 1} onClick={() => move(1)}>
          다음 용지
          <Icon name="right" />
        </button>
        {wide || fullscreen.active ? fullscreenButton : null}
      </div>
    );
  } else if (total > 0) {
    nav = (
      <div className="results-nav">
        <button type="button" className="btn" data-testid="reveal-one" onClick={showOne}>
          <Icon name="left" />
          다시 한 장씩 보기
        </button>
        {wide || fullscreen.active ? fullscreenButton : null}
      </div>
    );
  }

  return (
    <main className="host-main host-main--results">
      <section className="results" ref={area} aria-label="결과 확인">
        <header className="results-head">
          <p className="lbl">
            투표 마감 · <b data-testid="closed-count">{total}</b>장
          </p>
          <h1 className="title" data-testid="results-title">
            {vote.title}
          </h1>
          <div className="results-tags">
            <Tags vote={vote} />
            {hidden && total > 0 ? <span className="tag tag--alert">대화면 가림 중</span> : null}
          </div>
        </header>
        {body}
        {author}
        {total > 0 && reveal.mode === 'one' ? (
          <p className="results-note" data-testid="result-note">
            {note}
          </p>
        ) : null}
        {nav}
        {fullscreen.active ? refusal : null}
      </section>
      {total > 0 ? (
        <aside className="results-side" aria-label="공개 설정">
          <section className="panel">
            <h2 className="lbl">공개 설정</h2>
            <Switch testId="toggle-hidden" label="대화면 가리기" hint="켜면 대화면에는 접힌 용지만 보여요." checked={hidden} onChange={hide} />
            {anonymous ? (
              <Switch
                testId="toggle-author"
                label="작성자 보기"
                hint="이 화면에서만 보여요. 대화면에는 나오지 않아요."
                checked={showAuthor}
                onChange={setShowAuthor}
              />
            ) : null}
          </section>
          {choice && reveal.mode === 'one' ? (
            <section className="panel">
              <button type="button" className="btn ghost" data-testid="reveal-all" onClick={showAll}>
                전체 공개
              </button>
              <p className="hint">보기별 득표 그래프를 한꺼번에 보여줘요.</p>
            </section>
          ) : null}
          {wide ? null : fullscreenButton}
        </aside>
      ) : null}
    </main>
  );
}
