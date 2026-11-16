import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Deps } from './rooms.ts';

export const systemDeps: Deps = {
  now: () => Date.now(),
  randomCode: () => String(randomInt(10_000)).padStart(4, '0'),
  randomToken: () => randomBytes(18).toString('base64url'),
  randomId: () => randomUUID(),
};
