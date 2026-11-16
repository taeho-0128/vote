import { useEffect } from 'react';
import { useKeyedState } from './useCommand.ts';

// The value the host just asked for, shown at once while the server's answer is on its way. It gives way to the server's
// value as soon as the two agree, and `resetKey` drops it when the ask can no longer be answered (offline, refused).
export function useIntent<T>(confirmed: T, resetKey: string): [T, (value: T) => void] {
  const [intent, setIntent] = useKeyedState<{ readonly value: T } | null>(resetKey, null);
  useEffect(() => {
    if (intent && intent.value === confirmed) setIntent(null);
  });
  return [intent ? intent.value : confirmed, (value) => setIntent({ value })];
}
