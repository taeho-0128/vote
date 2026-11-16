import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, ParticipantStage } from '../../../shared/protocol.ts';
import { BallotPaper } from '../components/BallotPaper.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { FoldStage } from '../components/FoldStage.tsx';
import { Icon } from '../components/Icon.tsx';
import { draftContent, restoreDraft } from '../ballot.ts';
import type { BallotDraft } from '../ballot.ts';
import { ERROR_COPY, OFFLINE_COPY } from '../messages.ts';
import { clearBallotDraft, getBallotDraft, setBallotDraft } from '../storage.ts';
import { advance, finishFolding, initialFlow, startSending } from '../submitFlow.ts';
import type { FlowPhase, PaperRect, SubmitFlow } from '../submitFlow.ts';
import type { Command } from '../useCommand.ts';
import { useStageTop } from '../useStageTop.ts';

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
  const closed = stage.kind === 'closed';
  const [draft, setDraft] = useState<BallotDraft>(() => restoreDraft(getBallotDraft(vote.id), vote.paper));
  const [confirming, setConfirming] = useState(false);
  const [recorded, setFlow] = useState<SubmitFlow>(() => initialFlow(stage.submitted));
  const stageRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef<HTMLParagraphElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const lastPhase = useRef<FlowPhase>(recorded.phase);

  const flow = advance(recorded, {
    submitted: stage.submitted,
    count: stage.submittedCount,
    busy: command.busy,
    refusal: command.refusal,
  });
  if (flow !== recorded) setFlow(flow);
  const { phase } = flow;
  const inBox = phase === 'folding' || phase === 'done' || phase === 'static';
  useStageTop(stageRef, headRef);

  useEffect(() => {
    if (inBox || closed) clearBallotDraft(vote.id);
  }, [inBox, closed, vote.id]);

  useEffect(() => {
    if (phase === 'sending') sendingRef.current?.focus({ preventScroll: true });
    if (phase === 'writing' && lastPhase.current === 'sending') submitRef.current?.focus({ preventScroll: true });
    lastPhase.current = phase;
  }, [phase]);

  const update = (next: BallotDraft) => {
    setDraft(next);
    setBallotDraft(vote.id, next);
  };

  const content = draftContent(draft, vote.paper);
  const writing = !closed && !inBox;
  const refusal = command.refusal === null || command.refusal === 'already_submitted' ? null : command.refusal;
  const signature = vote.anonymity === 'named' ? nickname : null;

  const submit = () => {
    setConfirming(false);
    if (!content) return;
    const at = stageRef.current?.querySelector('.paper')?.getBoundingClientRect();
    const rect: PaperRect | null = at ? { left: at.left, top: at.top, width: at.width, height: at.height } : null;
    setFlow(startSending(content, rect));
    command.sent(send({ t: 'submitBallot', voteId: vote.id, content }));
  };

  const message = closed ? (
    <div data-testid="vote-closed-notice">
      <p className="notice-line">마감됐어요. 운영자가 결과를 보여줄 거예요.</p>
    </div>
  ) : (
    <div data-testid="ballot-submitted">
      <p className="notice-line">제출했어요. 마감을 기다리는 중이에요.</p>
    </div>
  );

  return (
    <>
      <main className="column">
        <div className="stack" ref={headRef}>
          <h1 className="title" data-testid="vote-title-view">
            {vote.title}
          </h1>
          {closed ? null : <AnonymityBadge named={vote.anonymity === 'named'} nickname={nickname} />}
        </div>

        {closed && !inBox ? (
          <section className="notice-card panel">
            <div data-testid="vote-closed-notice" role="status">
              <p className="notice-line">마감됐어요. 운영자가 결과를 보여줄 거예요.</p>
              <p className="sub">이번 투표에는 참여하지 않았어요.</p>
            </div>
          </section>
        ) : (
          <div className="fold-stage" data-testid="fold-stage" data-phase={phase} ref={stageRef} inert={phase === 'sending'}>
            {inBox ? (
              <FoldStage
                mode={
                  flow.phase === 'folding'
                    ? {
                        kind: 'folding',
                        content: flow.content,
                        paper: vote.paper,
                        signature,
                        from: flow.from,
                        rect: flow.rect,
                        onDone: () => setFlow((current) => finishFolding(current)),
                      }
                    : { kind: 'rest' }
                }
                count={stage.submittedCount}
              >
                {message}
              </FoldStage>
            ) : (
              <BallotPaper vote={vote} signature={signature} draft={draft} onChange={update} />
            )}
          </div>
        )}
      </main>

      {writing ? (
        <div className="bar-bottom">
          <div className="bar-bottom-in">
            {phase === 'sending' ? (
              <p className="sending" role="status" tabIndex={-1} ref={sendingRef} data-testid="ballot-sending">
                <span className="spinner" aria-hidden="true" />
                제출하는 중…
              </p>
            ) : refusal !== null ? (
              <p className="form-error" role="alert" data-testid="ballot-error">
                {refusal === 'offline' ? OFFLINE_COPY : ERROR_COPY[refusal]}
              </p>
            ) : null}
            <button
              ref={submitRef}
              type="button"
              className="btn wide"
              data-testid="ballot-submit"
              disabled={content === null || command.busy || phase === 'sending'}
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
