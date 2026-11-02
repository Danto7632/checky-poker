// Self-record sink (A-REC-BUILD played_at, S11-F09, D-P7): feeds every received view and chat line to the
// engine RecordBuilder and saves each finished hand with deps.hands.put after stamping playedAt with THIS
// device's ISO time (the engine has no clock). A failed save loses that record only: the game goes on and the
// storage module raises its banner issue (E-STO-QUOTA / E-STO-UNAVAILABLE); here the code is logged.
import { createRecordBuilder, type HandRecordV1 } from '@checky/engine/record';
import type { ChatLine, PlayerView, RecordMode } from '@checky/engine/protocol';
import type { HandStore } from '@/storage';
import type { AppConfig } from './types';

export interface RecordSink {
  onView(v: PlayerView): void;
  onChat(line: ChatLine): void;
  /** Resolves when every save started so far has settled (tests, dispose). */
  flush(): Promise<void>;
}

export function createRecordSink(o: { mode: RecordMode; hands: HandStore; config: AppConfig; nowIso?: () => string }): RecordSink {
  const builder = createRecordBuilder({ mode: o.mode, appVersion: o.config.APP_VERSION });
  const nowIso = o.nowIso ?? (() => new Date().toISOString());
  let pending: Promise<void> = Promise.resolve();
  const save = (rec: HandRecordV1): void => {
    const stamped: HandRecordV1 = { ...rec, playedAt: nowIso() };
    pending = pending.then(() =>
      o.hands.put(stamped).catch((e: unknown) => {
        const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : null;
        if (code === 'E-STO-QUOTA' || code === 'E-STO-UNAVAILABLE' || code === 'E-STO-BLOCKED') o.config.debugLog(code);
        // Anything else (an IndexedDB error such as a closed connection) also means "storage did not take it".
        else o.config.debugLog('E-STO-UNAVAILABLE');
      }),
    );
  };
  return {
    onView(v) {
      const rec = builder.onView(v);
      if (rec !== null) save(rec);
    },
    onChat: (line) => builder.onChat(line),
    flush: () => pending,
  };
}
