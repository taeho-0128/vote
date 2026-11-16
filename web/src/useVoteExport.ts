import { useMemo, useState } from 'react';
import type { HostStage } from '../../shared/protocol.ts';
import { downloadText } from './download.ts';
import { buildCsv, csvFileName, exportBaseName } from './exportVote.ts';
import type { ExportSource } from './exportVote.ts';
import { markExported, wasExported } from './storage.ts';
import { useKeyedState } from './useCommand.ts';
import { usePrintJob } from './usePrintJob.ts';

type Closed = Extract<HostStage, { kind: 'closed' }>;

export interface VoteExport {
  // The host has saved this vote as a file or sent it to the printer, in this browser.
  readonly exported: boolean;
  readonly printing: boolean;
  readonly csv: () => void;
  readonly pdf: () => void;
  // The papers of the report being printed, or null when nothing is printing.
  readonly report: ExportSource | null;
}

export function useVoteExport(code: string, stage: Closed | null): VoteExport {
  const voteId = stage?.vote.id ?? null;
  const job = usePrintJob();
  const [reportAt, setReportAt] = useState<Date | null>(null);
  const [marked, setMarked] = useKeyedState<boolean | null>(voteId ?? '', null);
  const stored = useMemo(() => voteId !== null && wasExported(code, voteId), [code, voteId]);

  const record = () => {
    if (voteId === null) return;
    markExported(code, voteId);
    setMarked(true);
  };

  const csv = () => {
    if (!stage) return;
    const at = new Date();
    downloadText(csvFileName(stage.vote.title, at), buildCsv({ vote: stage.vote, ballots: stage.reveal.ballots, at }));
    record();
  };

  const pdf = () => {
    if (!stage || job.printing) return;
    const at = new Date();
    setReportAt(at);
    job.start(exportBaseName(stage.vote.title, at));
    record();
  };

  const report: ExportSource | null =
    stage && job.printing && reportAt ? { vote: stage.vote, ballots: stage.reveal.ballots, at: reportAt } : null;

  return { exported: marked ?? stored, printing: job.printing, csv, pdf, report };
}
