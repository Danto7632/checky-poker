// US9 AC2 (screen part): when the log gains an entry for MY seat with auto === 'timeout', toast once —
// "Time ran out — you checked." or "... you folded." (SS9: a timeout only ever checks or folds). With No limit there
// is no timer, so such entries never appear. The toast is a notice, not an error: nothing to recover.
import { useEffect, useRef } from 'react';
import type { PlayerView } from '@checky/engine/protocol';
import { useT } from '../i18n/useT';
import { showToast } from '../ui/Toast';

export function useTimeoutToast(view: PlayerView | null, notify: (message: string) => void = showToast): void {
  const t = useT();
  // undefined until the first snapshot has been seen: entries already in the log then are history, not news.
  const seen = useRef<string | null | undefined>(undefined);
  const hand = view?.hand ?? null;
  const mySeat = view?.me.seat ?? null;
  useEffect(() => {
    const last = hand === null || mySeat === null ? undefined : [...hand.actions].reverse().find((a) => a.seat === mySeat && a.auto === 'timeout');
    const key = hand === null || last === undefined ? null : `${hand.handId}:${last.i}`;
    if (seen.current === undefined) {
      seen.current = key;
      return;
    }
    if (key === null || key === seen.current || last === undefined) return;
    seen.current = key;
    notify(t(last.type === 'check' ? 'act.timeout.check' : 'act.timeout.fold'));
  }, [hand, mySeat, notify, t]);
}
