import { describe, expect, it } from 'vitest';
import type { HostBallot, VotePublic } from '../../shared/protocol.ts';
import type { BallotContent } from '../../shared/vote.ts';
import { parseCsv } from './csvParse.ts';
import { BOM, buildCsv, csvCell, csvFileName, dateStamp, exportBaseName, safeFileStem, summarize } from './exportVote.ts';

const AT = new Date(2026, 10, 17, 14, 5);

const ballot = (content: BallotContent, nickname: string, id = nickname): HostBallot => ({
  id,
  content,
  author: { id: `a-${id}`, nickname },
});

const freeform = (anonymity: VotePublic['anonymity'], title = '점심 메뉴'): VotePublic => ({
  id: 'v1',
  title,
  anonymity,
  paper: { kind: 'freeform' },
});

const choice = (anonymity: VotePublic['anonymity']): VotePublic => ({
  id: 'v2',
  title: '어디서 먹을까요?',
  anonymity,
  paper: { kind: 'choice', options: ['김치찜', '돈가스, 우동', '"비빔밥"'] },
});

const TRICKY = 'a,b "quoted"\n두 번째 줄, 쉼표';

describe('csvCell', () => {
  it('leaves plain text alone', () => {
    expect(csvCell('국밥')).toBe('국밥');
    expect(csvCell(12)).toBe('12');
  });

  it('quotes commas, quotes and line breaks, doubling the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
  });

  it('turns a leading formula character into plain text', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+82 10')).toBe("'+82 10");
    expect(csvCell('-3')).toBe("'-3");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it('does not touch a number, whatever its sign', () => {
    expect(csvCell(-1)).toBe('-1');
  });
});

