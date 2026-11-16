import { useSyncExternalStore } from 'react';
import { ROOM_CODE_PATTERN } from '../../shared/protocol.ts';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'participant'; readonly code: string }
  | { readonly name: 'host'; readonly code: string }
  | { readonly name: 'not-found' };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  const [head, code] = parts;
  if (parts.length === 2 && code && ROOM_CODE_PATTERN.test(code)) {
    if (head === 'r') return { name: 'participant', code };
    if (head === 'host') return { name: 'host', code };
  }
  return { name: 'not-found' };
}

const NAVIGATE_EVENT = 'hanpyo:navigate';

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

const getLocation = (): string => location.pathname + location.search;

export function useRoute(): Route {
  const current = useSyncExternalStore(subscribe, getLocation);
  return parseRoute(current.split('?')[0] ?? '/');
}
