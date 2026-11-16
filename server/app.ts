import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
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
  // Read the client address from the first value of X-Forwarded-For. Only safe behind a proxy that sets it.
  trustProxy?: boolean;
  // Origins besides the server's own host that may open a WebSocket, as `https://example.com`.
  allowedOrigins?: readonly string[];
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
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
