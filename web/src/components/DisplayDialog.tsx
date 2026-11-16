import { useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../clipboard.ts';
import { Icon } from './Icon.tsx';
import { QrCode } from './QrCode.tsx';

interface DisplayDialogProps {
  open: boolean;
  url: string;
  onClose: () => void;
}

type Note = 'idle' | 'copied' | 'copy-failed' | 'blocked';

const NOTE_COPY: Record<Note, string> = {
  idle: '',
  copied: '주소를 복사했어요.',
  'copy-failed': '복사하지 못했어요. 주소를 직접 선택해 주세요.',
  blocked: '새 창이 막혔어요. 주소를 복사해서 대화면 기기에서 열어 주세요.',
};

// The native modal gives focus trapping, an inert page and Escape. It holds a secret link, so it is only built while open.
export function DisplayDialog({ open, url, onClose }: DisplayDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [note, setNote] = useState<Note>('idle');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
    if (open) setNote('idle');
  }, [open]);

  const copy = async () => setNote((await copyText(url)) ? 'copied' : 'copy-failed');
  const openWindow = () => setNote(window.open(url, '_blank', 'popup=yes,width=1280,height=720') ? 'idle' : 'blocked');

  return (
    <dialog ref={ref} className="display-dialog" aria-labelledby={titleId} onClose={() => open && onClose()}>
      {open ? (
        <div className="display-dialog-body">
          <h2 id={titleId}>대화면 열기</h2>
          <p className="sub">대화면은 보기만 해요. 여기에 연결해도 아무것도 조작할 수 없어요.</p>
          <div className="qr" data-testid="display-qr">
            <QrCode text={url} label="대화면 주소 QR 코드" />
          </div>
          <div className="display-link-row">
            <input
              className="input"
              readOnly
              value={url}
              aria-label="대화면 주소"
              data-testid="display-link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="btn ghost sm" data-testid="display-copy" onClick={copy}>
              <Icon name={note === 'copied' ? 'check' : 'copy'} />
              복사
            </button>
          </div>
          <p className="hint" role="status" data-testid="display-note">
            {NOTE_COPY[note]}
          </p>
          <div className="display-dialog-actions">
            <button type="button" className="btn ghost" data-testid="display-close" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="btn" data-testid="display-open-window" onClick={openWindow}>
              새 창으로 열기
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
