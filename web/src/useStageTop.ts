import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

// Tells the stylesheet how far down the page `target` starts, so the folding stage can take exactly the screen that
// is left under a title of any length and under a reconnect banner. The value is a CSS variable on `target` itself.
// `above` is what sits over it: the observer reports when that block changes size, and a commit covers banners.
export function useStageTop(target: RefObject<HTMLElement | null>, above: RefObject<HTMLElement | null>): void {
  const measure = () => {
    const el = target.current;
    if (el) el.style.setProperty('--stage-top', `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
  };

  useLayoutEffect(measure);

  useEffect(() => {
    // A drag-resize fires many events per frame. One measure per frame is all the stylesheet can show.
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const observer = new ResizeObserver(schedule);
    if (above.current) observer.observe(above.current);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);
}
