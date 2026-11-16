import { ROOM_CLOSED_COPY } from '../messages.ts';
import { AppBar } from './Frame.tsx';
import { Link } from './Link.tsx';

type Role = 'host' | 'participant' | 'display';

// What every screen shows once the server has deleted the room. It is calm on purpose: nothing here went wrong, the room
// was simply left alone for six hours.
export function RoomClosed({ role }: { role: Role }) {
  if (role === 'display') {
    return (
      <div className="d-message" role="status" data-testid="room-expired">
        <h1 className="d-title" data-size="m">
          {ROOM_CLOSED_COPY.title}
        </h1>
        <p className="d-sub">{ROOM_CLOSED_COPY.reason}</p>
        <p className="d-sub">{ROOM_CLOSED_COPY.display}</p>
        <Link href="/" className="d-link">
          {ROOM_CLOSED_COPY.home}
        </Link>
      </div>
    );
  }
  return (
    <div className="app">
      <AppBar />
      <main className="column column--center">
        <div className="notice notice--calm" role="status" data-testid="room-expired">
          <h1 className="title">{ROOM_CLOSED_COPY.title}</h1>
          <p className="sub">{ROOM_CLOSED_COPY.reason}</p>
          <p className="sub">{ROOM_CLOSED_COPY[role]}</p>
          <Link href="/" className="btn wide">
            {ROOM_CLOSED_COPY.home}
          </Link>
        </div>
      </main>
    </div>
  );
}
