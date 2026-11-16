// A scripted stand-in for the WebSocket server, installed per page with page.routeWebSocket.
// It follows the contract in shared/protocol.ts closely enough to drive the real screens, and it can be told to
// refuse the next command so the refusal paths can be walked.
import { ballotContentSchema, normalizeBallotContent } from '../shared/vote.ts';

const NAMES = ['민준', '서연', '지후', '도윤', '예은', '시우', '하린', '주원', '채원', '지안', '이안', '유나'];
const MANY = ['가온', '은우', '세아', '윤호', '지민', '재이', '아린', '단우', '해든', '나래', '보람', '시현', '예준', '라온', '한결', '새봄', '도하', '이레', '우진', '설아', '찬영', '미르', '다인', '건우', '수아', '로운', '태오', '다온', '나은', '현우', '소율', '준서', '유빈', '하준', '서윤', '지율', '이든', '다솔', '별이'];
const pad = (s) => s.padEnd(24, 'x');
const length = (s) => [...s].length;

function draftProblem(draft) {
  const title = draft.title?.normalize('NFC').trim() ?? '';
  if (length(title) < 1 || length(title) > 60) return 'title';
  if (draft.paper?.kind !== 'choice') return null;
  const options = draft.paper.options.map((o) => o.normalize('NFC').trim());
  if (options.length < 2 || options.length > 8) return 'options_count';
  if (options.some((o) => length(o) < 1 || length(o) > 30)) return 'option';
  if (new Set(options.map((o) => o.toLocaleLowerCase('ko'))).size !== options.length) return 'option_duplicate';
  return null;
}

// The refusal rules are the shared ones, so a ballot the fake accepts is one the real server accepts.
function ballotProblem(content, paper) {
  const parsed = ballotContentSchema.safeParse(content);
  return parsed.success && normalizeBallotContent(parsed.data, paper) ? null : 'bad';
}

