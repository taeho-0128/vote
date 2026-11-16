export const NICKNAME_MAX = 8;

export function normalizeNickname(raw: string): string | null {
  const name = raw.normalize('NFC').trim();
  const length = [...name].length;
  if (length < 1 || length > NICKNAME_MAX) return null;
  if (/\p{Cc}/u.test(name)) return null;
  return name;
}

export function nicknameKey(normalized: string): string {
  return normalized.toLocaleLowerCase('ko');
}
