// A strict RFC 4180 reader, kept apart from the app. The export tests and the browser walk read the file back with it,
// so what they assert is what a spreadsheet would show and not the builder's own idea of it.
export function parseCsv(text: string): string[][] {
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;

  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = '';
  };

  while (index < body.length) {
    const ch = body[index] as string;
    if (quoted) {
      if (ch === '"' && body[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && body[index + 1] === '\n') {
      endRow();
      index += 1;
    } else {
      cell += ch;
    }
    index += 1;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
