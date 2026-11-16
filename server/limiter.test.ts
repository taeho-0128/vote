import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer, clientAddress, normalizeAddress } from './app.ts';
import type { RunningServer } from './app.ts';
import { AttemptLimiter } from './limiter.ts';
import { TestClient, startTestHub } from './testkit.ts';
import type { TestHub } from './testkit.ts';

describe('AttemptLimiter', () => {
  let clock: number;
  let limiter: AttemptLimiter;

  beforeEach(() => {
    clock = 1_000_000;
    limiter = new AttemptLimiter({ now: () => clock });
  });

  const fail = (address: string, times = 1) => {
    for (let i = 0; i < times; i++) limiter.recordFailure(address);
  };

  it('lets an address with 7 failures keep trying', () => {
    fail('a', 7);
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('locks an address for 60 seconds after 8 failures', () => {
    fail('a', 8);
    expect(limiter.retryAfterMs('a')).toBe(60_000);
    clock += 25_000;
    expect(limiter.retryAfterMs('a')).toBe(35_000);
    clock += 34_999;
    expect(limiter.retryAfterMs('a')).toBe(1);
  });

  it('lets the address back in after 60 seconds, with a clean slate', () => {
    fail('a', 8);
    clock += 60_000;
    expect(limiter.retryAfterMs('a')).toBe(0);
    fail('a', 7);
    expect(limiter.retryAfterMs('a')).toBe(0);
    fail('a');
    expect(limiter.retryAfterMs('a')).toBe(60_000);
  });

  it('counts failures in a sliding 60-second window', () => {
    fail('a', 4);
    clock += 30_000;
    fail('a', 3);
    clock += 29_999;
    fail('a');
    expect(limiter.retryAfterMs('a')).toBe(60_000);

    const slow = new AttemptLimiter({ now: () => clock });
    for (let i = 0; i < 20; i++) {
      slow.recordFailure('b');
      clock += 9_000;
    }
    expect(slow.retryAfterMs('b')).toBe(0);
  });

  it('forgets failures older than the window', () => {
    fail('a', 7);
    clock += 60_000;
    fail('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('keeps addresses apart', () => {
    fail('a', 8);
    expect(limiter.retryAfterMs('a')).toBeGreaterThan(0);
    expect(limiter.retryAfterMs('b')).toBe(0);
    fail('b', 7);
    expect(limiter.retryAfterMs('b')).toBe(0);
  });

  it('does not count a refused attempt, so a locked address cannot extend its own lock', () => {
    fail('a', 8);
    clock += 30_000;
    expect(limiter.retryAfterMs('a')).toBe(30_000);
    expect(limiter.retryAfterMs('a')).toBe(30_000);
  });

  it('forgets idle addresses, so the table does not grow without bound', () => {
    for (let i = 0; i < 500; i++) fail(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    expect(limiter.size).toBe(500);
    clock += 60_000;
    expect(limiter.retryAfterMs('someone else')).toBe(0);
    expect(limiter.size).toBe(0);
  });

  it('keeps a locked address in the table until its lock ends', () => {
    fail('a', 8);
    clock += 59_999;
    fail('b');
    expect(limiter.size).toBe(2);
    expect(limiter.retryAfterMs('a')).toBe(1);
  });

  it('caps the table when many addresses fail inside one window, dropping the oldest first', () => {
    const small = new AttemptLimiter({ now: () => clock, maxAddresses: 100 });
    for (let i = 0; i < 1000; i++) small.recordFailure(`addr-${i}`);
    expect(small.size).toBe(100);
    for (let i = 0; i < 8; i++) small.recordFailure('addr-999');
    expect(small.retryAfterMs('addr-999')).toBe(60_000);
  });
});

describe('clientAddress', () => {
  const request = (headers: Record<string, string | string[]>, remoteAddress?: string) =>
    ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

  it('uses the socket address when the proxy is not trusted, whatever the header says', () => {
    expect(clientAddress(request({ 'x-forwarded-for': '9.9.9.9' }, '1.1.1.1'), false)).toBe('1.1.1.1');
  });

  it('uses only the last value of X-Forwarded-For when the proxy is trusted', () => {
    expect(clientAddress(request({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 7.7.7.7' }, '1.1.1.1'), true)).toBe('7.7.7.7');
    expect(clientAddress(request({ 'x-forwarded-for': ' 9.9.9.9 ,  8.8.8.8 ' }, '1.1.1.1'), true)).toBe('8.8.8.8');
    expect(clientAddress(request({ 'x-forwarded-for': '2.2.2.2' }, '1.1.1.1'), true)).toBe('2.2.2.2');
  });

  it('does not let a value the client wrote in front change the address the proxy appended', () => {
    const honest = clientAddress(request({ 'x-forwarded-for': '2.2.2.2' }, '1.1.1.1'), true);
    for (const spoof of ['6.6.6.6, 2.2.2.2', '6.6.6.6,7.7.7.7,2.2.2.2', '::1, 127.0.0.1, 2.2.2.2', 'unknown, 2.2.2.2']) {
      expect(clientAddress(request({ 'x-forwarded-for': spoof }, '1.1.1.1'), true)).toBe(honest);
    }
  });

  it('reads the last value across several header lines', () => {
    expect(clientAddress(request({ 'x-forwarded-for': ['9.9.9.9, 8.8.8.8', '7.7.7.7'] }, '1.1.1.1'), true)).toBe('7.7.7.7');
    expect(clientAddress(request({ 'x-forwarded-for': ['9.9.9.9', ' ', ''] }, '1.1.1.1'), true)).toBe('9.9.9.9');
  });

  it('skips empty values, so a trailing comma does not turn into an empty key', () => {
    expect(clientAddress(request({ 'x-forwarded-for': '2.2.2.2, ' }, '1.1.1.1'), true)).toBe('2.2.2.2');
    expect(clientAddress(request({ 'x-forwarded-for': ',, 2.2.2.2,' }, '1.1.1.1'), true)).toBe('2.2.2.2');
  });

  it('falls back to the socket address when a trusted header is missing, empty, or ends in something that is not an address', () => {
    expect(clientAddress(request({}, '1.1.1.1'), true)).toBe('1.1.1.1');
    expect(clientAddress(request({ 'x-forwarded-for': '' }, '1.1.1.1'), true)).toBe('1.1.1.1');
    expect(clientAddress(request({ 'x-forwarded-for': ' , ,' }, '1.1.1.1'), true)).toBe('1.1.1.1');
    expect(clientAddress(request({ 'x-forwarded-for': '2.2.2.2, not-an-ip' }, '1.1.1.1'), true)).toBe('1.1.1.1');
    expect(clientAddress(request({}, undefined), true)).toBe('unknown');
  });

  it('gives an IPv4 client one key whether it arrives as 1.2.3.4 or as ::ffff:1.2.3.4, on the socket or in the header', () => {
    expect(clientAddress(request({}, '::ffff:1.2.3.4'), false)).toBe('1.2.3.4');
    expect(clientAddress(request({}, '1.2.3.4'), false)).toBe('1.2.3.4');
    expect(clientAddress(request({ 'x-forwarded-for': '9.9.9.9, ::ffff:1.2.3.4' }, '10.0.0.1'), true)).toBe('1.2.3.4');
    expect(clientAddress(request({ 'x-forwarded-for': '::FFFF:0102:0304' }, '10.0.0.1'), true)).toBe('1.2.3.4');
    expect(clientAddress(request({}, '::ffff:1.2.3.4'), true)).toBe('1.2.3.4');
  });

  it('gives an IPv6 client one key however the address is written', () => {
    const key = clientAddress(request({ 'x-forwarded-for': '2001:db8::1' }, '10.0.0.1'), true);
    expect(key).toBe('2001:db8::1');
    for (const spelling of ['2001:DB8::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '[2001:db8::1]', '[2001:db8::1]:443', '2001:db8::1%eth0']) {
      expect(clientAddress(request({ 'x-forwarded-for': `6.6.6.6, ${spelling}` }, '10.0.0.1'), true)).toBe(key);
    }
  });

  it('strips a port from an IPv4 value', () => {
    expect(clientAddress(request({ 'x-forwarded-for': '2.2.2.2:51234' }, '10.0.0.1'), true)).toBe('2.2.2.2');
  });
});

describe('normalizeAddress', () => {
  it('returns undefined for anything that is not an IP address', () => {
    for (const bad of ['', 'unknown', 'localhost', '1.2.3', '1.2.3.4.5', '01.2.3.4', '256.1.1.1', '2001:db8::zz', '1.2.3.4, 5.6.7.8']) {
      expect(normalizeAddress(bad), bad).toBeUndefined();
    }
  });

  it('leaves a plain IPv4 and IPv6 address as they are', () => {
    expect(normalizeAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeAddress('::1')).toBe('::1');
  });
});

describe('guessing a room code', () => {
  let hub: TestHub;
  let clients: TestClient[];

  beforeEach(async () => {
    hub = await startTestHub({ codes: ['1234'] });
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    await hub.close();
  });

  async function connect(address = '10.0.0.1'): Promise<TestClient> {
    const client = await TestClient.connect(hub.port, { headers: { 'x-forwarded-for': address } });
    clients.push(client);
    return client;
  }

  async function openRoom() {
    const host = await connect('10.9.9.9');
    host.send({ t: 'createRoom' });
    const { view, hostToken } = await host.expect('hosted');
    return { host, code: view.code, hostToken, displayToken: view.displayToken };
  }

  const wrongCode = (code: string) => (code === '0000' ? '0001' : '0000');
  const WRONG_TOKEN = 'z'.repeat(24);

  async function failEight(client: TestClient, guess: (client: TestClient) => void, reason: string) {
    for (let i = 0; i < 8; i++) {
      guess(client);
      await client.expectError(reason);
    }
  }

  it('locks out an address after 8 wrong guesses, and the 9th is refused even with the right code', async () => {
    const { code } = await openRoom();
    const guesser = await connect();
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');

    guesser.send({ t: 'join', code, nickname: 'Eve' });
    const refused = await guesser.expect('error');
    expect(refused.reason).toBe('rate_limited');
    expect(refused.message).toContain('60초');
  });

  it('tells a locked client nothing about which rooms exist', async () => {
    const { code } = await openRoom();
    const guesser = await connect();
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');

    guesser.send({ t: 'join', code, nickname: 'Eve' });
    const real = await guesser.expect('error');
    guesser.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' });
    const fake = await guesser.expect('error');
    expect(real).toEqual(fake);
  });

  it('counts down the seconds in the message, rounded up', async () => {
    const { code } = await openRoom();
    const guesser = await connect();
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');

    hub.deps.tick(59_500);
    guesser.send({ t: 'join', code, nickname: 'Eve' });
    expect((await guesser.expect('error')).message).toContain('1초');
  });

  it('lets the address in again once the 60 seconds are over', async () => {
    const { code } = await openRoom();
    const guesser = await connect();
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');

    hub.deps.tick(60_000);
    guesser.send({ t: 'join', code, nickname: 'Eve' });
    await guesser.expect('joined');
  });

  it.each([
    ['join with an unknown room', (code: string) => ({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found'],
    ['join with a token nobody holds', (code: string) => ({ t: 'join', code, nickname: 'Eve', participantToken: WRONG_TOKEN }), 'bad_participant_token'],
    ['watch with an unknown room', (code: string) => ({ t: 'watch', code: wrongCode(code), displayToken: WRONG_TOKEN }), 'room_not_found'],
    ['watch with a wrong display token', (code: string) => ({ t: 'watch', code, displayToken: WRONG_TOKEN }), 'bad_display_token'],
    ['resumeHost with an unknown room', (code: string) => ({ t: 'resumeHost', code: wrongCode(code), hostToken: WRONG_TOKEN }), 'room_not_found'],
    ['resumeHost with a wrong host token', (code: string) => ({ t: 'resumeHost', code, hostToken: WRONG_TOKEN }), 'bad_host_token'],
  ])('counts a failed attempt: %s', async (_name, guess, reason) => {
    const { code } = await openRoom();
    const guesser = await connect();
    await failEight(guesser, (c) => c.send(guess(code)), reason);

    for (const msg of [
      { t: 'join', code, nickname: 'Eve' },
      { t: 'watch', code, displayToken: WRONG_TOKEN },
      { t: 'resumeHost', code, hostToken: WRONG_TOKEN },
    ]) {
      guesser.send(msg);
      await guesser.expectError('rate_limited');
    }
  });

  it('still lets a locked address create a room', async () => {
    const { code } = await openRoom();
    const guesser = await connect();
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');
    guesser.send({ t: 'createRoom' });
    await guesser.expect('hosted');
  });

  it('does not count nickname problems, bad messages or an already bound socket', async () => {
    const { code } = await openRoom();
    const typist = await connect();
    for (let i = 0; i < 12; i++) {
      typist.send({ t: 'join', code, nickname: '' });
      await typist.expectError('nickname_invalid');
      typist.send('not json');
      await typist.expectError('bad_message');
    }

    const alice = await connect();
    alice.send({ t: 'join', code, nickname: 'Alice' });
    await alice.expect('joined');
    for (let i = 0; i < 12; i++) {
      typist.send({ t: 'join', code, nickname: 'Alice' });
      await typist.expectError('nickname_taken');
    }

    for (let i = 0; i < 12; i++) {
      alice.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' });
      await alice.expectError('already_bound');
    }

    typist.send({ t: 'join', code, nickname: 'Bob' });
    await typist.expect('joined');
  });

  it('does not let successes between failures reset the count', async () => {
    const { code } = await openRoom();
    const guesser = await connect();
    for (let i = 0; i < 4; i++) {
      guesser.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' });
      await guesser.expectError('room_not_found');
      const friend = await connect();
      friend.send({ t: 'join', code, nickname: `Friend${i}` });
      await friend.expect('joined');
    }
    for (let i = 0; i < 4; i++) {
      guesser.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' });
      await guesser.expectError('room_not_found');
    }
    guesser.send({ t: 'join', code, nickname: 'Eve' });
    await guesser.expectError('rate_limited');
  });

  it('keeps one address from affecting another, and counts per address, not per room', async () => {
    const { code } = await openRoom();
    const guesser = await connect('10.0.0.1');
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');

    const classmate = await connect('10.0.0.2');
    classmate.send({ t: 'join', code, nickname: 'Alice' });
    await classmate.expect('joined');

    const sameAddress = await connect('10.0.0.1');
    sameAddress.send({ t: 'join', code, nickname: 'Bob' });
    await sameAddress.expectError('rate_limited');
  });

  it('does not let a locked guesser lock the host out of their own room', async () => {
    const { code, hostToken } = await openRoom();
    const guesser = await connect('10.0.0.1');
    await failEight(guesser, (c) => c.send({ t: 'join', code: wrongCode(code), nickname: 'Eve' }), 'room_not_found');
    const host = await connect('10.9.9.9');
    host.send({ t: 'resumeHost', code, hostToken });
    await host.expect('hosted');
  });
});

describe('the address behind a proxy', () => {
  let server: RunningServer;
  let clients: TestClient[];

  afterEach(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  async function setup(trustProxy: boolean) {
    server = await startServer({ port: 0, trustProxy });
    clients = [];
    const connect = async (forwardedFor?: string) => {
      const headers = forwardedFor ? { 'x-forwarded-for': forwardedFor } : undefined;
      const client = await TestClient.connect(server.port, { headers });
      clients.push(client);
      return client;
    };
    const host = await connect();
    host.send({ t: 'createRoom' });
    const { view } = await host.expect('hosted');
    const wrong = view.code === '0000' ? '0001' : '0000';
    const guessEight = async (client: TestClient) => {
      for (let i = 0; i < 8; i++) {
        client.send({ t: 'join', code: wrong, nickname: 'Eve' });
        await client.expectError('room_not_found');
      }
    };
    return { connect, guessEight, code: view.code };
  }

  it('ignores X-Forwarded-For unless the proxy is trusted, so the header cannot be used to dodge the lock', async () => {
    const { connect, guessEight, code } = await setup(false);
    await guessEight(await connect('10.0.0.1'));
    const disguised = await connect('10.0.0.2');
    disguised.send({ t: 'join', code, nickname: 'Eve' });
    await disguised.expectError('rate_limited');
  });

  it('tells clients apart by the last X-Forwarded-For value when the proxy is trusted', async () => {
    const { connect, guessEight, code } = await setup(true);
    await guessEight(await connect('172.16.0.1, 10.0.0.1'));

    const other = await connect('172.16.0.1, 10.0.0.2');
    other.send({ t: 'join', code, nickname: 'Alice' });
    await other.expect('joined');

    const sameClient = await connect('172.16.0.99, 10.0.0.1');
    sameClient.send({ t: 'join', code, nickname: 'Bob' });
    await sameClient.expectError('rate_limited');
  });

  it('does not let a client dodge the lock by writing a different first value into X-Forwarded-For', async () => {
    const { connect, guessEight, code } = await setup(true);
    await guessEight(await connect('1.1.1.1, 2.2.2.2'));

    for (const spoof of ['3.3.3.3, 2.2.2.2', '4.4.4.4, 5.5.5.5, 2.2.2.2', '::ffff:2.2.2.2']) {
      const disguised = await connect(spoof);
      disguised.send({ t: 'join', code, nickname: 'Eve' });
      await disguised.expectError('rate_limited');
    }
  });
});
