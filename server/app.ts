import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sirv from 'sirv';
import { WebSocketServer } from 'ws';
import { systemDeps } from './deps.ts';
import { createHub } from './hub.ts';
import { RoomStore } from './rooms.ts';

// A full sheet of ink (5000 points, four-digit coordinates) is about 57 KB of JSON.
export const MAX_PAYLOAD_BYTES = 65_536;

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
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export async function startServer({ port, staticDir }: ServerOptions): Promise<RunningServer> {
  const hub = createHub(new RoomStore(systemDeps));
  const serveStatic = staticDir && existsSync(staticDir) ? sirv(staticDir, { single: true }) : undefined;

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
    wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws));
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
        hub.close();
        wss.close();
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
