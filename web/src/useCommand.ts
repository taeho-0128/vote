import { useState } from 'react';
import type { ErrorReason } from '../../shared/protocol.ts';

// State that falls back to `initial` the moment `key` changes, so it cannot outlive the situation it was set in.
export function useKeyedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [slot, setSlot] = useState({ key, value: initial });
  if (slot.key !== key) setSlot({ key, value: initial });
  return [slot.key === key ? slot.value : initial, (value) => setSlot({ key, value })];
}

export type Refusal = ErrorReason | 'offline';

interface Outcome {
  readonly busy: boolean;
  readonly refusal: Refusal | null;
}

const IDLE: Outcome = { busy: false, refusal: null };

export interface Command {
  readonly busy: boolean;
  readonly refusal: Refusal | null;
  // Pass what `send` returned: false means the socket was not open and nothing left the browser.
  readonly sent: (delivered: boolean) => void;
  readonly refuse: (reason: ErrorReason) => void;
}

// One command in flight. `settleKey` names the room situation the command is meant to change (stage, vote, my
// submission), so a new key is its success. A dropped connection also ends the wait, since the reply is lost.
export function useCommand(online: boolean, settleKey: string): Command {
  const [outcome, setOutcome] = useKeyedState(`${online}|${settleKey}`, IDLE);
  return {
    ...outcome,
    sent: (delivered) => setOutcome(delivered ? { busy: true, refusal: null } : { busy: false, refusal: 'offline' }),
    refuse: (reason) => setOutcome({ busy: false, refusal: reason }),
  };
}
