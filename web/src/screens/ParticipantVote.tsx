import { useEffect, useState } from 'react';
import type { ClientMsg, ParticipantStage } from '../../../shared/protocol.ts';
import { BallotPaper } from '../components/BallotPaper.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Icon } from '../components/Icon.tsx';
import { draftContent, restoreDraft } from '../ballot.ts';
import type { BallotDraft } from '../ballot.ts';
import { ERROR_COPY, OFFLINE_COPY } from '../messages.ts';
import { clearBallotDraft, getBallotDraft, setBallotDraft } from '../storage.ts';
import type { Command } from '../useCommand.ts';

export type VoteStage = Exclude<ParticipantStage, { kind: 'lobby' }>;

interface ParticipantVoteProps {
  stage: VoteStage;
  nickname: string;
  send: (msg: ClientMsg) => boolean;
  command: Command;
}

function AnonymityBadge({ named, nickname }: { named: boolean; nickname: string }) {
  return (
    <div className="badge" data-testid="anon-badge" data-anonymity={named ? 'named' : 'anonymous'}>
      <Icon name={named ? 'pen' : 'eyeoff'} />
      <span>{named ? `공개 화면에 ‘${nickname}’ 이름이 표시돼요` : '공개 화면에 이름이 표시되지 않아요'}</span>
    </div>
  );
}

// The parent keys this by vote id, so the draft below always belongs to the vote on screen.
export function ParticipantVote({ stage, nickname, send, command }: ParticipantVoteProps) {
  const { vote } = stage;
  const submitted = stage.submitted || command.refusal === 'already_submitted';
  const closed = stage.kind === 'closed';
  const [draft, setDraft] = useState<BallotDraft>(() => restoreDraft(getBallotDraft(vote.id), vote.paper));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (submitted || closed) clearBallotDraft(vote.id);
  }, [submitted, closed, vote.id]);

  const update = (next: BallotDraft) => {
    setDraft(next);
    setBallotDraft(vote.id, next);
  };

  const content = draftContent(draft, vote.paper);
  const writing = !closed && !submitted;
  const refusal = command.refusal === null || command.refusal === 'already_submitted' ? null : command.refusal;

  const submit = () => {
    setConfirming(false);
    if (content) command.sent(send({ t: 'submitBallot', voteId: vote.id, content }));
  };

  return (
    <>
      <main className="column">
        <div className="stack">
          <h1 className="title" data-testid="vote-title-view">
            {vote.title}
          </h1>
          {closed ? null : <AnonymityBadge named={vote.anonymity === 'named'} nickname={nickname} />}
        </div>

        {closed ? (
          <section className="notice-card panel">
            <div data-testid="vote-closed-notice" role="status">
              <p className="notice-line">마감됐어요. 운영자가 결과를 보여줄 거예요.</p>
              {stage.submitted ? null : <p className="sub">이번 투표에는 참여하지 않았어요.</p>}
            </div>
          </section>
        ) : submitted ? (
          <section className="notice-card panel">
            <span className="stamp stamp--big" aria-hidden="true">
              확
            </span>
            <div data-testid="ballot-submitted" role="status">
              <p className="notice-line">제출했어요. 마감을 기다리는 중이에요.</p>
            </div>
          </section>
        ) : (
          <BallotPaper
            vote={vote}
            signature={vote.anonymity === 'named' ? nickname : null}
            draft={draft}
            onChange={update}
          />
        )}
      </main>

      {writing ? (
        <div className="bar-bottom">
          <div className="bar-bottom-in">
            {refusal !== null ? (
              <p className="form-error" role="alert" data-testid="ballot-error">
                {refusal === 'offline' ? OFFLINE_COPY : ERROR_COPY[refusal]}
              </p>
            ) : null}
            <button
              type="button"
              className="btn wide"
              data-testid="ballot-submit"
              disabled={content === null || command.busy}
              onClick={() => setConfirming(true)}
            >
              제출하기
            </button>
          </div>
        </div>
      ) : null}

      {writing ? (
        <ConfirmDialog
          open={confirming}
          title="제출하면 고칠 수 없어요"
          cancelLabel="돌아가기"
          confirmLabel="제출하기"
          cancelTestId="ballot-cancel"
          confirmTestId="ballot-confirm"
          onCancel={() => setConfirming(false)}
          onConfirm={submit}
        />
      ) : null}
    </>
  );
}
