import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg } from '../../shared/protocol.ts';
import { PING_INTERVAL_MS, openSession } from './connection.ts';
import type { ConnectionStatus, SessionMsg } from './connection.ts';

class FakeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('send on a socket that is not open');
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  // The network or the server ends it, which a browser reports as a close event.
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  pings(): number {
    return this.sent.filter((raw) => (JSON.parse(raw) as ClientMsg).t === 'ping').length;
  }
}

let sockets: FakeSocket[];
let statuses: ConnectionStatus[];
let messages: SessionMsg[];

const start = () =>
  openSession({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    hello: () => null,
    onSocket: () => {},
    onStatus: (status) => statuses.push(status),
    onMessage: (msg) => messages.push(msg),
  });

const totalPings = () => sockets.reduce((sum, socket) => sum + socket.pings(), 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  sockets = [];
  statuses = [];
  messages = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the ping that keeps an idle room awake', () => {
  it('is sent once per interval while the socket is open', () => {
    const stop = start();
    sockets[0]!.open();

    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(totalPings()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(totalPings()).toBe(1);
    expect(JSON.parse(sockets[0]!.sent.at(-1)!)).toEqual({ t: 'ping' });

    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(totalPings()).toBe(3);
    stop();
  });

  it('is four minutes apart, so a 15 minute idle limit sees traffic several times over', () => {
    expect(PING_INTERVAL_MS).toBe(240_000);
  });

  it('is not sent while the socket is still connecting', () => {
    const stop = start();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(sockets[0]!.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it('is not sent while the connection is down and waiting to reconnect, or on the socket that has not opened yet', () => {
    const stop = start();
    sockets[0]!.open();
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1000);
    sockets[0]!.drop();
    expect(statuses.at(-1)).toBe('reconnecting');

    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(totalPings()).toBe(0);

    sockets[0]!.drop();
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.sent).toEqual([]);
    stop();
  });

  it('is not sent after the connection stopped on purpose, such as a room that expired', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: 'error', reason: 'room_expired', message: 'closed' });
    expect(statuses.at(-1)).toBe('closed');
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);
    expect(totalPings()).toBe(0);
    expect(sockets).toHaveLength(1);
    stop();
  });

  it('is cleared with the timer when the screen unmounts, even in the middle of an interval', () => {
    const stop = start();
    sockets[0]!.open();
    vi.advanceTimersByTime(PING_INTERVAL_MS / 2);
    expect(vi.getTimerCount()).toBe(1);

    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(PING_INTERVAL_MS * 5);
    expect(totalPings()).toBe(0);
  });

  it('is cleared when unmounting during the wait to reconnect, so no socket opens afterwards', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.drop();
    expect(vi.getTimerCount()).toBe(1);

    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(sockets).toHaveLength(1);
  });

  it('runs on a single timer across reconnects, restarting its interval from the new open', () => {
    const stop = start();
    sockets[0]!.open();
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1000);
    sockets[0]!.drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(totalPings()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(sockets[1]!.pings()).toBe(1);
    expect(sockets[0]!.pings()).toBe(0);

    sockets[1]!.drop();
    vi.advanceTimersByTime(1000);
    sockets[2]!.open();
    sockets[2]!.drop();
    vi.advanceTimersByTime(2000);
    sockets[3]!.open();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(sockets[3]!.pings()).toBe(2);
    expect(totalPings()).toBe(3);
    stop();
  });

  it('keeps the socket from sending when it is closing but its close event has not arrived', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.readyState = 2;
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(sockets[0]!.sent).toEqual([]);
    stop();
  });
});

describe('a pong', () => {
  it('never reaches a screen and changes no status', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: 'pong' });
    expect(messages).toEqual([]);
    expect(statuses).toEqual(['connecting', 'open']);
    stop();
  });

  it('counts as a sign of life like any valid message, so the next reconnect starts from the shortest wait', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.drop();
    vi.advanceTimersByTime(500);
    sockets[1]!.open();
    sockets[1]!.drop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    sockets[2]!.open();
    sockets[2]!.receive({ t: 'pong' });
    sockets[2]!.drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(4);
    stop();
  });

  it('is ignored when it is not a valid message at all, as anything else malformed is', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: '{"t":"pong","extra":' });
    sockets[0]!.receive({ t: 'pongg' });
    expect(messages).toEqual([]);
    stop();
  });

  it('leaves view messages and the stop-the-connection errors as they were', () => {
    const stop = start();
    sockets[0]!.open();
    sockets[0]!.receive({ t: 'error', reason: 'room_not_found', message: 'x' });
    expect(messages).toEqual([{ t: 'error', reason: 'room_not_found', message: 'x' }]);
    expect(statuses.at(-1)).toBe('open');

    sockets[0]!.receive({ t: 'error', reason: 'rate_limited', message: 'x' });
    expect(statuses.at(-1)).toBe('closed');
    expect(messages).toHaveLength(2);
    stop();
  });
});
