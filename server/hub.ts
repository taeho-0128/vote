import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import { clientMsgSchema } from '../shared/protocol.ts';
import type { ClientMsg, ErrorReason, ServerMsg } from '../shared/protocol.ts';
import {
  closeVote,
  dismissVote,
  isDisplayToken,
  isHostToken,
  join,
  revealMode,
  revealMove,
  setConnected,
  setHidden,
  startVote,
  submitBallot,
  touch,
  viewFor,
} from './rooms.ts';
import type { Lifetime, ParticipantId, Room, RoomStore, Transition, Viewer } from './rooms.ts';
import type { AttemptLimiter } from './limiter.ts';

const PING_INTERVAL_MS = 25_000;

// Sent after the `room_expired` error, so a client can tell an expired room from any other close. 4000-4999 is the private range.
export const ROOM_EXPIRED_CLOSE_CODE = 4001;

type Binding =
  | { readonly kind: 'unbound' }
  | { readonly kind: 'host'; readonly code: string }
  | { readonly kind: 'display'; readonly code: string }
  | { readonly kind: 'participant'; readonly code: string; readonly id: ParticipantId };

interface Conn {
  binding: Binding;
  alive: boolean;
  readonly address: string;
}

const ERROR_MESSAGES: Record<ErrorReason, string> = {
  bad_message: '올바르지 않은 메시지예요.',
  already_bound: '이미 방에 연결된 상태예요.',
  room_not_found: '없는 방이에요. 코드를 다시 확인해 주세요.',
  room_full: '지금은 새 방을 만들 수 없어요.',
  bad_host_token: '운영자 확인에 실패했어요.',
  bad_participant_token: '참가자 확인에 실패했어요.',
  bad_display_token: '대화면 링크가 올바르지 않아요.',
  nickname_invalid: '닉네임은 1~8자로 입력해 주세요.',
  nickname_taken: '이미 쓰고 있는 닉네임이에요.',
  replaced: '다른 기기에서 접속해서 이 연결은 종료돼요.',
  not_bound: '먼저 방에 입장해 주세요.',
  not_host: '운영자만 할 수 있어요.',
  wrong_stage: '지금 단계에서는 할 수 없어요.',
  stale_vote: '이미 끝났거나 바뀐 투표예요.',
  bad_vote: '투표 설정이 올바르지 않아요.',
  bad_ballot: '용지 내용이 올바르지 않아요.',
  already_submitted: '이미 제출했어요. 고칠 수 없어요.',
  bad_reveal: '지금은 그렇게 펼칠 수 없어요.',
  rate_limited: '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.',
  room_expired: '오래 쓰지 않아 방이 닫혔어요.',
};

type BindingMsg = Extract<ClientMsg, { t: 'createRoom' | 'resumeHost' | 'join' | 'watch' }>;
type CommandMsg = Exclude<ClientMsg, BindingMsg>;

