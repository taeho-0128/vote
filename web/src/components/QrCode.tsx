import { useMemo } from 'react';
import { create } from 'qrcode';

const QUIET_ZONE = 3;

export function QrCode({ text, label }: { text: string; label: string }) {
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
      aria-label={label}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={span} height={span} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}
