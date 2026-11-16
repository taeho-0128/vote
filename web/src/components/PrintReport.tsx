import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { leadersOf } from '../tally.ts';
import { summarize } from '../exportVote.ts';
import type { ExportSource } from '../exportVote.ts';
import { PaperFace } from './PaperFace.tsx';

// What "PDF로 저장" prints: a summary page, then one large paper per page. It is a child of <body> so the print
// stylesheet can hide the app and show only this. A named vote's papers carry their signature through PaperFace, and an
// anonymous vote's carry none, so nothing here needs to know about nicknames beyond handing PaperFace the right one.
export function PrintReport({ source }: { source: ExportSource }) {
  const { vote, ballots } = source;
  const summary = summarize(source);
  const total = ballots.length;
  const top = Math.max(0, ...(summary.options ?? []).map((o) => o.count));
  const leaders = summary.options ? leadersOf(summary.options.map((o) => o.count)) : new Set<number>();

  return createPortal(
    <div className="print-report" data-testid="print-report" aria-hidden="true">
      <section className="pr-page pr-summary" data-testid="print-summary">
        <p className="pr-brand">한 표</p>
        <h1 className="pr-title">{summary.title}</h1>
        <dl className="pr-facts">
          <div>
            <dt>날짜</dt>
            <dd>{summary.date}</dd>
          </div>
          <div>
            <dt>방식</dt>
            <dd>{summary.modeLabel}</dd>
          </div>
          <div>
            <dt>용지 유형</dt>
            <dd>{summary.paperLabel}</dd>
          </div>
          <div>
            <dt>용지 수</dt>
            <dd>{summary.count}장</dd>
          </div>
        </dl>
        {summary.options ? (
          <ol className="pr-tally" aria-label="보기별 득표">
            {summary.options.map(({ option, count }, index) => (
              <li key={index} className={leaders.has(index) ? 'lead' : undefined}>
                <span className="pr-opt">{option}</span>
                <span className="pr-track">
                  <i style={{ '--w': `${top === 0 ? 0 : (count / top) * 100}%` } as CSSProperties} />
                </span>
                <b className="pr-count">{count}</b>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      {ballots.map((ballot, index) => (
        <section key={ballot.id} className="pr-page pr-paper" data-testid="print-paper">
          <header className="pr-head">
            <p className="pr-vote">{summary.title}</p>
            <p className="pr-pos">
              {index + 1} / {total}
            </p>
          </header>
          <div className="pr-sheet">
            <PaperFace content={ballot.content} paper={vote.paper} signature={summary.named ? ballot.author.nickname : null} />
          </div>
        </section>
      ))}
    </div>,
    document.body,
  );
}
