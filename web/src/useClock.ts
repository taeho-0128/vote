import { useEffect, useState } from 'react';
import { EXPIRY_WARNING_MS, msUntilLabelChanges } from './expiry.ts';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// Milliseconds left until `deadline` (a performance.now() reading), re-read only when something visible would change:
// when the warning starts, then every minute, then every second.
export function useRemaining(deadline: number | null): number | null {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (deadline === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const left = deadline - performance.now();
      const wait = left > EXPIRY_WARNING_MS ? left - EXPIRY_WARNING_MS + 1 : msUntilLabelChanges(left);
      timer = setTimeout(() => {
        setNow(performance.now());
        schedule();
      }, Math.min(wait, MAX_TIMEOUT_MS));
    };
    setNow(performance.now());
    schedule();
    return () => clearTimeout(timer);
  }, [deadline]);

  return deadline === null ? null : deadline - now;
}

// Whole seconds left of a wait that started when this hook mounted.
export function useCountdown(seconds: number): number {
  const [endsAt] = useState(() => performance.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const read = () => Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
    const timer = setInterval(() => {
      const next = read();
      setLeft(next);
      if (next === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  return left;
}
