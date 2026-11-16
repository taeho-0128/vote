import { useMemo } from 'react';
import type { DisplayReveal, ParticipantSummary, VotePublic } from '../../../shared/protocol.ts';
import type { StageFace } from '../stageMachine.ts';
import { voteKindLabel } from '../voteLabels.ts';
import { PaperStage } from './PaperStage.tsx';
import type { StageIds } from './PaperStage.tsx';
import { QrCode } from './QrCode.tsx';
import { TallyGraph } from './TallyGraph.tsx';
import type { GraphIds } from './TallyGraph.tsx';

const STAGE_IDS: StageIds = {
  pile: 'display-pile',
  folded: 'display-folded',
  paper: 'display-paper',
  signature: 'display-signature',
};

const GRAPH_IDS: GraphIds = {
  root: 'display-graph',
  row: (index) => `display-graph-row-${index}`,
  count: (index) => `display-graph-count-${index}`,
};

const MAX_CHIPS = 60;

const chipSize = (count: number): 'xl' | 'l' | 'm' | 's' => (count <= 12 ? 'xl' : count <= 24 ? 'l' : count <= 36 ? 'm' : 's');

const titleSize = (title: string): 'xl' | 'l' | 'm' | 's' => {
  const length = [...title].length;
  return length <= 14 ? 'xl' : length <= 28 ? 'l' : length <= 44 ? 'm' : 's';
};

export function DisplayLobby({ code, participants }: { code: string; participants: readonly ParticipantSummary[] }) {
  const joinUrl = `${location.origin}/r/${code}`;
  const shown = participants.slice(0, MAX_CHIPS);
  return (
    <section className="d-lobby" data-testid="display-lobby" aria-label="입장 안내">
      <div className="d-join">
        <h1 className="d-brand">한 표</h1>
        <p className="d-sub">QR을 찍거나 코드를 입력하세요</p>
        <div className="d-code" data-testid="display-code" role="img" aria-label={`방 코드 ${code}`}>
          {[...code].map((digit, index) => (
            <b key={index}>{digit}</b>
          ))}
        </div>
        <div className="d-qrrow">
          <div className="d-qr" data-testid="display-join-qr">
            <QrCode text={joinUrl} label="입장용 QR 코드" />
          </div>
          <p className="d-url">{joinUrl.replace(/^https?:\/\//, '')}</p>
        </div>
      </div>
      <div className="d-roster">
        <p className="d-count" aria-live="polite">
          <b data-testid="display-count">{participants.length}</b>명 입장
        </p>
        <p className="d-sub">운영자가 투표를 만들고 있어요</p>
        {participants.length === 0 ? (
          <p className="d-sub d-empty">아직 아무도 들어오지 않았어요</p>
        ) : (
          <ul className="d-chips" data-size={chipSize(shown.length)}>
            {shown.map((person) => (
              <li key={person.id} className={person.connected ? undefined : 'off'} data-testid="display-chip">
                {person.nickname}
              </li>
            ))}
            {participants.length > shown.length ? <li className="more">외 {participants.length - shown.length}명</li> : null}
          </ul>
        )}
      </div>
    </section>
  );
}

interface VotingProps {
  vote: VotePublic;
  submitted: number;
  total: number;
}

export function DisplayVoting({ vote, submitted, total }: VotingProps) {
  const share = total === 0 ? 0 : Math.min(100, (submitted / total) * 100);
  return (
    <section className="d-voting" data-testid="display-voting" aria-label="투표 진행">
      <h1 className="d-title" data-testid="display-title" data-size={titleSize(vote.title)}>
        {vote.title}
      </h1>
      <p className="d-meta">{voteKindLabel(vote)}</p>
      <div className="d-progress">
        <p className="d-progress-line" aria-live="polite" aria-atomic="true">
          <b data-testid="display-progress">
            {submitted} / {total}
          </b>
          <span>명 제출</span>
        </p>
        <div
          className="d-bar"
          role="progressbar"
          aria-label="제출 현황"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(submitted, total)}
        >
          <i style={{ width: `${share}%` }} />
        </div>
      </div>
    </section>
  );
}

export function DisplayClosed({ vote, reveal }: { vote: VotePublic; reveal: DisplayReveal }) {
  const { cursor, total, mode, hidden, current, tally } = reveal;
  const options = vote.paper.kind === 'choice' ? vote.paper.options : null;
  const paper = useMemo(() => vote.paper, [vote.id]);
  const signature = current?.signature ?? null;
  const content = current?.content;

  // A hidden display, or a paper the server did not send, shows the folded paper and nothing it could say.
  const face = useMemo<StageFace>(() => {
    if (cursor < 0) return { kind: 'pile' };
    if (hidden || !content) return { kind: 'folded' };
    return { kind: 'paper', slot: cursor, content, signature };
  }, [cursor, hidden, content, signature]);

  const header = (
    <header className="d-head">
      <h1 className="d-title d-title--small" data-testid="display-title" data-size={titleSize(vote.title)}>
        {vote.title}
      </h1>
      <p className="d-meta">{voteKindLabel(vote)}</p>
    </header>
  );

  if (total === 0) {
    return (
      <section className="d-closed" data-testid="display-closed" aria-label="결과">
        {header}
        <div className="d-center">
          <p className="d-line" data-testid="display-empty">
            낸 용지가 없어요
          </p>
        </div>
      </section>
    );
  }

  if (!hidden && mode === 'all' && tally && options) {
    return (
      <section className="d-closed" data-testid="display-closed" aria-label="결과">
        {header}
        <div className="d-graph">
          <TallyGraph options={options} tally={tally} ids={GRAPH_IDS} />
        </div>
        <footer className="d-foot">
          <p className="d-note">{total}명이 참여했어요 · 전체 공개</p>
        </footer>
      </section>
    );
  }

  const last = !hidden && cursor === total - 1;
  return (
    <section className="d-closed" data-testid="display-closed" aria-label="결과">
      {header}
      <div className="d-stage">
        <PaperStage face={face} paper={paper} unopened={Math.max(0, total - cursor - 1)} ids={STAGE_IDS} />
      </div>
      <footer className="d-foot">
        {cursor < 0 ? (
          <>
            <p className="d-line">곧 결과를 보여드릴게요</p>
            <p className="d-note">모두 {total}장이 모였어요</p>
          </>
        ) : hidden ? (
          <p className="d-line">잠시 뒤에 공개돼요</p>
        ) : (
          <>
            <p className="d-pos" data-testid="display-position" aria-live="polite" aria-atomic="true">
              {cursor + 1} / {total}
            </p>
            <p className="d-note">{last ? '마지막 용지예요' : ''}</p>
          </>
        )}
      </footer>
    </section>
  );
}