export interface Hub {
  handleConnection(ws: WebSocket, address: string): void;
  // Removes the rooms idle past the TTL and closes every socket bound to them.
  sweep(): void;
  close(): void;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

function viewerOf(binding: Exclude<Binding, { kind: 'unbound' }>): Viewer {
  switch (binding.kind) {
    case 'host':
      return { kind: 'host' };
    case 'display':
      return { kind: 'display' };
    case 'participant':
      return { kind: 'participant', id: binding.id };
  }
}

export function createHub(store: RoomStore, limiter: AttemptLimiter): Hub {
  const conns = new Map<WebSocket, Conn>();

  const lifetime = (): Lifetime => ({ now: store.deps.now(), ttlMs: store.ttlMs });

  function send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function sendError(ws: WebSocket, reason: ErrorReason, message = ERROR_MESSAGES[reason]): void {
    send(ws, { t: 'error', reason, message });
  }

  // A wrong room code or token counts against the client's address (D-40). Nothing else does.
  function sendGuessError(ws: WebSocket, conn: Conn, reason: ErrorReason): void {
    limiter.recordFailure(conn.address);
    sendError(ws, reason);
  }

  // Asked before any room lookup, so a locked client learns nothing about which rooms exist.
  function isLocked(ws: WebSocket, conn: Conn): boolean {
    const retryAfterMs = limiter.retryAfterMs(conn.address);
    if (retryAfterMs === 0) return false;
    const seconds = Math.ceil(retryAfterMs / 1000);
    sendError(ws, 'rate_limited', `시도가 너무 많아요. ${seconds}초 뒤에 다시 해 주세요.`);
    return true;
  }

  function broadcast(code: string, except?: WebSocket, only?: 'host'): void {
    const room = store.get(code);
    if (!room) return;
    for (const [ws, conn] of conns) {
      const { binding } = conn;
      if (ws === except || binding.kind === 'unbound' || binding.code !== code) continue;
      if (only && binding.kind !== only) continue;
      send(ws, { t: 'view', view: viewFor(room, viewerOf(binding), lifetime()) });
    }
  }

  const touchRoom = (code: string): Room => store.update(code, (room) => touch(room, store.deps.now()));

  function handle(ws: WebSocket, conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case 'createRoom':
      case 'resumeHost':
      case 'join':
      case 'watch':
        return bind(ws, conn, msg);
      default:
        return command(ws, conn, msg);
    }
  }

  function bind(ws: WebSocket, conn: Conn, msg: BindingMsg): void {
    if (conn.binding.kind !== 'unbound') return sendError(ws, 'already_bound');
    if (msg.t !== 'createRoom' && isLocked(ws, conn)) return;

    switch (msg.t) {
      case 'createRoom': {
        const room = store.create();
        if (!room) return sendError(ws, 'room_full');
        conn.binding = { kind: 'host', code: room.code };
        send(ws, { t: 'hosted', hostToken: room.hostToken, view: viewFor(room, { kind: 'host' }, lifetime()) });
        return;
      }
      case 'resumeHost': {
        const found = store.get(msg.code);
        if (!found) return sendGuessError(ws, conn, 'room_not_found');
        if (!isHostToken(found, msg.hostToken)) return sendGuessError(ws, conn, 'bad_host_token');
        const room = touchRoom(found.code);
        conn.binding = { kind: 'host', code: room.code };
        send(ws, { t: 'hosted', hostToken: room.hostToken, view: viewFor(room, { kind: 'host' }, lifetime()) });
        return;
      }
      case 'watch': {
        const room = store.get(msg.code);
        if (!room) return sendGuessError(ws, conn, 'room_not_found');
        if (!isDisplayToken(room, msg.displayToken)) return sendGuessError(ws, conn, 'bad_display_token');
        conn.binding = { kind: 'display', code: room.code };
        send(ws, { t: 'watching', view: viewFor(room, { kind: 'display' }) });
        return;
      }
      case 'join': {
        const room = store.get(msg.code);
        if (!room) return sendGuessError(ws, conn, 'room_not_found');
        const result = join(store.deps, room, { nickname: msg.nickname, participantToken: msg.participantToken });
        if (!result.ok) {
          return result.reason === 'bad_participant_token'
            ? sendGuessError(ws, conn, result.reason)
            : sendError(ws, result.reason);
        }

        const { participant } = result;
        const updated = store.update(room.code, () => result.room);
        evictOtherSockets(ws, room.code, participant.id);
        conn.binding = { kind: 'participant', code: room.code, id: participant.id };
        send(ws, {
          t: 'joined',
          participantToken: participant.token,
          view: viewFor(updated, { kind: 'participant', id: participant.id }),
        });
        broadcast(room.code, ws);
        return;
      }
    }
  }

