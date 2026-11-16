import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { tokenSchema } from '../../../shared/protocol.ts';
import type { ClientMsg, ErrorReason } from '../../../shared/protocol.ts';
import { DisplayClosed, DisplayLobby, DisplayVoting } from '../components/DisplayStages.tsx';
import { Icon } from '../components/Icon.tsx';
import { RateLimitNotice } from '../components/RateLimitNotice.tsx';
import { RoomClosed } from '../components/RoomClosed.tsx';
import { useConnection } from '../connection.ts';
import { ERROR_COPY } from '../messages.ts';
import { waitSecondsFrom } from '../rateLimit.ts';
import { useFullscreen } from '../useFullscreen.ts';

// The page is view-only. Every error it can get means this address will not work, so it stops trying.
export function DisplayScreen({ code, token }: { code: string; token: string }) {
  const tokenOk = tokenSchema.safeParse(token).success;
  const [fatal, setFatal] = useState<ErrorReason | null>(tokenOk ? null : 'bad_display_token');
  const root = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(root);
  const [limit, setLimit] = useState<{ id: number; seconds: number } | null>(null);
  const [generation, setGeneration] = useState(0);

  const { status, view, expired } = useConnection({
    enabled: fatal === null,
    generation,
    hello: (): ClientMsg => ({ t: 'watch', code, displayToken: token }),
    onMessage: (msg) => {
      if (msg.t !== 'error' || msg.reason === 'room_expired') return;
      if (msg.reason === 'rate_limited') setLimit((current) => ({ id: (current?.id ?? 0) + 1, seconds: waitSecondsFrom(msg.message) }));
      else setFatal(msg.reason);
    },
  });

  useEffect(() => {
    document.title = '한 표 · 대화면';
    return () => {
      document.title = '한 표';
    };
  }, []);

  const display = view?.role === 'display' ? view : null;
  const stage = display?.stage;

  let content: ReactNode;
  if (expired) {
    content = <RoomClosed role="display" />;
  } else if (limit) {
    content = (
      <RateLimitNotice
        key={limit.id}
        seconds={limit.seconds}
        surface="display"
        onRetry={() => {
          setLimit(null);
          setGeneration((value) => value + 1);
        }}
      />
    );
  } else if (fatal !== null) {
    content = (
      <div className="d-message" role="alert" data-testid="display-error">
        <h1 className="d-title" data-size="m">
          대화면을 열 수 없어요
        </h1>
        <p className="d-sub">{ERROR_COPY[fatal]}</p>
      </div>
    );
  } else if (!display || !stage) {
    content = (
      <p className="d-message d-sub" role="status" data-testid="display-loading">
        {status === 'reconnecting' ? '연결이 끊겼어요. 다시 연결하는 중…' : '대화면을 불러오는 중이에요…'}
      </p>
    );
  } else if (stage.kind === 'lobby') {
    content = <DisplayLobby code={display.code} participants={stage.participants} />;
  } else if (stage.kind === 'voting') {
    content = <DisplayVoting vote={stage.vote} submitted={stage.submittedCount} total={stage.participantCount} />;
  } else {
    content = <DisplayClosed vote={stage.vote} reveal={stage.reveal} />;
  }

  return (
    <div className="display" ref={root} data-testid="display-root" data-stage={expired ? 'expired' : limit ? 'limited' : (stage?.kind ?? (fatal ? 'error' : 'loading'))}>
      <div className="display-in">{content}</div>
      {status === 'reconnecting' && display && !expired ? (
        <p className="d-banner" role="status" data-testid="display-banner">
          연결이 끊겼어요. 다시 연결하는 중…
        </p>
      ) : null}
      {fullscreen.supported && fatal === null && !expired && !limit ? (
        <button
          type="button"
          className="d-fs"
          data-testid="display-fullscreen"
          aria-label={fullscreen.active ? '전체화면 나가기' : '전체화면'}
          onClick={fullscreen.toggle}
        >
          <Icon name={fullscreen.active ? 'shrink' : 'expand'} size={22} />
        </button>
      ) : null}
    </div>
  );
}
