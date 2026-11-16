import { useCallback, useSyncExternalStore } from 'react';

// Mirrors the 1024px laptop breakpoint in the stylesheets.
export const WIDE = '(min-width: 1024px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
