import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ClientMsg, ErrorReason, HostView } from '../../../shared/protocol.ts';
import { Composer } from '../components/Composer.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { AppBar, ConnectionBanner, Notice } from '../components/Frame.tsx';
import { HostActions } from '../components/HostActions.tsx';
import type { HostMode } from '../components/HostActions.tsx';
import { DisplayDialog } from '../components/DisplayDialog.tsx';
import { VotingCard } from '../components/HostVoteCards.tsx';
import { Icon } from '../components/Icon.tsx';
import { JoinCard } from '../components/JoinCard.tsx';
import { ResultsView } from '../components/ResultsView.tsx';
import { Roster } from '../components/Roster.tsx';
import { emptyForm, parseForm } from '../composer.ts';
import type { DraftForm } from '../composer.ts';
import { useConnection } from '../connection.ts';
import { ERROR_COPY, OFFLINE_COPY } from '../messages.ts';
import { clearHostToken, getHostToken } from '../storage.ts';
import { useCommand, useKeyedState } from '../useCommand.ts';
import type { Refusal } from '../useCommand.ts';
import { useMediaQuery, WIDE } from '../useMediaQuery.ts';

// Every other error answers a command, and the screen stays where it is.
const IDENTITY_ERRORS: ReadonlySet<ErrorReason> = new Set(['bad_host_token', 'room_not_found']);

const refusalCopy = (refusal: Refusal): string => (refusal === 'offline' ? OFFLINE_COPY : ERROR_COPY[refusal]);

const stageKeyOf = (host: HostView | null): string => {
  if (!host) return 'loading';
  return host.stage.kind === 'lobby' ? 'lobby' : `${host.stage.kind}:${host.stage.vote.id}`;
};

// Moving through the results settles nothing a command waits on, so a refusal clears the moment the reveal moves on.
const settleKeyOf = (host: HostView | null): string => {
  const base = stageKeyOf(host);
  if (host?.stage.kind !== 'closed') return base;
  const { cursor, mode, hidden } = host.stage.reveal;
  return `${base}:${cursor}:${mode}:${hidden}`;
};

export function HostScreen({ code }: { code: string }) {
  const [hasToken] = useState(() => getHostToken(code) !== null);
  const [fatal, setFatal] = useState<ErrorReason | null>(null);
  const wide = useMediaQuery(WIDE);

  const { status, view, send } = useConnection({
    enabled: hasToken && fatal === null,
    hello: (): ClientMsg | null => {
      const hostToken = getHostToken(code);
      return hostToken ? { t: 'resumeHost', code, hostToken } : null;
    },
    onMessage: (msg) => {
      if (msg.t !== 'error') return;
      if (!IDENTITY_ERRORS.has(msg.reason)) {
        command.refuse(msg.reason);
        return;
      }
      clearHostToken(code);
      setFatal(msg.reason);
    },
  });

  const host = view?.role === 'host' ? view : null;
  const stageKey = stageKeyOf(host);
  const command = useCommand(status === 'open', settleKeyOf(host));
  const [displayOpen, setDisplayOpen] = useState(false);
  const [form, setForm] = useKeyedState<DraftForm | null>(stageKey, null);
  const [confirmingClose, setConfirmingClose] = useKeyedState(stageKey, false);

  if (!hasToken || fatal !== null) {
    return (
      <div className="app">
        <AppBar />
        <main className="column">
          <Notice
            testId="host-error"
            title="운영자 화면을 열 수 없어요"
            message={fatal ? ERROR_COPY[fatal] : '이 브라우저에서 만든 방이 아니에요. 방을 만든 기기에서 열어 주세요.'}
          />
        </main>
      </div>
    );
  }

  const run = (msg: ClientMsg) => command.sent(send(msg));
  const stage = host?.stage;
  const total = host?.participants.length ?? 0;
  const pending = stage?.kind === 'voting' ? Math.max(0, total - stage.submittedCount) : 0;
  const mode: HostMode = form ? 'composer' : (stage?.kind ?? 'lobby');

  const startVote = () => {
    const parsed = form ? parseForm(form) : null;
    if (parsed?.ok) run({ t: 'startVote', draft: parsed.draft });
  };
  const closeVote = () => {
    if (stage?.kind === 'voting') run({ t: 'closeVote', voteId: stage.vote.id });
  };
  const dismissVote = () => {
    if (stage?.kind === 'closed') run({ t: 'dismissVote', voteId: stage.vote.id });
  };

  const actions = host ? (
    <HostActions
      mode={mode}
      busy={command.busy}
      canStart={form !== null && parseForm(form).ok}
      onCompose={() => setForm(emptyForm())}
      onCancelCompose={() => setForm(null)}
      onStart={startVote}
      onClose={() => (pending > 0 ? setConfirmingClose(true) : closeVote())}
      onDismiss={dismissVote}
      onOpenDisplay={() => setDisplayOpen(true)}
    />
  ) : null;

  const refusal = command.refusal ? (
    <p className="form-error" role="alert" data-testid="command-error">
      {refusalCopy(command.refusal)}
    </p>
  ) : null;

  let primary: ReactNode = null;
  if (form) primary = <Composer form={form} onChange={setForm} />;
  else if (stage?.kind === 'voting') primary = <VotingCard vote={stage.vote} submitted={stage.submittedCount} total={total} />;

  return (
    <div className="app app--host">
      <AppBar>
        <span className="pill">
          <Icon name="users" size={16} />방 {code}
          {host ? ` · ${total}명` : ''}
        </span>
        {wide ? <div className="bar-actions">{actions}</div> : null}
      </AppBar>
      <div className="banners">
        <ConnectionBanner status={status} />
        {wide && refusal ? (
          <div className="banner banner--error">
            <div className="banner-in">{refusal}</div>
          </div>
        ) : null}
      </div>
      {host && stage?.kind === 'closed' ? (
        <ResultsView
          key={stage.vote.id}
          stage={stage}
          wide={wide}
          online={status === 'open'}
          send={send}
          command={command}
          refusal={refusal}
        />
      ) : host ? (
        <main className="host-main">
          <div className="host-col">
            <JoinCard code={code} folded={mode !== 'lobby'} />
            {primary}
          </div>
          {stage?.kind === 'lobby' ? (
            <Roster
              heading="입장한 사람"
              participants={host.participants}
              emptyText="아직 아무도 없어요. QR을 찍거나 코드를 입력하면 여기에 나타나요."
            />
          ) : (
            <Roster
              heading="제출 현황"
              participants={host.participants}
              phase={stage?.kind}
              emptyText="아직 아무도 없어요. QR을 찍거나 코드를 입력하면 여기에 나타나요."
            />
          )}
        </main>
      ) : (
        <main className="host-main">
          <p className="sub" role="status">
            방을 불러오는 중이에요…
          </p>
        </main>
      )}
      {wide ? null : (
        <div className="bar-bottom">
          <div className="bar-bottom-in">
            {refusal}
            {actions}
          </div>
        </div>
      )}
      {host ? (
        <DisplayDialog
          open={displayOpen}
          url={`${location.origin}/d/${code}/${host.displayToken}`}
          onClose={() => setDisplayOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmingClose}
        title={pending > 0 ? `아직 ${pending}명이 안 냈어요. 지금 마감할까요?` : '모두 제출했어요. 지금 마감할까요?'}
        cancelLabel="돌아가기"
        confirmLabel="마감하기"
        cancelTestId="cancel-close"
        confirmTestId="confirm-close"
        onCancel={() => setConfirmingClose(false)}
        onConfirm={() => {
          setConfirmingClose(false);
          closeVote();
        }}
      />
    </div>
  );
}
