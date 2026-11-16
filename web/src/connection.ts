import { useCallback, useEffect, useRef, useState } from 'react';
import { serverMsgSchema } from '../../shared/protocol.ts';
import type { ClientMsg, ErrorReason, ServerMsg, View } from '../../shared/protocol.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ConnectionOptions {
  enabled?: boolean;
  // Asked on every socket open, so a reconnect resumes with whatever tokens are stored by then.
  hello: () => ClientMsg | null;
  onMessage?: (msg: ServerMsg) => void;
}

export interface Connection {
  status: ConnectionStatus;
  view: View | null;
  send: (msg: ClientMsg) => boolean;
}

// After one of these the last view no longer belongs to this browser (room gone, token refused).
const IDENTITY_REJECTED: ReadonlySet<ErrorReason> = new Set([
  'room_not_found',
  'bad_host_token',
  'bad_participant_token',
]);

const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 5000;

const socketUrl = (): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export function useConnection({ enabled = true, hello, onMessage }: ConnectionOptions): Connection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [view, setView] = useState<View | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const helloRef = useRef(hello);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    helloRef.current = hello;
    onMessageRef.current = onMessage;
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('connecting');

    const connect = () => {
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('open');
        const first = helloRef.current();
        if (first) socket.send(JSON.stringify(first));
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
        // A valid message proves the server is alive, so only now does the backoff start over.
        attempt = 0;
        if (msg.t === 'error' && msg.reason === 'replaced') {
          stopped = true;
          clearTimeout(timer);
          setStatus('closed');
          socket.close();
        }
        onMessageRef.current?.(msg);
        if (msg.t !== 'error') setView(msg.view);
        else if (IDENTITY_REJECTED.has(msg.reason)) setView(null);
      };

      socket.onclose = () => {
        if (stopped) return;
        socketRef.current = null;
        setStatus('reconnecting');
        const delay = Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_MAX_MS);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = null;
        socket.close();
      }
    };
  }, [enabled]);

  const send = useCallback((msg: ClientMsg): boolean => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }, []);

  return { status, view, send };
}
