import type { ReactNode } from 'react';
import type { ParticipantSummary } from '../../../shared/protocol.ts';

// `submitted` exists only in the host's view of the room (D-10).
type Person = ParticipantSummary & { readonly submitted?: boolean };

// 'voting' and 'closed' split the roster by who has handed a ballot in. They differ only in how the ones who
// have not are described: still to come while voting, left out once closed.
export type RosterPhase = 'voting' | 'closed';

interface RosterProps {
  heading: string;
  participants: readonly Person[];
  meId?: string;
  emptyText: string;
  phase?: RosterPhase;
}

const PENDING_HEADING: Record<RosterPhase, string> = { voting: '아직 안 냈어요', closed: '내지 않았어요' };

function NameList({ people, meId, className }: { people: readonly Person[]; meId?: string; className?: string }) {
  return (
    <ul className={['names', className].filter(Boolean).join(' ')}>
      {people.map((p) => (
        <li
          key={p.id}
          data-testid="roster-item"
          data-submitted={p.submitted === undefined ? undefined : String(p.submitted)}
          className={[p.connected ? '' : 'off', p.id === meId ? 'me' : ''].filter(Boolean).join(' ')}
          aria-current={p.id === meId ? 'true' : undefined}
        >
          <span className="dot" aria-hidden="true" />
          <span className="who">
            <span className="nick">{p.nickname}</span>
            {p.connected ? null : <small>연결 끊김</small>}
          </span>
          {p.submitted ? (
            <span className="stamp" aria-hidden="true">
              확
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Group({ heading, count, children }: { heading: string; count: number; children: ReactNode }) {
  return (
    <div className="roll-group">
      <h3>
        {heading} <b>{count}</b>
      </h3>
      {children}
    </div>
  );
}

export function Roster({ heading, participants, meId, emptyText, phase }: RosterProps) {
  const pending = phase ? participants.filter((p) => !p.submitted) : [];
  const done = phase ? participants.filter((p) => p.submitted) : [];
  return (
    <section className={phase ? `roll panel roll--${phase}` : 'roll panel'} data-testid="roster">
      <div className="roll-head">
        <h2>{heading}</h2>
        <span className="roll-count" aria-live="polite" aria-atomic="true">
          <b data-testid="roster-count">{participants.length}</b>명
        </span>
      </div>
      {participants.length === 0 ? (
        <p className="hint">{emptyText}</p>
      ) : phase ? (
        <>
          <Group heading={PENDING_HEADING[phase]} count={pending.length}>
            {pending.length === 0 ? (
              <p className="hint">모두 제출했어요.</p>
            ) : (
              <NameList people={pending} className="todo" />
            )}
          </Group>
          {done.length === 0 ? null : (
            <Group heading="제출했어요" count={done.length}>
              <NameList people={done} className="done" />
            </Group>
          )}
        </>
      ) : (
        <NameList people={participants} meId={meId} />
      )}
    </section>
  );
}
