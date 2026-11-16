import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { AddressInfo } from 'node:net';
import sirv from 'sirv';
import { WebSocketServer } from 'ws';
import { systemDeps } from './deps.ts';
import { createHub } from './hub.ts';
import { AttemptLimiter } from './limiter.ts';
import { ROOM_TTL_MS, RoomStore } from './rooms.ts';

// A full sheet of ink (5000 points, four-digit coordinates) is about 57 KB of JSON.
export const MAX_PAYLOAD_BYTES = 65_536;

export const DEFAULT_SWEEP_MS = 60_000;

// Compression exists for the host view of a closed vote (up to ~3 MB of ink). Without context takeover no zlib state
// survives a message, so memory does not grow with the socket count. The 8 KiB threshold keeps the many small
// roster and count frames from paying for a zlib stream each. ws hands maxPayload to the inflater, so it limits
// the decompressed size of an incoming message, not its wire size.
const COMPRESSION = {
  threshold: 8192,
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
  zlibDeflateOptions: { level: 3 },
  concurrencyLimit: 4,
} as const;

export interface ServerOptions {
  port: number;
  staticDir?: string;
  ttlMs?: number;
  sweepMs?: number;
  // Read the client address from the last value of X-Forwarded-For, the one the proxy appended. Only safe behind a
  // proxy that always appends it, and only when exactly one trusted proxy sits in front of the server.
  trustProxy?: boolean;
  // Origins besides the server's own host that may open a WebSocket, as `https://example.com`.
  allowedOrigins?: readonly string[];
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MAPPED_IPV4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

// One client must get one limiter key however its address is spelled: IPv6 case and zero compression, an
// IPv4-mapped IPv6 address (what a dual-stack socket reports for an IPv4 peer), a port suffix, a zone id.
// Returns undefined for anything that is not an IP address.
export function normalizeAddress(raw: string): string | undefined {
  let host = raw.trim().replace(/%.*$/, '');
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(host);
  if (bracketed) host = bracketed[1]!;
  else if (/^[\d.]+:\d+$/.test(host)) host = host.slice(0, host.lastIndexOf(':'));
  const family = isIP(host);
  if (family === 4) return host;
  if (family !== 6) return undefined;
  const canonical = new URL(`http://[${host}]`).hostname.slice(1, -1);
  const mapped = MAPPED_IPV4.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

// A proxy appends the address it saw to X-Forwarded-For, while a client can write any values in front of it. So only
// the last value is the proxy's word, and whatever a client puts in front of it cannot change its bucket.
// A last value that is not an address falls back to the socket's, which is the proxy: one shared bucket, never an escape.
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  const socketAddress = req.socket.remoteAddress;
  const fallback = (socketAddress && normalizeAddress(socketAddress)) || socketAddress || 'unknown';
  if (!trustProxy) return fallback;
  const lines = req.headers['x-forwarded-for'];
  const values = (Array.isArray(lines) ? lines : [lines ?? '']).flatMap((line) => line.split(',')).map((v) => v.trim());
  const last = values.findLast((value) => value !== '');
  return (last && normalizeAddress(last)) || fallback;
}

const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '').toLowerCase();

// No Origin header means a client that is not a browser page, which the check does not aim at.
export function isOriginAllowed(req: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const { origin } = req.headers;
  if (origin === undefined) return true;
  if (allowedOrigins.has(normalizeOrigin(origin))) return true;
  try {
    return new URL(origin).host.toLowerCase() === req.headers.host?.toLowerCase();
  } catch {
    return false;
  }
}

export async function startServer({
  port,
  staticDir,
  ttlMs = ROOM_TTL_MS,
  sweepMs = DEFAULT_SWEEP_MS,
  trustProxy = false,
  allowedOrigins = [],
}: ServerOptions): Promise<RunningServer> {
  const hub = createHub(new RoomStore(systemDeps, ttlMs), new AttemptLimiter({ now: systemDeps.now }));
  const allowed = new Set(allowedOrigins.map(normalizeOrigin));
  const serveStatic = staticDir && existsSync(staticDir) ? sirv(staticDir, { single: true }) : undefined;

  const sweeper = setInterval(() => hub.sweep(), sweepMs);
  sweeper.unref();

  const server = createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ok');
    } else if (serveStatic) {
      serveStatic(req, res);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: COMPRESSION });
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(req, allowed)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws, clientAddress(req, trustProxy)));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    close() {
      return new Promise<void>((resolve, reject) => {
        clearInterval(sweeper);
        hub.close();
        wss.close();
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
