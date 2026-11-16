import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { NICKNAME_MAX, normalizeNickname } from '../../../shared/nickname.ts';
import type { ClientMsg, ErrorReason, ParticipantView } from '../../../shared/protocol.ts';
import { Icon } from '../components/Icon.tsx';
import { AppBar, ConnectionBanner, Notice } from '../components/Frame.tsx';
import { Roster } from '../components/Roster.tsx';
import { useConnection } from '../connection.ts';
import { ERROR_COPY } from '../messages.ts';
import {
  clearParticipant,
  getLastNickname,
  getParticipant,
  setLastNickname,
  setParticipant,
} from '../storage.ts';
import { useCommand } from '../useCommand.ts';
import { ParticipantVote } from './ParticipantVote.tsx';

// These end the attempt: the socket closes and the only way forward is the home page.
const DEAD_END: ReadonlySet<ErrorReason> = new Set(['room_not_found', 'replaced']);

// About the seat itself. Once seated, every other error answers a command and the screen stays where it is.
const SEAT_ERRORS: ReadonlySet<ErrorReason> = new Set([
  'room_not_found',
  'replaced',
  'bad_participant_token',
  'nickname_invalid',
  'nickname_taken',
]);

interface Start {
  pendingNickname: string | null;
  formNickname: string;
  error: ErrorReason | null;
}

function startState(code: string): Start {
  const fromQuery = new URLSearchParams(location.search).get('nick');
  const remembered = getParticipant(code)?.nickname ?? getLastNickname();
  if (fromQuery === null) return { pendingNickname: null, formNickname: remembered, error: null };
  const name = normalizeNickname(fromQuery);
  return {
    pendingNickname: name,
    formNickname: [...fromQuery].slice(0, NICKNAME_MAX).join(''),
    error: name === null ? 'nickname_invalid' : null,
  };
}

export function ParticipantScreen({ code }: { code: string }) {
  const [start] = useState(() => startState(code));
  const pending = useRef(start.pendingNickname);
  const [formNickname, setFormNickname] = useState(start.formNickname);
  const [error, setError] = useState<ErrorReason | null>(start.error);
  const [attempting, setAttempting] = useState(() => getParticipant(code) !== null || start.pendingNickname !== null);
  const seated = useRef(false);

  const { status, view, send } = useConnection({
    enabled: error !== 'room_not_found',
    hello: (): ClientMsg | null => {
      const record = getParticipant(code);
      if (record) return { t: 'join', code, nickname: record.nickname, participantToken: record.token };
      return pending.current === null ? null : { t: 'join', code, nickname: pending.current };
    },
    onMessage: (msg) => {
      if (msg.t === 'joined') {
        setParticipant(code, { token: msg.participantToken, nickname: msg.view.me.nickname });
        setLastNickname(msg.view.me.nickname);
        pending.current = null;
        seated.current = true;
        setError(null);
        return;
      }
      if (msg.t !== 'error') return;
      if (seated.current && !SEAT_ERRORS.has(msg.reason)) {
        command.refuse(msg.reason);
        return;
      }
      seated.current = false;
      setAttempting(false);
      pending.current = null;
      setError(msg.reason);
      if (msg.reason === 'room_not_found' || msg.reason === 'bad_participant_token') clearParticipant(code);
      if (msg.reason === 'bad_participant_token') setFormNickname(getLastNickname());
    },
  });

  const lobby: ParticipantView | null = view?.role === 'participant' ? view : null;
  const stage = lobby?.stage;
  const command = useCommand(
    status === 'open',
    stage && stage.kind !== 'lobby' ? `${stage.kind}:${stage.vote.id}:${stage.submitted}` : 'lobby',
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const name = normalizeNickname(formNickname);
    if (name === null) {
      setError('nickname_invalid');
      return;
    }
    pending.current = name;
    setError(null);
    setAttempting(true);
    send({ t: 'join', code, nickname: name });
  };

  if (error !== null && DEAD_END.has(error)) {
    return (
      <div className="app">
        <AppBar />
        <main className="column">
          <Notice
            testId="join-error"
            title={error === 'replaced' ? '자리를 옮겼어요' : '방에 들어갈 수 없어요'}
            message={ERROR_COPY[error]}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppBar>
        <span className="pill">
          <Icon name="users" size={16} />
          방 {code}
          {lobby ? ` · ${lobby.me.nickname}` : ''}
        </span>
      </AppBar>
      <ConnectionBanner status={status} />
      {lobby && stage && stage.kind !== 'lobby' ? (
        <ParticipantVote
          key={stage.vote.id}
          stage={stage}
          nickname={lobby.me.nickname}
          send={send}
          command={command}
        />
      ) : (
        <main className="column">
          {lobby ? (
            <>
              <div className="stack">
                <h1 className="title">입장했어요</h1>
                <div className="me-card panel">
                  <span className="lbl">내 닉네임</span>
                  <p className="me-name" data-testid="my-nickname">
                    {lobby.me.nickname}
                  </p>
                </div>
              </div>
              <Roster
                heading="같은 방에 있는 사람"
                participants={lobby.participants}
                meId={lobby.me.id}
                emptyText="아직 나밖에 없어요."
              />
              <p className="waiting">
                <span className="pulse" aria-hidden="true" />
                운영자가 투표를 만드는 중이에요.
              </p>
            </>
          ) : attempting ? (
            <p className="sub" role="status">
              입장하는 중이에요…
            </p>
          ) : (
            <>
              <div className="stack">
                <h1 className="title">닉네임을 정해 주세요</h1>
                <p className="sub">방 {code}에 입장해요. 같은 방 사람들에게 보이는 이름이에요.</p>
              </div>
              <form className="form" onSubmit={handleSubmit} noValidate>
                <div className="field">
                  <label htmlFor="nickname-input">닉네임</label>
                  <input
                    id="nickname-input"
                    data-testid="nickname-input"
                    className="input"
                    value={formNickname}
                    maxLength={NICKNAME_MAX}
                    autoComplete="nickname"
                    aria-invalid={error === 'nickname_invalid' || error === 'nickname_taken'}
                    aria-describedby={error ? 'join-error' : undefined}
                    onChange={(event) => setFormNickname(event.target.value)}
                  />
                </div>
                {error ? (
                  <p id="join-error" className="form-error" role="alert" data-testid="join-error">
                    {ERROR_COPY[error]}
                  </p>
                ) : null}
                <button type="submit" className="btn wide" data-testid="nickname-submit">
                  입장하기
                </button>
              </form>
            </>
          )}
        </main>
      )}
    </div>
  );
}
