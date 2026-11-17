import { describe, expect, it } from 'vitest';
import { TEXT_MAX, TEXT_MAX_LINES } from '../../shared/vote.ts';
import { fitText, leadOf, rowsAvailable, rowsNeeded, TEXT_STEPS, textFitStyle } from './textFit.ts';

const LARGEST = TEXT_STEPS[0]!;
const SMALLEST = TEXT_STEPS[TEXT_STEPS.length - 1]!;
const HANGUL_STEP = TEXT_STEPS[TEXT_STEPS.length - 2]!;

const fits = (text: string, signed: boolean) => {
  const { pitch } = fitText(text, signed);
  return rowsNeeded(text, pitch) <= rowsAvailable(pitch, signed);
};
const lines = (count: number, line: string) => Array.from({ length: count }, () => line).join('\n');
const hangul = (count: number) => '가나다라마바사아자차카타파하'.repeat(Math.ceil(count / 14)).slice(0, count);
// The widest syllable in Nanum Pen Script, 1.04 em against a median of 0.72.
const WIDEST = '빠';
const widest = (count: number) => WIDEST.repeat(count);
const SENTENCE = '이번 달에는 발표 준비를 도와주고 늦게까지 남아서 자료를 다듬어 준 덕분에 팀 모두가 마음 편하게 발표를 마칠 수 있었어요. 정말 고맙습니다. ';

// A text the contract accepts has at most TEXT_MAX characters on at most TEXT_MAX_LINES lines.
const accepted = (text: string) => [...text].length <= TEXT_MAX && text.split('\n').length <= TEXT_MAX_LINES;

const random = (seed: number) => {
  let state = seed;
  return (n: number) => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state % n;
  };
};

describe('which size short text gets', () => {
  it('keeps the large handwriting size for an empty paper and for a line or two', () => {
    for (const signed of [false, true]) {
      expect(fitText('', signed).pitch).toBe(LARGEST);
      expect(fitText('서연이요!', signed).pitch).toBe(LARGEST);
      expect(fitText('서연이요!\n발표 자료 같이 만들어 줘서 정말 고마웠어요', signed).pitch).toBe(LARGEST);
    }
  });

  it('returns the font a little smaller than the line so text sits on its ruled line', () => {
    const { size, pitch } = fitText('안녕', false);
    expect(size).toBeLessThan(pitch);
    expect(size).toBeGreaterThan(pitch * 0.8);
  });

  it('only ever picks one of the steps', () => {
    for (let n = 0; n <= TEXT_MAX; n += 7) {
      for (const signed of [false, true]) expect(TEXT_STEPS).toContain(fitText(hangul(n), signed).pitch);
    }
  });

  it('shrinks in steps as text grows and never grows back while typing forward', () => {
    for (const signed of [false, true]) {
      const pitches = Array.from({ length: TEXT_MAX + 1 }, (_, n) => fitText(hangul(n), signed).pitch);
      for (let i = 1; i < pitches.length; i++) expect(pitches[i]!).toBeLessThanOrEqual(pitches[i - 1]!);
      expect(new Set(pitches).size).toBeGreaterThan(3);
      expect(pitches.at(-1)).toBeLessThan(LARGEST);
    }
  });

  it('keeps growing lines monotone too', () => {
    let previous = 0;
    for (let n = 0; n <= 12; n++) {
      const pitch = fitText(lines(n, '가'), false).pitch;
      if (n > 0) expect(pitch).toBeLessThanOrEqual(previous);
      previous = pitch;
    }
  });

  it('keeps a typical 200-character sentence at a readable size, not the floor', () => {
    const sentence = [...SENTENCE.repeat(3)].slice(0, TEXT_MAX).join('');
    expect(fitText(sentence, true).pitch).toBeGreaterThanOrEqual(0.088);
    expect(fitText([...sentence].slice(0, 100).join(''), true).pitch).toBe(LARGEST);
  });

  it('gives wider syllables less room than narrow ones', () => {
    expect(rowsNeeded(widest(60), LARGEST)).toBeGreaterThan(rowsNeeded('고'.repeat(60), LARGEST));
  });

  it('gives a signed paper no larger a size than the same text unsigned', () => {
    for (const text of [hangul(60), hangul(120), lines(10, '가나다'), hangul(200)]) {
      expect(fitText(text, true).pitch).toBeLessThanOrEqual(fitText(text, false).pitch);
    }
  });
});

