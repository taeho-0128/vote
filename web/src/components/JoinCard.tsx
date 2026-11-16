import { useMemo, useState } from 'react';
import { create } from 'qrcode';
import { Icon } from './Icon.tsx';

const QUIET_ZONE = 3;

function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = create(text, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size: modules.size, path: d };
  }, [text]);
  const span = size + QUIET_ZONE * 2;
  return (
    <svg
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="입장용 QR 코드"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={span} height={span} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}

// Clipboard needs a secure context, and the app is often opened over plain http on a LAN while testing.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

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
        <QrCode text={url} />
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
