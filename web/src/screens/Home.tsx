import { useState } from 'react';
import type { FormEvent } from 'react';
import { NICKNAME_MAX, normalizeNickname } from '../../../shared/nickname.ts';
import { CODE_LENGTH, CodeInput } from '../components/CodeInput.tsx';
import { AppBar, ConnectionBanner } from '../components/Frame.tsx';
import { useConnection } from '../connection.ts';
import { ERROR_COPY } from '../messages.ts';
import { navigate } from '../route.ts';
import { getLastNickname, setHostToken } from '../storage.ts';

export function Home() {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(CODE_LENGTH).fill(''));
  const [nickname, setNickname] = useState(getLastNickname);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // The socket only opens once the host asks for a room.
  const { status } = useConnection({
    enabled: creating,
    hello: () => ({ t: 'createRoom' }),
    onMessage: (msg) => {
      if (msg.t === 'hosted') {
        setHostToken(msg.view.code, msg.hostToken);
        navigate(`/host/${msg.view.code}`);
      } else if (msg.t === 'error') {
        setCreating(false);
        setCreateError(ERROR_COPY[msg.reason]);
      }
    },
  });

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    const code = digits.join('');
    if (code.length !== CODE_LENGTH) {
      setFormError('방 코드 4자리를 입력해 주세요.');
      return;
    }
    const name = normalizeNickname(nickname);
    if (name === null) {
      setFormError(ERROR_COPY.nickname_invalid);
      return;
    }
    navigate(`/r/${code}?nick=${encodeURIComponent(name)}`);
  };

  const handleCreate = () => {
    setCreateError(null);
    setCreating(true);
  };

  return (
    <div className="app">
      <AppBar>
        <span className="pill">참가자</span>
      </AppBar>
      <ConnectionBanner status={creating ? status : 'connecting'} />
      <main className="column">
        <div className="stack">
          <h1 className="title">
            방 코드를
            <br />
            입력하세요
          </h1>
          <p className="sub">운영자 화면의 QR을 찍으면 바로 입장할 수 있어요.</p>
        </div>
        <form className="form" onSubmit={handleJoin} noValidate>
          <div className="field">
            <span className="lbl">방 코드</span>
            <CodeInput digits={digits} onChange={setDigits} />
          </div>
          <div className="field">
            <label htmlFor="home-nickname">닉네임</label>
            <input
              id="home-nickname"
              data-testid="home-nickname"
              className="input"
              value={nickname}
              maxLength={NICKNAME_MAX}
              autoComplete="nickname"
              onChange={(event) => setNickname(event.target.value)}
            />
          </div>
          <p className="hint">입장하면 같은 방 사람들에게 닉네임이 보여요. 방 안에서 닉네임은 겹칠 수 없어요.</p>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button type="submit" className="btn wide" data-testid="home-join">
            입장하기
          </button>
        </form>
        <section className="host-entry" aria-label="운영자">
          <p className="hint">투표를 진행할 운영자라면</p>
          <button type="button" className="btn-text" data-testid="home-create-room" disabled={creating} onClick={handleCreate}>
            {creating ? '방을 만드는 중…' : '방 만들기'}
          </button>
          {createError ? (
            <p className="form-error" role="alert">
              {createError}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
