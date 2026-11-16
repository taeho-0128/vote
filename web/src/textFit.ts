// How big typed text may be on the paper (D-36). The writing textarea, the folding face and the results paper all call
// `fitText`, so nobody else decides a text size. Every length is a fraction of the paper's width, which is what makes the
// answer the same on a 250px phone and a 420px laptop: the caller turns a fraction into `cqw` inside the paper.

// Line pitch of each step, largest first. The first is the friendly size the paper has always had. The last must still
// hold the worst text the contract accepts (200 characters in 12 lines, even all wide emoji), which textFit.test.ts
// proves. Hangul text never reaches it: 200 syllables in 12 lines stop at 0.048.
export const TEXT_STEPS: readonly number[] = [0.115, 0.1, 0.088, 0.078, 0.069, 0.061, 0.054, 0.048, 0.042];

const SIZE_RATIO = 0.92;
const PAPER_HEIGHT = 4 / 3;
const PAD_X = 0.05;
const TOP_RATIO = 0.45;
// Room left under the text of a signed paper for the "— nickname" line.
const SIGN_RESERVE = 0.17;
// A row's worth of slack is kept so a rounding error in the browser's line boxes can never push a row off the paper.
const SPARE_ROWS = 0.1;

// Advance widths in em, measured on Nanum Pen Script and rounded up so the model never underestimates (e2e/hand-widths.mjs
// regenerates the table). Hangul syllables run 0.35 to 1.04 em, so a flat width would call a typical sentence twice
// as wide as it is. SYLLABLE_HUNDREDTHS keeps, per initial and vowel (19 rows of 21 cells, two hex digits each), the
// widest of the 28 syllables over every final consonant. ASCII runs 0.15 to 0.65, a space is 0.28, a compatibility
// jamo such as "ㅋ" at most 1.0. Anything else falls back to a system font that can be wide, such as an emoji at 1.4.
const SYLLABLE_HUNDREDTHS =
  '49494e4947495158384b4b4b37394b4b4b37374641' +
  '55555a554f50565c3c5452463f3c5051463c3c4647' +
  '4b4b504e47504b50374b4b4637374b4e4637374646' +
  '4a51504e46504b4f3c4b4f4637374b4b4637374641' +
  '5c5558555a58585a4155554641415055464141464d' +
  '484b514e46504b4f374d504637374b4b4637374641' +
  '4c4d504e4b504d54384b4b4637394b4b4637374642' +
  '4f50524e4e504b51374d504637374b4b4637374644' +
  '685f625a5b5f5f62415a5a4f4441505a5041415053' +
  '4d4c504b4a504b52374b4b4637374b524637394648' +
  '545858555556555e4155554b414150554741414647' +
  '4c4a4e4f464b4c513d4b4b4637384b4c4637394648' +
  '494d4e4c464e4952434d50463e3c4b514637374645' +
  '5e57595459565e5a43575b4b45414b504641424647' +
  '4c4b504e46504b50374c4b4639374b4b463737464b' +
  '484b504e46504b54374b4b4637374b4b4637374641' +
  '4b4e504e4a504e56374c4f4637374b4c46373c464b' +
  '514f504e485552553a4b4b463a3a4b4f4b3a3a4646' +
  '4b4b504e46504b503a4b4c463a3a4b4b4b3a3a4646';
const JAMO_EM = 1;
const LATIN_EM = 0.66;
const SPACE_EM = 0.3;
const OTHER_EM = 1.5;
// Trimmed off a line's capacity for the subpixel rounding of the browser's line layout.
const LINE_SAFETY = 0.985;

export interface TextFit {
  // Font size and line pitch, as fractions of the paper's width.
  readonly size: number;
  readonly pitch: number;
}

const isWide = (code: number) => code >= 0x80;

function emOf(ch: string): number {
  if (ch === ' ') return SPACE_EM;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x7f) return LATIN_EM;
  if (code >= 0xac00 && code <= 0xd7a3) {
    const cell = Math.floor((code - 0xac00) / 28) * 2;
    return parseInt(SYLLABLE_HUNDREDTHS.slice(cell, cell + 2), 16) / 100;
  }
  return code >= 0x3130 && code <= 0x318f ? JAMO_EM : OTHER_EM;
}

// What the browser may break between: after a space and between two characters outside ASCII, which covers Hangul,
// Hanja and emoji. It breaks in other places too, and a model with fewer break points never counts fewer rows.
function rowsOfLine(line: string, capacity: number): number {
  let rows = 1;
  let x = 0;
  let word: number[] = [];
  let gap = 0;

  const place = () => {
    const width = word.reduce((sum, w) => sum + w, 0);
    if (x > 0 && x + width > capacity) {
      rows += 1;
      x = 0;
    }
    if (width <= capacity) {
      x += width;
    } else {
      for (const w of word) {
        if (x > 0 && x + w > capacity) {
          rows += 1;
          x = 0;
        }
        x += w;
      }
    }
    x += gap;
    word = [];
    gap = 0;
  };

  const chars = [...line];
  chars.forEach((ch, index) => {
    if (ch === ' ') {
      gap += SPACE_EM;
      return;
    }
    if (gap > 0) place();
    word.push(emOf(ch));
    const next = chars[index + 1];
    if (next !== undefined && isWide(ch.codePointAt(0) ?? 0) && isWide(next.codePointAt(0) ?? 0)) place();
  });
  place();
  return rows;
}

const capacityEm = (pitch: number) => ((1 - 2 * PAD_X) / (SIZE_RATIO * pitch)) * LINE_SAFETY;

// Rows the text takes at this pitch. A paragraph, even an empty one, takes at least one row.
export function rowsNeeded(text: string, pitch: number): number {
  const capacity = capacityEm(pitch);
  return text.split('\n').reduce((sum, line) => sum + rowsOfLine(line, capacity), 0);
}

// Rows that fit between the top margin and the bottom edge, or the signature of a signed paper.
export function rowsAvailable(pitch: number, signed: boolean): number {
  const top = pitch * TOP_RATIO;
  const bottom = signed ? SIGN_RESERVE : top;
  return Math.floor((PAPER_HEIGHT - top - bottom) / pitch - SPARE_ROWS);
}

export function fitText(text: string, signed: boolean): TextFit {
  const pitch =
    TEXT_STEPS.find((candidate) => rowsNeeded(text, candidate) <= rowsAvailable(candidate, signed)) ?? TEXT_STEPS[TEXT_STEPS.length - 1]!;
  return { size: pitch * SIZE_RATIO, pitch };
}

const cqw = (fraction: number) => `${Number((fraction * 100).toFixed(3))}cqw`;

// The styles that put a fit on the paper: the sheet's `--ls` follows the pitch so its ruled lines do too, and the
// padding keeps the text clear of the margins and the signature.
export function textFitStyle({ size, pitch }: TextFit, signed: boolean): Record<string, string> {
  const top = pitch * TOP_RATIO;
  const bottom = signed ? SIGN_RESERVE : top;
  return {
    '--ls': cqw(pitch),
    '--tf-top': cqw(top),
    '--tf-pad': `${cqw(top)} ${cqw(PAD_X)} ${cqw(bottom)}`,
    fontSize: cqw(size),
    lineHeight: cqw(pitch),
  };
}