describe('the worst texts the contract accepts', () => {
  const worst: Record<string, string> = {
    '200 syllables in one paragraph': hangul(200),
    '200 syllables with spaces': '정말 고마웠어요 '.repeat(20).slice(0, 200),
    '12 lines of 15 characters': lines(12, hangul(15)),
    '12 lines of 1 character': lines(12, '가'),
    '11 short lines then one long one': `${lines(11, '가')}\n${hangul(178)}`,
    '200 of the widest syllable': widest(200),
    '12 lines of the widest syllable': lines(12, widest(15)),
    '11 short lines then the widest syllable': `${lines(11, WIDEST)}\n${widest(178)}`,
    '12 empty lines': lines(12, ''),
    'one long latin word': 'W'.repeat(200),
    'latin words of 15': 'abcdefghijklmno '.repeat(13).slice(0, 200),
    'latin words of 12 on 12 lines': lines(12, 'abcdefghijkl'),
    'ascii mixed with hangul': '한글 hello 한글 world '.repeat(10).slice(0, 200),
    '200 emoji': '😀'.repeat(200),
    '11 lines then 178 emoji': `${lines(11, '😀')}\n${'😀'.repeat(178)}`,
    '200 hanja': '漢'.repeat(200),
  };

  for (const [name, text] of Object.entries(worst)) {
    it(`fits at the step it picks, signed or not: ${name}`, () => {
      expect(accepted(text)).toBe(true);
      expect(fits(text, true)).toBe(true);
      expect(fits(text, false)).toBe(true);
    });
  }

  it('holds every one of them at the smallest step, which is what makes the guarantee', () => {
    for (const text of Object.values(worst)) {
      expect(rowsNeeded(text, SMALLEST)).toBeLessThanOrEqual(rowsAvailable(SMALLEST, true));
    }
  });

  it('keeps every Hangul text at or above the second smallest step, so only wide glyphs reach the floor', () => {
    expect(fitText(lines(12, hangul(15)), true).pitch).toBeGreaterThanOrEqual(HANGUL_STEP);
    expect(fitText(`${lines(11, '가')}\n${hangul(178)}`, true).pitch).toBeGreaterThanOrEqual(HANGUL_STEP);
  });

  it('puts 12 single-character lines on a larger step than 200 characters in a paragraph', () => {
    expect(fitText(lines(12, '가'), false).pitch).toBeGreaterThan(fitText(hangul(200), false).pitch);
  });

  // Every way to split 200 syllables over 12 paragraphs, not a sample of them.
  it('holds the worst split of syllables over lines at the Hangul step', () => {
    const rows = Array.from({ length: TEXT_MAX + 1 }, (_, n) => rowsNeeded(widest(n), HANGUL_STEP));
    let best = [...rows];
    for (let paragraph = 2; paragraph <= TEXT_MAX_LINES; paragraph++) {
      const previous = best;
      best = previous.map((_, total) => Math.max(...Array.from({ length: total + 1 }, (_, last) => previous[total - last]! + rows[last]!)));
    }
    expect(Math.max(...best)).toBeLessThanOrEqual(rowsAvailable(HANGUL_STEP, true));
  });

  // A hill climb that edits a text to cost as many rows as it can, over syllables, latin, spaces, breaks and wide glyphs.
  it('survives a search for texts that overflow the smallest step', () => {
    const alphabet = ['가', '빠', '힣', 'a', 'W', ' ', ' ', '\n', '😀', '漢', '.'];
    const inline = alphabet.filter((c) => c !== '\n');
    const next = random(7);
    let worstRows = 0;
    for (let run = 0; run < 40; run++) {
      let chars = Array.from({ length: 1 + next(TEXT_MAX) }, () => inline[next(inline.length)]!);
      let score = rowsNeeded(chars.join(''), SMALLEST);
      for (let step = 0; step < 1500; step++) {
        const candidate = [...chars];
        const at = next(candidate.length);
        const move = next(3);
        if (move === 0 && candidate.length < TEXT_MAX) candidate.splice(at, 0, alphabet[next(alphabet.length)]!);
        else if (move === 1 && candidate.length > 1) candidate.splice(at, 1);
        else candidate[at] = alphabet[next(alphabet.length)]!;
        if (!accepted(candidate.join(''))) continue;
        const rows = rowsNeeded(candidate.join(''), SMALLEST);
        if (rows >= score) {
          chars = candidate;
          score = rows;
        }
      }
      worstRows = Math.max(worstRows, score);
      expect(fits(chars.join(''), true)).toBe(true);
    }
    expect(worstRows).toBeLessThanOrEqual(rowsAvailable(SMALLEST, true));
  });

  it('fits random accepted text of every length at the step it picks', () => {
    const next = random(99);
    const alphabet = ['가', '나', '다', '라', '마', 'a', 'b', ' ', ' ', '\n', '1', '!'];
    for (let run = 0; run < 1500; run++) {
      const text = Array.from({ length: next(TEXT_MAX + 1) }, () => alphabet[next(alphabet.length)]!).join('');
      if (!accepted(text)) continue;
      expect(fits(text, run % 2 === 0)).toBe(true);
    }
  });
});

