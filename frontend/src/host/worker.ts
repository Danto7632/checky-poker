// Dedicated Worker entry (ADR-0003). Only wiring: all logic is in shell.ts so it can be tested without a Worker
// (happy-dom and Node have none). No dynamic import here: Vite 6 builds workers as IIFE, where code splitting
// fails the build (story 1-1 constraint, scratch-verified).
import { flags } from '@/config';
import { createShell } from './shell';

// The frontend tsconfig has the DOM lib, not WebWorker: narrow `self` to the two members a worker uses.
const scope = self as unknown as {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
};

const shell = createShell({
  post: (msg, transfer) => scope.postMessage(msg, transfer ?? []),
  acceptTestSeed: flags.E2E,
});

scope.onmessage = (e) => shell.handle(e.data);
