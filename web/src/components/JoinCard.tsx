import { useState } from 'react';
import { copyText } from '../clipboard.ts';
import { Icon } from './Icon.tsx';
import { QrCode } from './QrCode.tsx';

type CopyState = 'idle' | 'copied' | 'failed';

function JoinBody({ code }: { code: string }) {
  const url = `${location.origin}/r/${code}`;
  const [copy, setCopy] = useState<CopyState>('idle');

  const handleCopy = async () => {
    setCopy((await copyText(url)) ? 'copied' : 'failed');
    setTimeout(() => setCopy('idle'), 2000);
  };

  return (
    <div className="join-body">
      <div className="qr" data-testid="qr">
        <QrCode text={url} label="입장용 QR 코드" />
      </div>
      <div className="join-info">
        <p className="sub">QR을 찍거나 방 코드를 입력하세요</p>
        <div className="codebox" data-testid="room-code">
          {[...code].map((digit, i) => (
            <b key={i}>{digit}</b>
          ))}
        </div>
        <div className="join-url">
          <code data-testid="join-url">{url}</code>
          <button type="button" className="btn ghost sm" onClick={handleCopy}>
            <Icon name={copy === 'copied' ? 'check' : 'copy'} />
            복사
          </button>
        </div>
        <p className="hint" role="status">
          {copy === 'copied' ? '주소를 복사했어요.' : copy === 'failed' ? '복사하지 못했어요. 주소를 직접 선택해 주세요.' : ''}
        </p>
      </div>
    </div>
  );
}

// The full card is the lobby's centerpiece. Folded, it keeps the QR one tap away once the host is busy with a
// vote, because people may still walk in while it is open (D-07).
export function JoinCard({ code, folded = false }: { code: string; folded?: boolean }) {
  if (folded) {
    return (
      <details className="join-fold panel" data-testid="join-fold">
        <summary>
          <span>입장 방법</span>
          <span className="hint">방 코드 {code}</span>
        </summary>
        <JoinBody code={code} />
      </details>
    );
  }
  return (
    <section className="join-card panel" aria-labelledby="join-card-title">
      <h2 id="join-card-title" className="lbl">
        입장 방법
      </h2>
      <JoinBody code={code} />
    </section>
  );
}