export function createFakeRoom() {
  let seq = 0;
  let voteSeq = 0;
  const person = (nickname, connected = true) => {
    seq += 1;
    return { id: `p${seq}`, token: pad(`tok-p${seq}-`), nickname, connected };
  };
  const room = {
    code: '4827',
    hostToken: pad('host-token-'),
    participants: [...NAMES.map((n) => person(n)), person('소율', false), person('가나다라마바사아')],
    sockets: new Set(),
    connections: 0,
    hostResumes: 0,
    refuse: false,
    stage: 'lobby',
    vote: null,
    ballots: new Map(),
    received: [],
    refuseNext: null,
    latency: 0,
  };

  const summaries = () => room.participants.map(({ id, nickname, connected }) => ({ id, nickname, connected }));
  const send = (sock, msg) => sock.ws.send(JSON.stringify(msg));
  const hostStage = () => {
    if (room.stage === 'lobby') return { kind: 'lobby' };
    if (room.stage === 'voting') return { kind: 'voting', vote: room.vote, submittedCount: room.ballots.size };
    return { kind: 'closed', vote: room.vote, ballotCount: room.ballots.size };
  };
  const participantStage = (id) => {
    if (room.stage === 'lobby') return { kind: 'lobby' };
    return { kind: room.stage, vote: room.vote, submitted: room.ballots.has(id), submittedCount: room.ballots.size };
  };
  const viewFor = (sock) => {
    if (sock.role === 'host') {
      const participants = summaries().map((p) => ({ ...p, submitted: room.ballots.has(p.id) }));
      return { role: 'host', code: room.code, stage: hostStage(), participants };
    }
    const me = room.participants.find((p) => p.id === sock.id);
    return {
      role: 'participant',
      code: room.code,
      stage: participantStage(me.id),
      me: { id: me.id, nickname: me.nickname },
      participants: summaries(),
    };
  };

  room.broadcast = () => {
    for (const sock of room.sockets) if (sock.role) send(sock, { t: 'view', view: viewFor(sock) });
  };
  room.add = (nickname, connected = true) => {
    room.participants.push(person(nickname, connected));
    room.broadcast();
  };
  room.fill = (count) => {
    for (const n of MANY) if (room.participants.length < count) room.participants.push(person(n, Math.random() > 0.1));
    room.broadcast();
  };
  room.dropAll = () => {
    room.refuse = true;
    for (const sock of [...room.sockets]) sock.ws.close();
  };
  room.replace = (nickname) => {
    const me = room.participants.find((p) => p.nickname === nickname);
    for (const sock of room.sockets) {
      if (sock.id !== me.id) continue;
      send(sock, { t: 'error', reason: 'replaced', message: 'replaced' });
      sock.ws.close();
    }
  };
  // Somebody else's ballot arriving while the host watches.
  room.submitAs = (nickname, content) => {
    const me = room.participants.find((p) => p.nickname === nickname);
    room.ballots.set(me.id, content);
    room.broadcast();
  };
  room.submitMany = (count) => {
    const text = { kind: 'text', text: '고마웠어요' };
    const choice = { kind: 'choice', optionIndex: 0 };
    room.participants.slice(0, count).forEach((p) => room.ballots.set(p.id, room.vote?.paper.kind === 'choice' ? choice : text));
    room.broadcast();
  };
  room.ballotOf = (nickname) => room.ballots.get(room.participants.find((p) => p.nickname === nickname)?.id);
  room.commands = (type) => room.received.filter((m) => m.t === type);

  const handleCommand = (sock, msg, fail) => {
    room.received.push(msg);
    if (room.refuseNext) {
      const reason = room.refuseNext;
      room.refuseNext = null;
      return fail(reason);
    }
    if (msg.t === 'startVote') {
      if (sock.role !== 'host') return fail('not_host');
      if (room.stage !== 'lobby') return fail('wrong_stage');
      if (draftProblem(msg.draft)) return fail('bad_vote');
      voteSeq += 1;
      const { title, anonymity, paper } = msg.draft;
      room.vote = { id: `v${voteSeq}`, title: title.trim(), anonymity, paper };
      room.ballots = new Map();
      room.stage = 'voting';
    } else if (msg.t === 'closeVote') {
      if (sock.role !== 'host') return fail('not_host');
      if (room.stage !== 'voting') return fail('wrong_stage');
      if (msg.voteId !== room.vote.id) return fail('stale_vote');
      room.stage = 'closed';
    } else if (msg.t === 'dismissVote') {
      if (sock.role !== 'host') return fail('not_host');
      if (room.stage !== 'closed') return fail('wrong_stage');
      if (msg.voteId !== room.vote.id) return fail('stale_vote');
      room.stage = 'lobby';
      room.vote = null;
      room.ballots = new Map();
    } else if (msg.t === 'submitBallot') {
      if (sock.role !== 'participant') return fail('not_bound');
      if (room.stage !== 'voting') return fail('wrong_stage');
      if (msg.voteId !== room.vote.id) return fail('stale_vote');
      if (room.ballots.has(sock.id)) return fail('already_submitted');
      if (ballotProblem(msg.content, room.vote.paper)) return fail('bad_ballot');
      room.ballots.set(sock.id, msg.content);
    }
    room.broadcast();
  };

  room.install = (page) =>
    page.routeWebSocket('**/ws', (ws) => {
      const sock = { ws, role: null, id: null };
      if (room.refuse) {
        ws.close();
        return;
      }
      room.sockets.add(sock);
      room.connections += 1;
      const fail = (reason) => send(sock, { t: 'error', reason, message: reason });
      ws.onClose(() => {
        room.sockets.delete(sock);
        const me = room.participants.find((p) => p.id === sock.id);
        if (me) {
          me.connected = false;
          room.broadcast();
        }
      });
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.t === 'createRoom') {
          sock.role = 'host';
          send(sock, { t: 'hosted', hostToken: room.hostToken, view: viewFor(sock) });
        } else if (msg.t === 'resumeHost') {
          if (msg.code !== room.code) return fail('room_not_found');
          if (msg.hostToken !== room.hostToken) return fail('bad_host_token');
          room.hostResumes += 1;
          sock.role = 'host';
          send(sock, { t: 'view', view: viewFor(sock) });
        } else if (msg.t === 'join') {
          if (msg.code !== room.code) return fail('room_not_found');
          let me = msg.participantToken ? room.participants.find((p) => p.token === msg.participantToken) : undefined;
          if (msg.participantToken && !me) return fail('bad_participant_token');
          if (!me) {
            if (room.participants.some((p) => p.nickname === msg.nickname)) return fail('nickname_taken');
            me = person(msg.nickname);
            room.participants.push(me);
          }
          me.connected = true;
          sock.role = 'participant';
          sock.id = me.id;
          send(sock, { t: 'joined', participantToken: me.token, view: viewFor(sock) });
          room.broadcast();
        } else if (room.latency > 0) {
          setTimeout(() => handleCommand(sock, msg, fail), room.latency);
        } else {
          handleCommand(sock, msg, fail);
        }
      });
    });

  return room;
}
