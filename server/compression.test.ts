import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INK_HEIGHT, INK_WIDTH } from '../shared/ink.ts';
import type { InkStroke } from '../shared/ink.ts';
import { MAX_PAYLOAD_BYTES, startServer } from './app.ts';
import type { RunningServer } from './app.ts';
import { TestClient } from './testkit.ts';

let server: RunningServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await startServer({ port: 0 });
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function connect(perMessageDeflate: boolean): Promise<TestClient> {
  const client = await TestClient.connect(server.port, { perMessageDeflate });
  clients.push(client);
  return client;
}

const socketOf = (c: TestClient) => (c.ws as unknown as { _socket: Socket })._socket;
const negotiated = (c: TestClient) => c.ws.extensions.includes('permessage-deflate');

// A pen-like random walk, so the ink compresses about as well as real handwriting, not like a constant.
function handwriting(points: number): InkStroke[] {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  let x = 400;
  let y = 600;
  return Array.from({ length: 6 }, (_, s) => {
    const pts: number[] = [];
    for (let i = 0; i < points / 6; i++) {
      x = Math.min(INK_WIDTH, Math.max(0, x + Math.round((rand() - 0.5) * 24)));
      y = Math.min(INK_HEIGHT, Math.max(0, y + Math.round((rand() - 0.5) * 24)));
      pts.push(x, y);
    }
    return { w: s % 2 ? 'thick' : 'thin', pts };
  });
}

describe('compressed frames', () => {
  it('arrive identical to the uncompressed ones and use far fewer bytes on the wire', async () => {
    const boss = await connect(false);
    boss.send({ t: 'createRoom' });
    const { view, hostToken } = await boss.expect('hosted');
    const squeezed = await connect(true);
    squeezed.send({ t: 'resumeHost', code: view.code, hostToken });
    await squeezed.expect('hosted');
    expect(negotiated(squeezed)).toBe(true);
    expect(negotiated(boss)).toBe(false);

    const pen = await connect(true);
    pen.send({ t: 'join', code: view.code, nickname: 'Pen' });
    await pen.expect('joined');
    await boss.expect('view');
    await squeezed.expect('view');

    boss.send({ t: 'startVote', draft: { title: '손글씨', paper: { kind: 'freeform' }, anonymity: 'anonymous' } });
    const opened = await boss.expectView('host');
    await squeezed.expect('view');
    await pen.expect('view');
    if (opened.stage.kind !== 'voting') throw new Error('vote did not open');
    const voteId = opened.stage.vote.id;
    const strokes = handwriting(2400);
    pen.send({ t: 'submitBallot', voteId, content: { kind: 'ink', strokes } });
    await boss.expect('view');
    await squeezed.expect('view');

    const before = { plain: socketOf(boss).bytesRead, packed: socketOf(squeezed).bytesRead };
    boss.send({ t: 'closeVote', voteId });
    await boss.expect('view');
    await squeezed.expect('view');
    const wire = { plain: socketOf(boss).bytesRead - before.plain, packed: socketOf(squeezed).bytesRead - before.packed };

    // The two frames are built a moment apart, so the countdown may differ by a few milliseconds.
    const withoutCountdown = (frame: string) => ({ ...JSON.parse(frame), view: { ...JSON.parse(frame).view, expiresInMs: 0 } });
    expect(withoutCountdown(squeezed.raw.at(-1)!)).toEqual(withoutCountdown(boss.raw.at(-1)!));
    expect(JSON.parse(squeezed.raw.at(-1)!).view.stage.reveal.ballots[0].content.strokes).toEqual(strokes);
    expect(wire.plain).toBeGreaterThan(15_000);
    expect(wire.packed).toBeLessThan(wire.plain * 0.6);
  });
});

describe('the incoming size cap applies after decompression', () => {
  const padded = (size: number) => {
    const base = JSON.stringify({ t: 'createRoom' });
    return base + ' '.repeat(size - Buffer.byteLength(base));
  };

  it('accepts a message of exactly 65536 bytes that arrives as a few hundred compressed bytes', async () => {
    const client = await connect(true);
    expect(negotiated(client)).toBe(true);
    const sent = padded(MAX_PAYLOAD_BYTES);
    expect(Buffer.byteLength(sent)).toBe(65_536);
    const before = socketOf(client).bytesWritten;
    client.send(sent);
    await client.expect('hosted');
    expect(socketOf(client).bytesWritten - before).toBeLessThan(1000);
  });

  it.each([[MAX_PAYLOAD_BYTES + 1], [70_000]])('closes the socket with 1009 for %i bytes, though it travels as under 1 KB', async (size) => {
    const client = await connect(true);
    expect(negotiated(client)).toBe(true);
    const before = socketOf(client).bytesWritten;
    client.send(padded(size));
    expect(await client.closed).toBe(1009);
    expect(socketOf(client).bytesWritten - before).toBeLessThan(1000);
  });

  it('keeps refusing the same sizes when the client sends them uncompressed', async () => {
    const client = await connect(false);
    client.send(padded(MAX_PAYLOAD_BYTES + 1));
    expect(await client.closed).toBe(1009);
  });
});
