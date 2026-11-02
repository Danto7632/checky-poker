// TEST-ONLY in-process host port (Q-008, T-013): the real shell code on the same thread, for Vitest where no
// Worker exists. Running the dealer on the main thread in the app would break D6, hence two guards: this file is
// not exported by the host index (lint lets only *.test.ts import '@/host/testing'), and it throws outside
// `import.meta.env.MODE === 'test'`. 5-1 checks the release bundle holds no createInProcessHostPort.
//
// Messages cross the "thread boundary" through structuredClone with the transfer list, so a transferred
// ArrayBuffer is detached on the sending side exactly as with postMessage (AC-10 check 3), and delivery is
// asynchronous (a microtask), like a real Worker. `captured` keeps every Worker -> main message as posted
// (before cloning) together with its transfer list, for egress assertions; 2-1 and 3-1 tests reuse it.
import type { WorkerOutbound } from '@checky/engine/protocol';
import type { HostPort } from './index';
import { createShell, type ShellOptions } from './shell';

export interface Captured {
  msg: WorkerOutbound;
  transfer: Transferable[];
}

export interface InProcessHostPort extends HostPort {
  readonly captured: Captured[];
  /** Simulate a Worker crash (error event). */
  crash(): void;
}

export function createInProcessHostPort(overrides: Partial<Omit<ShellOptions, 'post'>> = {}): InProcessHostPort {
  if (import.meta.env.MODE !== 'test') throw new Error('createInProcessHostPort is test-only');
  const messageListeners = new Set<(msg: unknown) => void>();
  const crashListeners = new Set<() => void>();
  const captured: Captured[] = [];
  let terminated = false;
  const shell = createShell({
    acceptTestSeed: false,
    ...overrides,
    post(msg, transfer = []) {
      // A terminated Worker posts nothing, not even the W.DISPOSED of the shutdown below.
      if (terminated) return;
      captured.push({ msg, transfer });
      const delivered: unknown = structuredClone(msg, { transfer });
      queueMicrotask(() => {
        if (terminated) return;
        for (const l of [...messageListeners]) l(delivered);
      });
    },
  });
  return {
    captured,
    post(msg) {
      const cloned: unknown = structuredClone(msg);
      queueMicrotask(() => {
        if (!terminated) shell.handle(cloned);
      });
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onCrash(listener) {
      crashListeners.add(listener);
      return () => crashListeners.delete(listener);
    },
    terminate() {
      terminated = true;
      // Cancels the shell's timers, as killing the Worker would.
      shell.handle({ t: 'W.DISPOSE' });
    },
    crash() {
      for (const l of [...crashListeners]) l();
    },
  };
}
