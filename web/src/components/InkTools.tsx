import { Icon } from './Icon.tsx';
import type { InkTool } from './InkCanvas.tsx';

interface InkToolsProps {
  tool: InkTool;
  canUndo: boolean;
  canClear: boolean;
  onTool: (tool: InkTool) => void;
  onUndo: () => void;
  onClear: () => void;
}

export function InkTools({ tool, canUndo, canClear, onTool, onUndo, onClear }: InkToolsProps) {
  const pick = (id: string, value: InkTool, label: string, icon: 'pen' | 'eraser', weight?: number) => (
    <button
      type="button"
      className="tool"
      data-testid={id}
      aria-label={label}
      aria-pressed={tool === value}
      onClick={() => onTool(value)}
    >
      <Icon name={icon} size={20} weight={weight} />
    </button>
  );

  return (
    <div className="tools" role="group" aria-label="쓰기 도구">
      {pick('tool-pen', 'thin', '펜', 'pen')}
      {pick('tool-pen-thick', 'thick', '굵은 펜', 'pen', 3.2)}
      {pick('tool-eraser', 'eraser', '지우개', 'eraser')}
      <span className="tools-gap" aria-hidden="true" />
      <button type="button" className="tool plain" data-testid="tool-undo" aria-label="되돌리기" disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={20} />
      </button>
      <button type="button" className="tool plain" data-testid="tool-clear" aria-label="전체 지우기" disabled={!canClear} onClick={onClear}>
        <Icon name="trash" size={20} />
      </button>
    </div>
  );
}
