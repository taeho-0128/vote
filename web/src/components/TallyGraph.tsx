import type { CSSProperties } from 'react';
import { leadersOf } from '../tally.ts';

export interface GraphIds {
  root: string;
  row: (index: number) => string;
  count: (index: number) => string;
}

interface TallyGraphProps {
  options: readonly string[];
  tally: readonly number[];
  ids: GraphIds;
}

// Horizontal bars in the options' own order. Each bar is sized against the biggest count, and every option that shares
// that count is marked, so a tie reads as a tie.
export function TallyGraph({ options, tally, ids }: TallyGraphProps) {
  const leaders = leadersOf(tally);
  const top = Math.max(0, ...tally);
  return (
    <ol className="graph" data-testid={ids.root} aria-label="보기별 득표" style={{ '--rows': options.length } as CSSProperties}>
      {options.map((option, index) => {
        const count = tally[index] ?? 0;
        const lead = leaders.has(index);
        return (
          <li key={index} className={lead ? 'graph-row lead' : 'graph-row'} data-testid={ids.row(index)}>
            <span className="graph-label">
              {option}
              {lead ? <span className="graph-lead">최다</span> : null}
            </span>
            <span className="graph-track" aria-hidden="true">
              <i className="graph-bar" style={{ '--w': `${top === 0 ? 0 : (count / top) * 100}%` } as CSSProperties} />
            </span>
            <span className="graph-count">
              <b data-testid={ids.count(index)}>{count}</b>
              <span className="sr-only">표</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
