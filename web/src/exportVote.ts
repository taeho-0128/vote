import type { HostBallot, VotePublic } from '../../shared/protocol.ts';
import type { BallotContent, Paper } from '../../shared/vote.ts';
import { tallyOf } from './tally.ts';
import { ANONYMITY_LABEL, PAPER_LABEL } from './voteLabels.ts';

export const BOM = '﻿';
export const INK_PLACEHOLDER = '(손글씨)';

export const KIND_LABEL: Record<BallotContent['kind'], string> = {
  text: '글',
  ink: '손글씨',
  choice: '객관식',
};

export interface ExportSource {
  readonly vote: VotePublic;
  // In reveal order, which is the order a person saw them in.
  readonly ballots: readonly HostBallot[];
  readonly at: Date;
}

export interface OptionTotal {
  readonly option: string;
  readonly count: number;
}

// What the CSV's top rows and the printed first page both say, worked out once.
export interface VoteSummary {
  readonly title: string;
  readonly date: string;
  readonly named: boolean;
  readonly modeLabel: string;
  readonly paperLabel: string;
  readonly count: number;
  readonly options: readonly OptionTotal[] | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// Local calendar date, because the host reads the file on the day they ran the vote.
export const dateStamp = (at: Date): string => `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;

export function summarize({ vote, ballots, at }: ExportSource): VoteSummary {
  const { paper } = vote;
  const options =
    paper.kind === 'choice'
      ? tallyOf(ballots, paper.options.length).map((count, index) => ({ option: paper.options[index] ?? '', count }))
      : null;
  return {
    title: vote.title,
    date: dateStamp(at),
    named: vote.anonymity === 'named',
    modeLabel: ANONYMITY_LABEL[vote.anonymity],
    paperLabel: PAPER_LABEL[vote.paper.kind],
    count: ballots.length,
    options,
  };
}

// A spreadsheet runs a cell that starts with one of these as a formula, and the text of a paper is written by whoever
// holds the phone. A leading apostrophe turns it back into plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvRow = (cells: readonly (string | number)[]): string => cells.map(csvCell).join(',');

export function ballotText(content: BallotContent, paper: Paper): string {
  if (content.kind === 'text') return content.text;
  if (content.kind === 'ink') return INK_PLACEHOLDER;
  return paper.kind === 'choice' ? (paper.options[content.optionIndex] ?? '') : '';
}

// UTF-8 with a byte order mark so Excel reads Hangul, CRLF line ends, and a table per question: the vote's facts, the
// papers in reveal order, and for a choice vote the count of each option. Only a named vote gets an author column,
// so an anonymous file has no nickname in it anywhere.
export function buildCsv(source: ExportSource): string {
  const summary = summarize(source);
  const { vote, ballots } = source;
  const rows: string[] = [
    csvRow(['제목', summary.title]),
    csvRow(['날짜', summary.date]),
    csvRow(['방식', summary.modeLabel]),
    csvRow(['용지 유형', summary.paperLabel]),
    csvRow(['용지 수', summary.count]),
    '',
    csvRow(summary.named ? ['번호', '종류', '내용', '작성자'] : ['번호', '종류', '내용']),
  ];
  ballots.forEach(({ content, author }, index) => {
    const cells = [index + 1, KIND_LABEL[content.kind], ballotText(content, vote.paper)];
    rows.push(csvRow(summary.named ? [...cells, author.nickname] : cells));
  });
  if (summary.options) {
    rows.push('', csvRow(['보기', '득표수']));
    for (const { option, count } of summary.options) rows.push(csvRow([option, count]));
  }
  return `${BOM}${rows.join('\r\n')}\r\n`;
}

const ILLEGAL_IN_FILENAME = /[\\/:*?"<>|\p{Cc}]/gu;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const TITLE_CHARS_IN_NAME = 40;

// Keeps Korean, drops what Windows and macOS refuse in a name, and never ends on a dot or a space.
export function safeFileStem(title: string): string {
  const cleaned = title
    .replace(ILLEGAL_IN_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const clipped = [...cleaned].slice(0, TITLE_CHARS_IN_NAME).join('').replace(/^\.+/, '').replace(/[. ]+$/, '');
  return clipped === '' || RESERVED_WINDOWS_NAME.test(clipped) ? '한표' : clipped;
}

// The same name titles the page while it prints, which is what the browser offers when saving the PDF.
export const exportBaseName = (title: string, at: Date): string => `${safeFileStem(title)}_${dateStamp(at)}`;

export const csvFileName = (title: string, at: Date): string => `${exportBaseName(title, at)}.csv`;
