import { EXPIRY_WARNING_MS, remainingOf } from '../expiry.ts';
import { EXPIRY_COPY } from '../messages.ts';
import { useRemaining } from '../useClock.ts';

interface ExpiryBannerProps {
  // performance.now() reading at which the room is deleted, worked out when the host view arrived.
  deadline: number;
  // The vote on screen is closed, has papers, and was never exported.
  unexported: boolean;
  busy: boolean;
  onKeep: () => void;
}

// A persistent strip, not a toast: it stays until the server has given the room a fresh six hours.
export function ExpiryBanner({ deadline, unexported, busy, onKeep }: ExpiryBannerProps) {
  const left = useRemaining(deadline);
  if (left === null || left >= EXPIRY_WARNING_MS) return null;
  const remaining = remainingOf(left);

  return (
    <div className="banner banner--expiry" role="status" data-testid="expiry-banner">
      <div className="banner-in expiry-in">
        <p className="expiry-text">
          {remaining.unit === 'now' ? (
            <span>{EXPIRY_COPY.now}</span>
          ) : (
            <span>
              {EXPIRY_COPY.before}{' '}
              <b data-testid="expiry-minutes">
                {remaining.unit === 'minutes' ? EXPIRY_COPY.minutes(remaining.value) : EXPIRY_COPY.seconds(remaining.value)}
              </b>{' '}
              {EXPIRY_COPY.after}
            </span>
          )}
          {unexported ? <span className="expiry-sub">{EXPIRY_COPY.unexported}</span> : null}
        </p>
        <button type="button" className="btn sm" data-testid="keep-alive" disabled={busy} onClick={onKeep}>
          {busy ? EXPIRY_COPY.keeping : EXPIRY_COPY.keep}
        </button>
      </div>
    </div>
  );
}
