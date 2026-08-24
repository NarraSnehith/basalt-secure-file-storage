'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Persisted UI preference (view mode, theme, sort) that survives a reload. */
export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* private mode, corrupt value — the default is fine */
    }
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  return [value, update];
}

export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent | TouchEvent) => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) onOutside();
    };
    // `capture` so a click that also stops propagation still closes the layer.
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('touchstart', handler, true);
    return () => {
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('touchstart', handler, true);
    };
  }, [onOutside, active]);

  return ref;
}

export function useEscape(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, active]);
}

/** Ignore shortcuts while the user is typing. */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
};

export function useHotkeys(
  bindings: Record<string, (event: KeyboardEvent) => void>,
  options: { enabled?: boolean; allowInInputs?: boolean } = {},
): void {
  const { enabled = true, allowInInputs = false } = options;
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (!allowInInputs && isTypingTarget(event.target)) return;
      const parts: string[] = [];
      if (event.metaKey) parts.push('mod');
      else if (event.ctrlKey) parts.push('mod');
      if (event.shiftKey) parts.push('shift');
      if (event.altKey) parts.push('alt');
      parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
      const combo = parts.join('+');
      const handlerFor = ref.current[combo];
      if (handlerFor) {
        event.preventDefault();
        handlerFor(event);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, allowInInputs]);
}

/** Debounced mirror of a value — used for search-as-you-type. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useLayoutEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** Copy to clipboard with a short-lived "copied" flag for the button label. */
export function useCopy(resetAfter = 1800): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API needs a secure context; fall back to a hidden input.
        const node = document.createElement('textarea');
        node.value = text;
        node.style.position = 'fixed';
        node.style.opacity = '0';
        document.body.appendChild(node);
        node.select();
        document.execCommand('copy');
        node.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), resetAfter);
    },
    [resetAfter],
  );
  return [copied, copy];
}
