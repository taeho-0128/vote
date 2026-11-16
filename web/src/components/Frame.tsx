import type { ReactNode } from 'react';
import type { ConnectionStatus } from '../connection.ts';
import { Link } from './Link.tsx';

export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="appbar">
      <div className="appbar-in">
        <Link href="/" className="logo" aria-label="한 표 처음으로">
          한 표
        </Link>
        {children}
      </div>
    </header>
  );
}

export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  if (status !== 'reconnecting') return null;
  return (
    <div className="banner" role="status" data-testid="connection-banner">
      <div className="banner-in">연결이 끊겼어요. 다시 연결하는 중…</div>
    </div>
  );
}

export function Notice({ testId, title, message }: { testId: string; title: string; message: string }) {
  return (
    <div className="notice" role="alert" data-testid={testId}>
      <h1 className="title">{title}</h1>
      <p className="sub">{message}</p>
      <Link href="/" className="btn wide">
        처음으로 돌아가기
      </Link>
    </div>
  );
}
