import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { flushSync } from 'react-dom';
import { fitText, leadOf, textFitStyle } from './textFit.ts';

const ZERO_WIDTH = String.fromCharCode(0x200b);

// Rows the browser draws for `text` in the box of `el`, or null when there is nothing laid out to count. The text is
// laid out in a hidden copy that has the same width, side padding, font and wrapping but no top or bottom padding and an
// automatic height, so the answer does not depend on where the text currently sits (moving it cannot change the wrap).
// A trailing break gets a zero-width character, because an element draws no row after its last newline and a textarea does.
export function measureRows(el: HTMLElement, text: string): number | null {
  const parent = el.parentElement;
  const style = getComputedStyle(el);
  const pitch = parseFloat(style.lineHeight);
  if (!parent || !(el.clientWidth > 0) || !(pitch > 0)) return null;
  const copy = document.createElement('div');
  copy.style.cssText = el.style.cssText;
  Object.assign(copy.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '0',
    top: '0',
    boxSizing: 'border-box',
    width: `${el.clientWidth}px`,
    padding: `0 ${style.paddingRight} 0 ${style.paddingLeft}`,
    fontFamily: style.fontFamily,
    letterSpacing: style.letterSpacing,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'normal',
  });
  copy.textContent = text === '' || text.endsWith('\n') ? `${text}${ZERO_WIDTH}` : text;
  parent.append(copy);
  const rows = Math.round(copy.offsetHeight / pitch);
  copy.remove();
  return rows >= 1 ? rows : null;
}

// The style that sets typed text on a paper: the size comes from the conservative estimate in textFit.ts, and the rows
// left above the text come from counting what the browser actually drew, so the block sits in the middle even where the
// estimate counts rows that are not there. Before the first count, and wherever nothing can be counted (the element is not
// laid out), it uses the estimate's lead. `ref` is the element that holds the text and carries the padding. `sample` is
// the text to count, which is the placeholder for an empty field.
export function useFittedStyle(ref: RefObject<HTMLElement | null>, text: string, signed: boolean, sample: string = text): CSSProperties {
  const fit = fitText(text, signed);
  const key = `${fit.pitch}|${signed}|${sample}`;
  const [counted, setCounted] = useState<{ key: string; rows: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    let live = true;
    const count = () => {
      frame = 0;
      const rows = measureRows(el, sample);
      setCounted((previous) => (rows === null ? null : previous?.key === key && previous.rows === rows ? previous : { key, rows }));
    };
    const later = () => {
      if (live && frame === 0) frame = requestAnimationFrame(count);
    };
    // The print layout can wrap a little differently, so the count is taken again as printing starts.
    const beforePrint = () => flushSync(count);

    count();
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) first = false;
      else later();
    });
    observer.observe(el);
    const fonts = document.fonts;
    fonts?.addEventListener('loadingdone', later);
    void fonts?.ready.then(later);
    window.addEventListener('beforeprint', beforePrint);

    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', later);
      window.removeEventListener('beforeprint', beforePrint);
    };
  }, [ref, key, sample]);

  const lead = counted?.key === key ? leadOf(counted.rows, fit.pitch, signed) : fit.lead;
  return textFitStyle({ ...fit, lead }, signed) as CSSProperties;
}
