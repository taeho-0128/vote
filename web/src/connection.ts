import { useCallback, useEffect, useRef, useState } from 'react';
import { serverMsgSchema } from '../../shared/protocol.ts';
import type { ClientMsg, ErrorReason, ServerMsg, View } from '../../shared/protocol.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

// A pong only keeps the connection busy, so no screen is ever shown one.
export type SessionMsg = Exclude<ServerMsg, { t: 'pong' }>;

export interface ConnectionOptions {
  enabled?: boolean;
  // Bumped to open a fresh socket after the connection stopped on purpose, such as once a rate limit has run out.
  generation?: number;
  // Asked on every socket open, so a reconnect resumes with whatever tokens are stored by then.
  hello: () => ClientMsg | null;
  onMessage?: (msg: ServerMsg) => void;
}

export interface Connection {
  status: ConnectionStatus;
  view: View | null;
  // The server deleted the room for being idle. Nothing about it can be shown or reached again.
  expired: boolean;
  send: (msg: ClientMsg) => boolean;
}

// After one of these the last view no longer belongs to this browser (room gone, token refused).
const IDENTITY_REJECTED: ReadonlySet<ErrorReason> = new Set([
  'room_not_found',
  'bad_host_token',
  'bad_participant_token',
  'bad_display_token',
]);

// After one of these the server will not change its answer, so the socket closes and nothing reconnects by itself.
const STOPS_CONNECTION: ReadonlySet<ErrorReason> = new Set(['replaced', 'room_expired', 'rate_limited']);

const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 5000;

// A free host sleeps after 15 minutes without inbound traffic and drops every room (D-41), and the server's own ping
// frames may not count. An open socket sends a ping this often, which stays well under that even in a throttled tab.
export const PING_INTERVAL_MS = 4 * 60_000;

const socketUrl = (): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export interface SessionHandlers {
  createSocket: () => WebSocket;
  hello: () => ClientMsg | null;
  onSocket: (socket: WebSocket | null) => void;
  onStatus: (status: ConnectionStatus) => void;
  onMessage: (msg: SessionMsg) => void;
}

// One browser connection and its reconnects. Returns what tears all of it down, the ping timer included.
export function openSession({ createSocket, hello, onSocket, onStatus, onMessage }: SessionHandlers): () => void {
  let stopped = false;
  let attempt = 0;
  let live: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  onStatus('connecting');

  const connect = () => {
    const socket = createSocket();
    live = socket;
    onSocket(socket);

    socket.onopen = () => {
      onStatus('open');
      const first = hello();
      if (first) socket.send(JSON.stringify(first));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'ping' } satisfies ClientMsg));
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      let json: unknown;
      try {
        json = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = serverMsgSchema.safeParse(json);
      if (!parsed.success) return;
      const msg = parsed.data;
      // A valid message proves the server is alive, so only now does the backoff start over. A pong is one.
      attempt = 0;
      if (msg.t === 'pong') return;
      if (msg.t === 'error' && STOPS_CONNECTION.has(msg.reason)) {
        stopped = true;
        clearTimeout(reconnectTimer);
        onStatus('closed');
        socket.close();
      }
      onMessage(msg);
    };

    socket.onclose = () => {
      clearInterval(pingTimer);
      if (stopped) return;
      live = undefined;
      onSocket(null);
      onStatus('reconnecting');
      const delay = Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    onSocket(null);
    if (live) {
      live.onopen = live.onmessage = live.onclose = null;
      live.close();
    }
  };
}

export function useConnection({ enabled = true, generation = 0, hello, onMessage }: ConnectionOptions): Connection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [view, setView] = useState<View | null>(null);
  const [expired, setExpired] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const helloRef = useRef(hello);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    helloRef.current = hello;
    onMessageRef.current = onMessage;
  });

  useEffect(() => {
    if (!enabled) return;
    return openSession({
      createSocket: () => new WebSocket(socketUrl()),
      hello: () => helloRef.current(),
      onSocket: (socket) => {
        socketRef.current = socket;
      },
      onStatus: setStatus,
      onMessage: (msg) => {
        onMessageRef.current?.(msg);
        if (msg.t !== 'error') setView(msg.view);
        else if (msg.reason === 'room_expired') {
          setExpired(true);
          setView(null);
        } else if (IDENTITY_REJECTED.has(msg.reason)) setView(null);
      },
    });
  }, [enabled, generation]);

  const send = useCallback((msg: ClientMsg): boolean => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }, []);

  return { status, view, expired, send };
}
