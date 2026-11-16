import { z } from 'zod';
import { tokenSchema } from '../../shared/protocol.ts';

const participantRecordSchema = z.object({ token: tokenSchema, nickname: z.string() });
export type ParticipantRecord = z.infer<typeof participantRecordSchema>;

const hostKey = (code: string) => `hanpyo:host:${code}`;
const participantKey = (code: string) => `hanpyo:participant:${code}`;
const LAST_NICKNAME_KEY = 'hanpyo:nickname';

// Storage can be blocked or throw (private mode, disabled site data). Every call degrades to "nothing stored".
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the page works without persistence */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* the page works without persistence */
  }
}

export function getHostToken(code: string): string | null {
  const parsed = tokenSchema.safeParse(read(hostKey(code)));
  return parsed.success ? parsed.data : null;
}

export const setHostToken = (code: string, token: string): void => write(hostKey(code), token);
export const clearHostToken = (code: string): void => remove(hostKey(code));

export function getParticipant(code: string): ParticipantRecord | null {
  const raw = read(participantKey(code));
  if (raw === null) return null;
  try {
    const parsed = participantRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const setParticipant = (code: string, record: ParticipantRecord): void =>
  write(participantKey(code), JSON.stringify(record));
export const clearParticipant = (code: string): void => remove(participantKey(code));

export const getLastNickname = (): string => read(LAST_NICKNAME_KEY) ?? '';
export const setLastNickname = (nickname: string): void => write(LAST_NICKNAME_KEY, nickname);
