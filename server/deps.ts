import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Deps } from './rooms.ts';

// Fisher-Yates over a CSPRNG, so a reveal order cannot be predicted from the submission order (D-09).
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const systemDeps: Deps = {
  now: () => Date.now(),
  randomCode: () => String(randomInt(10_000)).padStart(4, '0'),
  randomToken: () => randomBytes(18).toString('base64url'),
  randomId: () => randomUUID(),
  shuffle,
};
