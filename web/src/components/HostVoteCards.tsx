import type { VotePublic } from '../../../shared/protocol.ts';

const PAPER_LABEL = { freeform: '자유 기재', choice: '객관식' } as const;
const ANONYMITY_LABEL = { anonymous: '익명', named: '기명' } as const;

function Tags({ vote }: { vote: VotePublic }) {
  return (
    <p className="tags">
      <span className="tag">{PAPER_LABEL[vote.paper.kind]}</span>
      <span className="tag">{ANONYMITY_LABEL[vote.anonymity]}</span>
    </p>
  );
}

interface VotingCardProps {
  vote: VotePublic;
  submitted: number;
  total: number;
}

export function VotingCard({ vote, submitted, total }: VotingCardProps) {
  const share = total === 0 ? 0 : Math.min(100, (submitted / total) * 100);
  return (
    <section className="vote-card panel" aria-labelledby="vote-card-title">
      <p className="lbl">진행 중인 투표</p>
      <h1 id="vote-card-title" className="title" data-testid="vote-heading">
        {vote.title}
      </h1>
      <Tags vote={vote} />
      <p className="progress-line">
        <span>제출</span>
        <b className="progress-count" data-testid="submitted-count" aria-live="polite" aria-atomic="true">
          {submitted} / {total}
        </b>
        <span>명</span>
      </p>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${share}%` }} />
      </div>
    </section>
  );
}

export function ClosedCard({ vote, ballots }: { vote: VotePublic; ballots: number }) {
  return (
    <section className="vote-card panel" aria-labelledby="closed-card-title">
      <p className="lbl">투표 마감</p>
      <h1 id="closed-card-title" className="title">
        마감했어요
      </h1>
      <p className="progress-line">
        <b className="progress-count" data-testid="closed-count">
          {ballots}
        </b>
        <span>장이 모였어요</span>
      </p>
      <p className="sub closed-title">{vote.title}</p>
      <Tags vote={vote} />
      <p className="hint">결과 보기는 다음 단계에서 열려요.</p>
    </section>
  );
}
