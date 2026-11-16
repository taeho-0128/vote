// Measures Nanum Pen Script and prints the advance-width table that web/src/textFit.ts embeds. Rerun it, and the
// textFit tests, if the font changes. Run from the project root: npx tsx e2e/hand-widths.mjs
import { chromium } from 'playwright-core';
import { EDGE } from './kit.mjs';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap" rel="stylesheet"><canvas id="c"></canvas>`);
await page.waitForTimeout(800);
const widths = await page.evaluate(async () => {
  const syllables = Array.from({ length: 11172 }, (_, i) => String.fromCharCode(0xac00 + i));
  await document.fonts.load("100px 'Nanum Pen Script'", syllables.join(''));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const ctx = document.getElementById('c').getContext('2d');
  ctx.font = "100px 'Nanum Pen Script'";
  const ascii = Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i));
  return {
    syllables: syllables.map((s) => ctx.measureText(s).width),
    ascii: ascii.map((s) => ctx.measureText(s).width),
    space: ctx.measureText(' ').width,
    jamo: Array.from({ length: 0x3190 - 0x3130 }, (_, i) => ctx.measureText(String.fromCharCode(0x3130 + i)).width),
  };
});
await browser.close();

// One cell per initial and vowel: the widest of the 28 syllables that end in each final.
const cells = Array.from({ length: 19 * 21 }, (_, cell) => Math.max(...widths.syllables.slice(cell * 28, cell * 28 + 28)));
const hundredths = cells.map((w) => Math.ceil(w - 1e-6));
const row = (initial) => hundredths.slice(initial * 21, initial * 21 + 21).map((h) => h.toString(16).padStart(2, '0')).join('');
console.log(Array.from({ length: 19 }, (_, initial) => `  '${row(initial)}'`).join(' +\n'));
console.log(`syllable max ${Math.max(...widths.syllables) / 100}, ascii max ${Math.max(...widths.ascii) / 100}, space ${widths.space / 100}, jamo max ${Math.max(...widths.jamo) / 100}`);
