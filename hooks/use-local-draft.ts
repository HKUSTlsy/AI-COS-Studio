'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

// Unconfirmed text only. Uploaded images and authoritative versions remain on disk.
export function useLocalDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const readyKey = useRef('');
  useEffect(() => {
    let next = initial;
    try {
      const raw = window.localStorage.getItem(`ai-cos:draft:${key}`);
      if (raw) next = JSON.parse(raw) as T;
    } catch { /* A corrupted draft cannot block the editor. */ }
    queueMicrotask(() => { readyKey.current = key; setValue(next); });
    // Initial values are fallbacks; server polling must not replace a user's draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (readyKey.current !== key) return;
    try { window.localStorage.setItem(`ai-cos:draft:${key}`, JSON.stringify(value)); } catch { /* Before-unload protection remains available. */ }
  }, [key, value]);
  return [value, setValue];
}
