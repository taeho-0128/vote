import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface Fullscreen {
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

// Feature-detected: iPhone browsers have no element fullscreen, and a page inside a frame may not be allowed.
export function useFullscreen(target: RefObject<HTMLElement | null>): Fullscreen {
  const supported = document.fullscreenEnabled === true;
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === target.current);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [target]);

  const toggle = useCallback(() => {
    const refused = () => undefined;
    if (document.fullscreenElement) void document.exitFullscreen().catch(refused);
    else void target.current?.requestFullscreen().catch(refused);
  }, [target]);

  return { supported, active, toggle };
}
