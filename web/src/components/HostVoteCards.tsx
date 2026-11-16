import type { VotePublic } from '../../../shared/protocol.ts';
import { ANONYMITY_LABEL, PAPER_LABEL } from '../voteLabels.ts';

export function Tags({ vote }: { vote: VotePublic }) {
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
