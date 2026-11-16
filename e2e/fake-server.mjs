// A scripted stand-in for the WebSocket server, installed per page with page.routeWebSocket.
// It follows the contract in shared/protocol.ts closely enough to drive the real screens, and it can be told to
// refuse the next command so the refusal paths can be walked. Its display view is built by one function that follows the
// real server's privacy rules: only the paper at the cursor, a signature only for a named vote, and no tally while hidden.
import { ballotContentSchema, normalizeBallotContent } from '../shared/vote.ts';

const NAMES = ['민준', '서연', '지후', '도윤', '예은', '시우', '하린', '주원', '채원', '지안', '이안', '유나'];
const MANY = ['가온', '은우', '세아', '윤호', '지민', '재이', '아린', '단우', '해든', '나래', '보람', '시현', '예준', '라온', '한결', '새봄', '도하', '이레', '우진', '설아', '찬영', '미르', '다인', '건우', '수아', '로운', '태오', '다온', '나은', '현우', '소율', '준서', '유빈', '하준', '서윤', '지율', '이든', '다솔', '별이'];
const pad = (s) => s.padEnd(24, 'x');

// A fixed shuffle so a walk knows which paper comes up at each position without reading the page.
function shuffled(ids, seed = 7) {
  const out = [...ids];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
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
    displayToken: pad('display-token-'),
    participants: [...NAMES.map((n) => person(n)), person('소율', false), person('가나다라마바사아')],
    sockets: new Set(),
    connections: 0,
    hostResumes: 0,
    refuse: false,
    stage: 'lobby',
    vote: null,
    ballots: new Map(),
    reveal: null,
    received: [],
    refuseNext: null,
    latency: 0,
  };

  const summaries = () => room.participants.map(({ id, nickname, connected }) => ({ id, nickname, connected }));
  const send = (sock, msg) => {
    const raw = JSON.stringify(msg);
    if (sock.role === 'display') room.displayFrames.push(raw);
    sock.ws.send(raw);
  };
  const openReveal = () => (room.reveal ??= { order: shuffled([...room.ballots.keys()]), cursor: -1, mode: 'one', hidden: false });
  const nicknameOf = (id) => room.participants.find((p) => p.id === id)?.nickname ?? '알 수 없음';
  const orderedBallots = () => openReveal().order.map((id) => ({ id, content: room.ballots.get(id) }));
  const tallyOf = () => {
    const counts = room.vote.paper.options.map(() => 0);
    for (const { content } of orderedBallots()) if (content.kind === 'choice') counts[content.optionIndex] += 1;
    return counts;
  };
  const hostStage = () => {
    if (room.stage === 'lobby') return { kind: 'lobby' };
    if (room.stage === 'voting') return { kind: 'voting', vote: room.vote, submittedCount: room.ballots.size };
    const { cursor, mode, hidden } = openReveal();
    const ballots = orderedBallots().map(({ id, content }) => ({ id, content, author: { id, nickname: nicknameOf(id) } }));
    return { kind: 'closed', vote: room.vote, ballotCount: room.ballots.size, reveal: { cursor, mode, hidden, ballots } };
  };
  const displayStage = () => {
    if (room.stage === 'lobby') return { kind: 'lobby', participants: summaries() };
    if (room.stage === 'voting') {
      return { kind: 'voting', vote: room.vote, submittedCount: room.ballots.size, participantCount: room.participants.length };
    }
    const { cursor, mode, hidden } = openReveal();
    const ordered = orderedBallots();
    const open = cursor >= 0 && !hidden ? ordered[cursor] : undefined;
    const signed = room.vote.anonymity === 'named';
    return {
      kind: 'closed',
      vote: room.vote,
      reveal: {
        cursor,
        total: ordered.length,
        mode,
        hidden,
        current: open ? { content: open.content, signature: signed ? nicknameOf(open.id) : null } : null,
        tally: mode === 'all' && !hidden ? tallyOf() : null,
      },
    };
  };
  const participantStage = (id) => {
    if (room.stage === 'lobby') return { kind: 'lobby' };
    return { kind: room.stage, vote: room.vote, submitted: room.ballots.has(id), submittedCount: room.ballots.size };
  };
  const viewFor = (sock) => {
    if (sock.role === 'host') {
      const participants = summaries().map((p) => ({ ...p, submitted: room.ballots.has(p.id) }));
      return { role: 'host', code: room.code, displayToken: room.displayToken, stage: hostStage(), participants };
    }
    if (sock.role === 'display') return { role: 'display', code: room.code, stage: displayStage() };
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
  room.displays = () => [...room.sockets].filter((sock) => sock.role === 'display').length;
  // Everything the display sockets were last sent, for checks that nothing leaks onto a public screen.
  room.displayFrames = [];
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
      room.reveal = null;
      openReveal();
    } else if (msg.t === 'revealMove' || msg.t === 'revealMode' || msg.t === 'setHidden') {
      if (sock.role !== 'host') return fail('not_host');
      if (room.stage !== 'closed') return fail('wrong_stage');
      if (msg.voteId !== room.vote.id) return fail('stale_vote');
      if (msg.t === 'revealMove') {
        const inRange = Number.isInteger(msg.cursor) && msg.cursor >= -1 && msg.cursor < room.reveal.order.length;
        if (room.reveal.mode !== 'one' || !inRange) return fail('bad_reveal');
        room.reveal.cursor = msg.cursor;
      } else if (msg.t === 'revealMode') {
        if (msg.mode === 'all' && room.vote.paper.kind !== 'choice') return fail('bad_reveal');
        room.reveal.mode = msg.mode;
      } else {
        room.reveal.hidden = msg.hidden;
      }
    } else if (msg.t === 'dismissVote') {
      if (sock.role !== 'host') return fail('not_host');
      if (room.stage !== 'closed') return fail('wrong_stage');
      if (msg.voteId !== room.vote.id) return fail('stale_vote');
      room.stage = 'lobby';
      room.vote = null;
      room.ballots = new Map();
      room.reveal = null;
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
        } else if (msg.t === 'watch') {
          if (msg.code !== room.code) return fail('room_not_found');
          if (msg.displayToken !== room.displayToken) return fail('bad_display_token');
          sock.role = 'display';
          send(sock, { t: 'watching', view: viewFor(sock) });
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
