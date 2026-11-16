import type { ParticipantSummary } from '../../../shared/protocol.ts';

interface RosterProps {
  heading: string;
  participants: readonly ParticipantSummary[];
  meId?: string;
  emptyText: string;
}

export function Roster({ heading, participants, meId, emptyText }: RosterProps) {
  return (
    <section className="roll panel" data-testid="roster">
      <div className="roll-head">
        <h2>{heading}</h2>
        <span className="roll-count" aria-live="polite" aria-atomic="true">
          <b data-testid="roster-count">{participants.length}</b>명
        </span>
      </div>
      {participants.length === 0 ? (
        <p className="hint">{emptyText}</p>
      ) : (
        <ul className="names">
          {participants.map((p) => (
            <li
              key={p.id}
              data-testid="roster-item"
              className={[p.connected ? '' : 'off', p.id === meId ? 'me' : ''].filter(Boolean).join(' ')}
              aria-current={p.id === meId ? 'true' : undefined}
            >
              <span className="dot" aria-hidden="true" />
              <span className="who">
                <span className="nick">{p.nickname}</span>
                {p.connected ? null : <small>연결 끊김</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