  function command(ws: WebSocket, conn: Conn, msg: CommandMsg): void {
    const { binding } = conn;
    if (binding.kind === 'unbound') return sendError(ws, 'not_bound');
    if (binding.kind === 'display') return sendError(ws, 'not_host');

    if (msg.t === 'submitBallot') {
      if (binding.kind !== 'participant') return sendError(ws, 'not_bound');
      const { id } = binding;
      return apply(ws, binding.code, (room) => submitBallot(store.deps, room, id, msg.voteId, msg.content));
    }

    if (binding.kind !== 'host') return sendError(ws, 'not_host');
    // Any command from the host counts as activity, even one that is then refused.
    touchRoom(binding.code);
    switch (msg.t) {
      case 'keepAlive':
        return broadcast(binding.code, undefined, 'host');
      case 'startVote':
        return apply(ws, binding.code, (room) => startVote(store.deps, room, msg.draft));
      case 'closeVote':
        return apply(ws, binding.code, (room) => closeVote(store.deps, room, msg.voteId));
      case 'dismissVote':
        return apply(ws, binding.code, (room) => dismissVote(store.deps, room, msg.voteId));
      case 'revealMove':
        return apply(ws, binding.code, (room) => revealMove(store.deps, room, msg.voteId, msg.cursor));
      case 'revealMode':
        return apply(ws, binding.code, (room) => revealMode(store.deps, room, msg.voteId, msg.mode));
      case 'setHidden':
        return apply(ws, binding.code, (room) => setHidden(store.deps, room, msg.voteId, msg.hidden));
    }
  }

  function apply(ws: WebSocket, code: string, transition: (room: Room) => Transition<ErrorReason>): void {
    const room = store.get(code);
    if (!room) return sendError(ws, 'room_not_found');
    const result = transition(room);
    if (!result.ok) return sendError(ws, result.reason);
    store.update(code, () => result.room);
    broadcast(code);
  }

  // The evicted socket is unbound before closing so its close event does not mark the participant disconnected.
  function evictOtherSockets(keep: WebSocket, code: string, id: ParticipantId): void {
    for (const [other, conn] of conns) {
      const { binding } = conn;
      if (other === keep || binding.kind !== 'participant' || binding.code !== code || binding.id !== id) continue;
      conn.binding = { kind: 'unbound' };
      sendError(other, 'replaced');
      other.close();
    }
  }

  function onClose(ws: WebSocket): void {
    const conn = conns.get(ws);
    conns.delete(ws);
    if (conn?.binding.kind !== 'participant') return;
    const { code, id } = conn.binding;
    if (!store.get(code)) return;
    store.update(code, (room) => setConnected(room, id, false));
    broadcast(code);
  }

  // Unbinding first keeps a socket that lingers until its close handshake finishes from acting on a new room with the same code.
  function expire(code: string): void {
    for (const [ws, conn] of conns) {
      const { binding } = conn;
      if (binding.kind === 'unbound' || binding.code !== code) continue;
      conn.binding = { kind: 'unbound' };
      sendError(ws, 'room_expired');
      ws.close(ROOM_EXPIRED_CLOSE_CODE, 'room_expired');
    }
  }

  const heartbeat = setInterval(() => {
    for (const [ws, conn] of conns) {
      if (!conn.alive) {
        ws.terminate();
        continue;
      }
      conn.alive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);
  heartbeat.unref();

  return {
    handleConnection(ws, address) {
      const conn: Conn = { binding: { kind: 'unbound' }, alive: true, address };
      conns.set(ws, conn);

      ws.on('pong', () => {
        conn.alive = true;
      });
      ws.on('message', (data, isBinary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (isBinary) return sendError(ws, 'bad_message');
        let json: unknown;
        try {
          json = JSON.parse(rawToString(data));
        } catch {
          return sendError(ws, 'bad_message');
        }
        const parsed = clientMsgSchema.safeParse(json);
        if (!parsed.success) return sendError(ws, 'bad_message');
        handle(ws, conn, parsed.data);
      });
      ws.on('close', () => onClose(ws));
      // ws emits 'error' before 'close' (e.g. an oversize frame). Without a listener it would crash the process.
      ws.on('error', () => {});
    },

    sweep() {
      for (const { code } of store.sweep(store.deps.now())) expire(code);
    },

    close() {
      clearInterval(heartbeat);
      const sockets = [...conns.keys()];
      conns.clear();
      for (const ws of sockets) ws.terminate();
    },
  };
}