describe('the styles that put a fit on the paper', () => {
  it('writes every length as a share of the paper width', () => {
    const style = textFitStyle({ size: 0.1058, pitch: 0.115, lead: 0 }, false);
    expect(style['--ls']).toBe('11.5cqw');
    expect(style.fontSize).toBe('10.58cqw');
    expect(style.lineHeight).toBe('11.5cqw');
  });

  it('keeps the same margin above and below an unsigned paper and clears the signature on a signed one', () => {
    const fit = { size: 0.1, pitch: 0.1, lead: 0 };
    expect(textFitStyle(fit, false)['--tf-pad']).toBe('4.5cqw 5cqw 4.5cqw');
    expect(textFitStyle(fit, true)['--tf-pad']).toBe('4.5cqw 5cqw 17cqw');
  });

  it('adds the lead rows to the top padding and leaves the ruled lines where they were', () => {
    const fit = { size: 0.1, pitch: 0.1, lead: 3 };
    expect(textFitStyle(fit, false)['--tf-pad']).toBe('34.5cqw 5cqw 4.5cqw');
    expect(textFitStyle(fit, true)['--tf-pad']).toBe('34.5cqw 5cqw 17cqw');
    expect(textFitStyle(fit, false)['--tf-top']).toBe('4.5cqw');
  });
});

