import { useCallback, useEffect, useState } from 'react';

// The report stays mounted this long if the browser never says it finished printing, as some mobile browsers do not.
export const PRINT_FALLBACK_MS = 30_000;

const FRAME_WAIT_MS = 600;
const FONT_WAIT_MS = 3000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Two frames let the report lay out and start loading the fonts its papers use. A hidden tab never paints, so the wait gives up.
const twoFrames = (): Promise<void> =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    delay(FRAME_WAIT_MS),
  ]);

const fontsLoaded = (): Promise<unknown> => Promise.race([document.fonts?.ready ?? Promise.resolve(), delay(FONT_WAIT_MS)]);

export interface PrintJob {
  readonly printing: boolean;
  // Mounts the report and prints it. The title becomes the document's title meanwhile, which is the file name the browser offers.
  readonly start: (title: string) => void;
}

// The print-only report exists only between `start` and the browser's afterprint, or the fallback timer.
export function usePrintJob(): PrintJob {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    if (title === null) return;
    const root = document.documentElement;
    const previousTitle = document.title;
    let live = true;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const finish = () => setTitle(null);

    document.title = title;
    root.classList.add('printing');
    window.addEventListener('afterprint', finish);

    void (async () => {
      await twoFrames();
      await fontsLoaded();
      if (!live) return;
      fallback = setTimeout(finish, PRINT_FALLBACK_MS);
      try {
        window.print();
      } catch {
        finish();
      }
    })();

    return () => {
      live = false;
      clearTimeout(fallback);
      window.removeEventListener('afterprint', finish);
      document.title = previousTitle;
      root.classList.remove('printing');
    };
  }, [title]);

  const start = useCallback((next: string) => setTitle((current) => current ?? next), []);
  return { printing: title !== null, start };
}
