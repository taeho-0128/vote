import { describe, expect, it } from 'vitest';
import { parseRoute } from './route.ts';

describe('parseRoute', () => {
  it('reads the display link with its room code and token', () => {
    expect(parseRoute('/d/4827/abcdefghijklmnop')).toEqual({ name: 'display', code: '4827', token: 'abcdefghijklmnop' });
  });

  it('refuses a display link without a token or with a bad code', () => {
    expect(parseRoute('/d/4827').name).toBe('not-found');
    expect(parseRoute('/d/48/abcdefghijklmnop').name).toBe('not-found');
    expect(parseRoute('/d/4827/abcdefghijklmnop/extra').name).toBe('not-found');
  });

  it('keeps the other routes', () => {
    expect(parseRoute('/').name).toBe('home');
    expect(parseRoute('/r/4827')).toEqual({ name: 'participant', code: '4827' });
    expect(parseRoute('/host/4827')).toEqual({ name: 'host', code: '4827' });
  });
});