describe('where the text block sits (D-42)', () => {
  const cases: Record<string, string> = {
    'an empty paper': '',
    'one short line': '서연이요!',
    'a few lines': '서연이요!\n발표 자료 같이 만들어 줘서\n정말 고마웠어요',
    'the 200-character paragraph': [...SENTENCE.repeat(3)].slice(0, TEXT_MAX).join(''),
    'the 12-line worst case': lines(TEXT_MAX_LINES, '가나다라마바사아자차카타파하서'),
    '12 single-character lines': lines(TEXT_MAX_LINES, '가'),
    '200 of the widest syllable': widest(TEXT_MAX),
    '200 emoji': '😀'.repeat(TEXT_MAX),
  };

  for (const [name, text] of Object.entries(cases)) {
    for (const signed of [false, true]) {
      it(`leaves a whole, non-negative number of rows above ${name}, ${signed ? 'signed' : 'unsigned'}, and keeps the last row on the paper`, () => {
        const { pitch, lead } = fitText(text, signed);
        const available = rowsAvailable(pitch, signed);
        const rows = rowsNeeded(text, pitch);
        expect(Number.isInteger(lead)).toBe(true);
        expect(lead).toBeGreaterThanOrEqual(0);
        expect(lead + rows).toBeLessThanOrEqual(available);
        expect(lead).toBe(Math.max(0, Math.floor((available - rows) / 2)));
      });
    }
  }

  it('treats an empty paper as one row, so the placeholder sits in the middle too', () => {
    for (const signed of [false, true]) {
      const { pitch, lead } = fitText('', signed);
      expect(rowsNeeded('', pitch)).toBe(1);
      expect(lead).toBe(Math.floor((rowsAvailable(pitch, signed) - 1) / 2));
      expect(lead).toBeGreaterThan(0);
      expect(fitText('서연이요!', signed).lead).toBe(lead);
    }
  });

  it('puts the large friendly size at the known middle of an unsigned and a signed paper', () => {
    expect(rowsAvailable(LARGEST, false)).toBe(10);
    expect(fitText('서연이요!', false).lead).toBe(4);
    expect(rowsAvailable(LARGEST, true)).toBe(9);
    expect(fitText('서연이요!', true).lead).toBe(4);
    expect(fitText('서연이요!\n둘째 줄\n셋째 줄', false).lead).toBe(3);
    expect(fitText('서연이요!\n둘째 줄\n셋째 줄', true).lead).toBe(3);
  });

  it('leaves no lead at the largest row count a step holds', () => {
    for (const signed of [false, true]) {
      const full = lines(TEXT_MAX_LINES, '가');
      const { pitch, lead } = fitText(full, signed);
      expect(rowsNeeded(full, pitch)).toBe(TEXT_MAX_LINES);
      expect(rowsAvailable(pitch, signed)).toBe(TEXT_MAX_LINES);
      expect(lead).toBe(0);
    }
  });

  it('gives a signed paper no more lead than the same text unsigned at the same size', () => {
    const text = '서연이요!';
    expect(fitText(text, true).lead).toBeLessThanOrEqual(fitText(text, false).lead);
  });

  it('moves the block down one row at a time, never jumping, while a step holds', () => {
    for (const signed of [false, true]) {
      let previous: { pitch: number; lead: number } | null = null;
      for (let n = 1; n <= TEXT_MAX_LINES; n++) {
        const { pitch, lead } = fitText(lines(n, '가'), signed);
        if (previous && previous.pitch === pitch) {
          expect(lead).toBeLessThanOrEqual(previous.lead);
          expect(previous.lead - lead).toBeLessThanOrEqual(1);
        }
        previous = { pitch, lead };
      }
    }
  });

  it('gives the lead of any row count the browser may draw, whole and never off the paper', () => {
    for (const pitch of TEXT_STEPS) {
      for (const signed of [false, true]) {
        const available = rowsAvailable(pitch, signed);
        for (let rows = 1; rows <= available + 3; rows++) {
          const lead = leadOf(rows, pitch, signed);
          expect(Number.isInteger(lead)).toBe(true);
          expect(lead).toBeGreaterThanOrEqual(0);
          if (rows <= available) expect(lead + rows).toBeLessThanOrEqual(available);
          else expect(lead).toBe(0);
        }
      }
    }
  });

  it('puts fewer measured rows no higher than the estimate would, and the same count at the same place', () => {
    for (const text of [hangul(60), hangul(200), lines(3, '가나다'), '서연이요!']) {
      for (const signed of [false, true]) {
        const { pitch, lead } = fitText(text, signed);
        const modeled = rowsNeeded(text, pitch);
        expect(leadOf(modeled, pitch, signed)).toBe(lead);
        for (let drawn = 1; drawn <= modeled; drawn++) expect(leadOf(drawn, pitch, signed)).toBeGreaterThanOrEqual(lead);
        expect(leadOf(1, pitch, signed)).toBeGreaterThanOrEqual(leadOf(modeled, pitch, signed));
      }
    }
  });

  it('moves down one row for every two fewer rows drawn', () => {
    const pitch = LARGEST;
    expect(leadOf(1, pitch, false)).toBe(4);
    expect(leadOf(3, pitch, false)).toBe(3);
    expect(leadOf(5, pitch, false)).toBe(2);
    expect(leadOf(10, pitch, false)).toBe(0);
  });

  it('never lets the lead and the rows overflow for random accepted text', () => {
    const next = random(2024);
    const alphabet = ['가', '나', '다', '라', 'a', 'b', ' ', ' ', '\n', '1', '😀'];
    for (let run = 0; run < 1500; run++) {
      const text = Array.from({ length: next(TEXT_MAX + 1) }, () => alphabet[next(alphabet.length)]!).join('');
      if (!accepted(text)) continue;
      const signed = run % 2 === 0;
      const { pitch, lead } = fitText(text, signed);
      expect(lead).toBeGreaterThanOrEqual(0);
      expect(lead + rowsNeeded(text, pitch)).toBeLessThanOrEqual(rowsAvailable(pitch, signed));
    }
  });
});
