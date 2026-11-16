import { useId, useState } from 'react';
import type { ClientMsg, ErrorReason } from '../../../shared/protocol.ts';
import { AppBar, ConnectionBanner, Notice } from '../components/Frame.tsx';
import { Icon } from '../components/Icon.tsx';
import { JoinCard } from '../components/JoinCard.tsx';
import { Roster } from '../components/Roster.tsx';
import { useConnection } from '../connection.ts';
import { ERROR_COPY } from '../messages.ts';
import { clearHostToken, getHostToken } from '../storage.ts';

const NEXT_STEP_HINT = '다음 단계에서 열려요';

// Rendered in the app bar on laptops and in the bottom bar on phones and tablets, never both at once.
function HostActions() {
  const hintId = useId();
  return (
    <div className="actions">
      <span className="hint" id={hintId}>
        {NEXT_STEP_HINT}
      </span>
      <div className="actions-row">
        <button type="button" className="btn ghost" disabled aria-describedby={hintId}>
          대화면 열기
        </button>
        <button type="button" className="btn" disabled aria-describedby={hintId}>
          투표 만들기
        </button>
      </div>
    </div>
  );
}

export function HostScreen({ code }: { code: string }) {
  const [hasToken] = useState(() => getHostToken(code) !== null);
  const [error, setError] = useState<ErrorReason | null>(null);

  const { status, view } = useConnection({
    enabled: hasToken && error === null,
    hello: (): ClientMsg | null => {
      const hostToken = getHostToken(code);
      return hostToken ? { t: 'resumeHost', code, hostToken } : null;
    },
    onMessage: (msg) => {
      if (msg.t !== 'error') return;
      if (msg.reason === 'bad_host_token' || msg.reason === 'room_not_found') clearHostToken(code);
      setError(msg.reason);
    },
  });

  const lobby = view?.role === 'host' ? view : null;

  if (!hasToken || error !== null) {
    return (
      <div className="app">
        <AppBar />
        <main className="column">
          <Notice
            testId="host-error"
            title="운영자 화면을 열 수 없어요"
            message={error ? ERROR_COPY[error] : '이 브라우저에서 만든 방이 아니에요. 방을 만든 기기에서 열어 주세요.'}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app app--host">
      <AppBar>
        <span className="pill">
          <Icon name="users" size={16} />방 {code}
          {lobby ? ` · ${lobby.participants.length}명` : ''}
        </span>
        <div className="bar-actions">
          <HostActions />
        </div>
      </AppBar>
      <ConnectionBanner status={status} />
      {lobby ? (
        <main className="host-main">
          <JoinCard code={code} />
          <Roster
            heading="입장한 사람"
            participants={lobby.participants}
            emptyText="아직 아무도 없어요. QR을 찍거나 코드를 입력하면 여기에 나타나요."
          />
        </main>
      ) : (
        <main className="host-main">
          <p className="sub" role="status">
            방을 불러오는 중이에요…
          </p>
        </main>
      )}
      <div className="bar-bottom">
        <div className="bar-bottom-in">
          <HostActions />
        </div>
      </div>
    </div>
  );
}
