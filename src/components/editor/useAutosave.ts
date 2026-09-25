'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'local-only'; at: number }
  | { kind: 'conflict'; currentRevision: number }
  | { kind: 'error'; message: string };

/**
 * Autosave with honest status reporting and local recovery.
 *
 * Three things this gets right that a naive debounce does not:
 *
 *  1. IT TELLS THE TRUTH. "Saved" means the server acknowledged it. If the
 *     request failed because the device is offline, the state is
 *     "Saved on this device — waiting for internet", not "Saved".
 *
 *  2. IT DOES NOT OVERWRITE NEWER WORK. The server rejects a save whose base
 *     revision is stale; we surface that as a conflict rather than retrying
 *     harder and clobbering the other device's edit.
 *
 *  3. IT KEEPS A LOCAL COPY on the same device until the server has the work,
 *     so closing the tab mid-bill does not lose it. The copy is cleared on
 *     successful save and on sign-out.
 */
export function useAutosave<T>({
  value,
  save,
  localKey,
  delayMs = 900,
  enabled = true,
}: {
  value: T;
  save: (value: T) => Promise<{ ok: true; revision: number } | { ok: false; conflictRevision?: number; message: string }>;
  localKey: string;
  delayMs?: number;
  enabled?: boolean;
}) {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const pending = useRef<T | null>(null);
  const firstRun = useRef(true);

  const writeLocal = useCallback(
    (v: T) => {
      try {
        window.localStorage.setItem(localKey, JSON.stringify({ at: Date.now(), value: v }));
      } catch {
        // Private mode or a full quota. Local recovery is a convenience, not a
        // guarantee, so this failing must not break editing.
      }
    },
    [localKey],
  );

  const clearLocal = useCallback(() => {
    try {
      window.localStorage.removeItem(localKey);
    } catch {
      /* ignore */
    }
  }, [localKey]);

  const flush = useCallback(
    async (v: T) => {
      if (inFlight.current) {
        pending.current = v;
        return;
      }
      inFlight.current = true;
      setState({ kind: 'saving' });
      try {
        const result = await save(v);
        if (result.ok) {
          clearLocal();
          setState({ kind: 'saved', at: Date.now() });
        } else if (result.conflictRevision !== undefined) {
          writeLocal(v);
          setState({ kind: 'conflict', currentRevision: result.conflictRevision });
        } else {
          writeLocal(v);
          setState({ kind: 'error', message: result.message });
        }
      } catch {
        // A thrown request almost always means the network, not the data.
        writeLocal(v);
        setState({ kind: 'local-only', at: Date.now() });
      } finally {
        inFlight.current = false;
        const queued = pending.current;
        pending.current = null;
        if (queued !== null) void flush(queued);
      }
    },
    [save, clearLocal, writeLocal],
  );

  useEffect(() => {
    if (!enabled) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    // Keep a local copy immediately; the server copy follows after the debounce.
    writeLocal(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(value), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, enabled, delayMs, flush, writeLocal]);

  // Retry as soon as the browser says the connection is back.
  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => {
      if (state.kind === 'local-only' || state.kind === 'error') void flush(value);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [enabled, flush, state.kind, value]);

  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await flush(value);
  }, [flush, value]);

  return { state, saveNow, clearLocal };
}

export function readLocalDraft<T>(localKey: string): { at: number; value: T } | null {
  try {
    const raw = window.localStorage.getItem(localKey);
    if (!raw) return null;
    return JSON.parse(raw) as { at: number; value: T };
  } catch {
    return null;
  }
}

export function saveStateLabel(state: SaveState): { text: string; className: string } {
  switch (state.kind) {
    case 'saving':
      return { text: 'Saving…', className: 'save-state' };
    case 'saved':
      return { text: 'Saved', className: 'save-state' };
    case 'local-only':
      return { text: 'Saved on this device — waiting for internet', className: 'save-state save-state--offline' };
    case 'conflict':
      return { text: 'Changed somewhere else — refresh to see it', className: 'save-state save-state--error' };
    case 'error':
      return { text: state.message, className: 'save-state save-state--error' };
    default:
      return { text: '', className: 'save-state' };
  }
}