describe('buildCsv', () => {
  const anonymousBallots = [
    ballot({ kind: 'text', text: TRICKY }, '하늘'),
    ballot({ kind: 'ink', strokes: [{ w: 'thin', pts: [1, 2, 3, 4] }] }, '바다'),
    ballot({ kind: 'text', text: '국밥' }, '구름'),
  ];

  it('starts with a byte order mark and ends every row with CRLF', () => {
    const csv = buildCsv({ vote: freeform('anonymous'), ballots: anonymousBallots, at: AT });
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(/(?<!\r)\n/.test(csv.replace(/"[^"]*(?:""[^"]*)*"/g, ''))).toBe(false);
  });

  it('puts the vote facts on top and the papers below in reveal order', () => {
    const rows = parseCsv(buildCsv({ vote: freeform('anonymous'), ballots: anonymousBallots, at: AT }));
    expect(rows.slice(0, 5)).toEqual([
      ['제목', '점심 메뉴'],
      ['날짜', '2026-11-17'],
      ['방식', '익명'],
      ['용지 유형', '자유 기재'],
      ['용지 수', '3'],
    ]);
    expect(rows[5]).toEqual(['']);
    expect(rows[6]).toEqual(['번호', '종류', '내용']);
    expect(rows.slice(7)).toEqual([
      ['1', '글', TRICKY],
      ['2', '손글씨', '(손글씨)'],
      ['3', '글', '국밥'],
    ]);
  });

  it('reads back exactly the text that went in, tricky characters included', () => {
    const rows = parseCsv(buildCsv({ vote: freeform('anonymous', 'x,"y"'), ballots: anonymousBallots, at: AT }));
    expect(rows[0]).toEqual(['제목', 'x,"y"']);
    expect(rows[7]?.[2]).toBe(TRICKY);
  });

  it('keeps every nickname out of an anonymous file and has no author column', () => {
    const csv = buildCsv({ vote: freeform('anonymous'), ballots: anonymousBallots, at: AT });
    for (const name of ['하늘', '바다', '구름']) expect(csv).not.toContain(name);
    expect(csv).not.toContain('작성자');
    expect(parseCsv(csv).every((row) => row.length <= 3)).toBe(true);
  });

  it('adds the author column to a named file', () => {
    const rows = parseCsv(buildCsv({ vote: freeform('named'), ballots: anonymousBallots, at: AT }));
    expect(rows[2]).toEqual(['방식', '기명']);
    expect(rows[6]).toEqual(['번호', '종류', '내용', '작성자']);
    expect(rows[7]).toEqual(['1', '글', TRICKY, '하늘']);
    expect(rows[8]).toEqual(['2', '손글씨', '(손글씨)', '바다']);
  });

  it('writes the chosen option and a table of counts for a choice vote', () => {
    const ballots = [
      ballot({ kind: 'choice', optionIndex: 1 }, '하늘'),
      ballot({ kind: 'choice', optionIndex: 1 }, '바다'),
      ballot({ kind: 'choice', optionIndex: 2 }, '구름'),
    ];
    const rows = parseCsv(buildCsv({ vote: choice('anonymous'), ballots, at: AT }));
    expect(rows[3]).toEqual(['용지 유형', '객관식']);
    expect(rows.slice(7, 10)).toEqual([
      ['1', '객관식', '돈가스, 우동'],
      ['2', '객관식', '돈가스, 우동'],
      ['3', '객관식', '"비빔밥"'],
    ]);
    expect(rows.slice(10)).toEqual([[''], ['보기', '득표수'], ['김치찜', '0'], ['돈가스, 우동', '2'], ['"비빔밥"', '1']]);
  });

  it('keeps nicknames out of a choice file too when the vote is anonymous', () => {
    const csv = buildCsv({ vote: choice('anonymous'), ballots: [ballot({ kind: 'choice', optionIndex: 0 }, '하늘')], at: AT });
    expect(csv).not.toContain('하늘');
  });

  it('has the headers and no paper rows for a vote nobody answered', () => {
    const rows = parseCsv(buildCsv({ vote: freeform('anonymous'), ballots: [], at: AT }));
    expect(rows).toHaveLength(7);
    expect(rows[4]).toEqual(['용지 수', '0']);
  });

  it('defuses a paper that would run as a formula', () => {
    const rows = parseCsv(buildCsv({ vote: freeform('anonymous'), ballots: [ballot({ kind: 'text', text: '=cmd|calc' }, '하늘')], at: AT }));
    expect(rows[7]?.[2]).toBe("'=cmd|calc");
  });
});

describe('summarize', () => {
  it('counts per option for a choice vote and has none for a free-form one', () => {
    const ballots = [ballot({ kind: 'choice', optionIndex: 2 }, 'a'), ballot({ kind: 'choice', optionIndex: 2 }, 'b')];
    expect(summarize({ vote: choice('named'), ballots, at: AT }).options?.map((o) => o.count)).toEqual([0, 0, 2]);
    expect(summarize({ vote: freeform('named'), ballots: [], at: AT }).options).toBeNull();
  });
});

describe('file names', () => {
  it('formats the local date', () => {
    expect(dateStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('keeps Korean and drops what a file system refuses', () => {
    expect(safeFileStem('이번 모임에서 가장 좋았던 순간은?')).toBe('이번 모임에서 가장 좋았던 순간은');
    expect(safeFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(safeFileStem('line\none\ttab')).toBe('line one tab');
  });

  it('never ends on a dot or a space and never starts with one', () => {
    expect(safeFileStem('..숨김. ')).toBe('숨김');
    expect(safeFileStem('끝. . .')).toBe('끝');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFileStem('???')).toBe('한표');
    expect(safeFileStem('')).toBe('한표');
    expect(safeFileStem('CON')).toBe('한표');
  });

  it('clips a long title by characters, not bytes', () => {
    const stem = safeFileStem('가'.repeat(60));
    expect([...stem]).toHaveLength(40);
  });

  it('joins title and date, with .csv for the download', () => {
    expect(exportBaseName('점심 메뉴', AT)).toBe('점심 메뉴_2026-11-17');
    expect(csvFileName('점심 메뉴', AT)).toBe('점심 메뉴_2026-11-17.csv');
  });
});
