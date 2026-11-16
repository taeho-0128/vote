import { RATE_LIMIT_COPY } from '../messages.ts';
import { useCountdown } from '../useClock.ts';
import { AppBar } from './Frame.tsx';
import { Link } from './Link.tsx';

interface RateLimitNoticeProps {
  // How long the server asked this browser to wait, counted from the moment this notice appears.
  seconds: number;
  onRetry: () => void;
  surface: 'page' | 'display';
}

// One try, on the person's own press, once the wait is over. Nothing here reconnects by itself.
export function RateLimitNotice({ seconds, onRetry, surface }: RateLimitNoticeProps) {
  const left = useCountdown(seconds);
  const ready = left === 0;
  const retry = (
    <button
      type="button"
      className={surface === 'display' ? 'btn d-retry' : 'btn wide'}
      data-testid="rate-limit-retry"
      disabled={!ready}
      onClick={onRetry}
    >
      {ready ? RATE_LIMIT_COPY.retry : RATE_LIMIT_COPY.waiting(left)}
    </button>
  );

  if (surface === 'display') {
    return (
      <div className="d-message" data-testid="rate-limit-message">
        <h1 className="d-title" data-size="m">
          {RATE_LIMIT_COPY.title}
        </h1>
        <p className="d-sub" role="status">
          {ready ? RATE_LIMIT_COPY.ready : RATE_LIMIT_COPY.message(seconds)}
        </p>
        {retry}
        <Link href="/" className="d-link">
          처음으로 돌아가기
        </Link>
      </div>
    );
  }
  return (
    <div className="app">
      <AppBar />
      <main className="column">
        <div className="notice" data-testid="rate-limit-message">
          <h1 className="title">{RATE_LIMIT_COPY.title}</h1>
          <p className="sub" role="status">
            {ready ? RATE_LIMIT_COPY.ready : RATE_LIMIT_COPY.message(seconds)}
          </p>
          {retry}
          <Link href="/" className="btn ghost wide">
            처음으로 돌아가기
          </Link>
        </div>
      </main>
    </div>
  );
}
