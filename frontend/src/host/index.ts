// host — the dealer Web Worker (ADR-0003). session imports only this index (code-structure section 3).
// Bot types are re-exported here because session may not import analysis (AF-34, I-26).
// testing.ts (the in-process port) is deliberately NOT exported: only *.test.ts files may import it.
import type { WorkerInbound } from '@checky/engine/protocol';

export type {
  AbortSignalLike,
  BotDecider,
  BotDecision,
  BotInput,
  DecisionMetrics,
  DeciderEvent,
  Usage,
} from '@checky/analysis';

/** The main thread's handle on the dealer. Messages out of it are `unknown` until checked (WorkerOutbound). */
export interface HostPort {
  post(msg: WorkerInbound): void;
  onMessage(listener: (msg: unknown) => void): () => void;
  /** Worker `error` / `messageerror` (E-WORKER-CRASH, crash_detection — no ping in Phase 1). */
  onCrash(listener: () => void): () => void;
  terminate(): void;
}

export function createHostWorker(): HostPort {
  // Exactly this expression shape, so Vite emits the worker as a same-origin file (CSP worker-src 'self').
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const messageListeners = new Set<(msg: unknown) => void>();
  const crashListeners = new Set<() => void>();
  worker.onmessage = (e: MessageEvent<unknown>) => {
    for (const l of [...messageListeners]) l(e.data);
  };
  const crash = (): void => {
    for (const l of [...crashListeners]) l();
  };
  worker.onerror = crash;
  worker.onmessageerror = crash;
  return {
    post: (msg) => worker.postMessage(msg),
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onCrash(listener) {
      crashListeners.add(listener);
      return () => crashListeners.delete(listener);
    },
    terminate: () => worker.terminate(),
  };
}
