// The tab's dealer Worker, shared by every room this tab opens (lead review 2, R0-L12; protocol.worker.v1).
//
// Spawning a Worker fetches its script, which fails offline. So the tab keeps ONE Worker and leases it to one room
// at a time: a room ends with release() — W.DISPOSE goes out and the Worker stays alive for the next acquire().
// The Worker answers every W.DISPOSE with exactly one W.DISPOSED, and postMessage is FIFO in both directions, so
// anything that arrives between a W.DISPOSE and its W.DISPOSED belongs to a disposed room and is dropped here: a
// late view, H.ACK{c} or W.ERROR of the old room never reaches the next room's client (whose c restarts at 1).
// A queue, not a flag: a second room may be opened and released before the first W.DISPOSED is back.
//
// Crash = the Worker's error / messageerror event, W.FATAL (the shell stops for good after it), or no W.DISPOSED
// within DISPOSE_TIMEOUT_MS of its W.DISPOSE, or of the Worker's first message if it was posted before that (R0-L31:
// a hung Worker would otherwise mute every later room of the tab, with no error; R0-L34). The Worker is terminated
// and forgotten together with its pending W.DISPOSEs (R0-L30); the current lease hears onCrash; the next acquire()
// spawns a fresh Worker.
//
// Alive (R0-L34) = the Worker has sent its first message other than W.FATAL: its script was fetched and runs.
// prewarm() resolves true then, and false if the spawn throws or the Worker crashes first. A Worker no room has used
// yet has no reason to speak, so prewarm() sends it a W.DISPOSE as a probe: the shell answers one even with no room
// open, and the probe takes its place in the queue above like any other W.DISPOSE (no new message type).
//
// ponytail: offline, a Worker that really crashed cannot be replaced ("Start again" needs a fresh script fetch);
// add a Service Worker precache of the worker chunk once offline crash recovery is required.
import type { WorkerInbound } from '@checky/engine/protocol';
import { createHostWorker, type HostPort } from '@/host';

// A running shell answers W.DISPOSE within one input: ~200x headroom over the slowest one measured (AC-10 bench,
// p95 4 ms, max 10 ms), so only a hung Worker reaches it. A W.DISPOSE posted before the Worker is alive gets its
// 2000 ms from the first message instead (R0-L34): fetching and evaluating the script is not an input, and on a slow
// network it alone can outlast 2000 ms (fix3 review N1). A load that fails fires `error`, a crash as above.
// ponytail: fixed 2000 ms, and a main thread stalled past it can still run the timer before the queued answer
// (a healthy Worker read as hung); raise it or time it per device if field runs show a normal W.DISPOSED taking
// over 2000 ms.
// ponytail: a script load that hangs without an error is never timed (left to the browser's network timeout), so its
// table stays blank and prewarm() pending; time the load too if the field reports a blank table with no error.
const DISPOSE_TIMEOUT_MS = 2000;

/** One room's handle on the shared Worker. W.DISPOSE cannot be posted: a room ends only through release(). */
export interface HostLease {
  /** Dropped once this lease is released or revoked, so a stale client can never act in the next room. */
  post(msg: Exclude<WorkerInbound, { t: 'W.DISPOSE' }>): void;
  onMessage(listener: (msg: unknown) => void): () => void;
  onCrash(listener: () => void): () => void;
  /** Ends this room: W.DISPOSE, and the Worker waits for the next acquire() (no terminate). Idempotent. */
  release(): void;
}

export interface SharedHost {
  /**
   * Spawns the Worker now and probes it if the tab has none. Resolves true once that Worker is alive, false if the
   * spawn throws (acquire() retries it and throws) or the Worker crashes first; never rejects. The same promise for
   * as long as the same Worker lives, and nothing is posted to a Worker the tab already has (a W.DISPOSE would end
   * its open room). After a crash: a fresh spawn and a fresh promise.
   */
  prewarm(): Promise<boolean>;
  /**
   * Leases the Worker to a new room, spawning it if needed (throws what the spawn throws). A room still holding
   * the lease is released first and then told through its `revoke` callback (its client disposes itself).
   */
  acquire(revoke: () => void): HostLease;
}

interface Lease {
  readonly messages: Set<(msg: unknown) => void>;
  readonly crashes: Set<() => void>;
  readonly revoke: () => void;
}

const typeOf = (msg: unknown): unknown => (typeof msg === 'object' && msg !== null ? (msg as { t?: unknown }).t : undefined);

export function createSharedHost(spawn: () => HostPort): SharedHost {
  let port: HostPort | null = null;
  let lease: Lease | null = null; // non-null only while `port` is the Worker it was acquired on
  // Of the current `port`, reset at each spawn. The initial promise is never handed out (prewarm() spawns first).
  let alive = false;
  let ready = Promise.resolve(false);
  let settleReady: (ok: boolean) => void = () => undefined;
  // One watchdog per W.DISPOSE whose W.DISPOSED is not back yet, oldest first: while any is pending every message
  // is from a disposed room. `undefined` = posted before the Worker was alive, armed by wake().
  const disposing: (ReturnType<typeof setTimeout> | undefined)[] = [];

  const deliver = (l: Lease, msg: unknown): void => {
    for (const fn of [...l.messages]) fn(msg);
  };

  function discard(p: HostPort): void {
    if (port !== p) return;
    const crashed = lease;
    port = null;
    lease = null;
    // A no-op once it said true. Before the crash listeners: one may spawn the next Worker, whose promise this is not.
    settleReady(false);
    for (const timer of disposing.splice(0)) clearTimeout(timer);
    p.terminate();
    for (const fn of crashed === null ? [] : [...crashed.crashes]) fn();
  }

  const arm = (p: HostPort): ReturnType<typeof setTimeout> => setTimeout(() => discard(p), DISPOSE_TIMEOUT_MS);

  /** The Worker's first message: prewarm() hears true, and every W.DISPOSE posted so far starts its clock now. */
  function wake(p: HostPort): void {
    alive = true;
    settleReady(true);
    for (let i = 0; i < disposing.length; i += 1) disposing[i] ??= arm(p);
  }

  function ensure(): HostPort {
    if (port !== null) return port;
    const p = spawn();
    port = p;
    alive = false;
    ready = new Promise<boolean>((resolve) => {
      settleReady = resolve;
    });
    p.onMessage((msg) => {
      if (port !== p) return; // a discarded Worker
      const t = typeOf(msg);
      if (!alive && t !== 'W.FATAL') wake(p); // a W.FATAL first is a crash before any answer: prewarm() -> false
      if (t === 'W.DISPOSED') {
        clearTimeout(disposing.shift()); // FIFO: it answers the oldest W.DISPOSE (an unpaired one changes nothing)
        return;
      }
      const live = disposing.length === 0 ? lease : null;
      if (t === 'W.FATAL') {
        // The live room hears its own fatal code first. A fatal of a disposed room reaches the current lease as a
        // crash below: the stopped shell has ignored that room's W.INIT.
        if (live !== null) deliver(live, msg);
        discard(p);
        return;
      }
      if (live !== null) deliver(live, msg);
    });
    p.onCrash(() => discard(p));
    return p;
  }

  function postDispose(p: HostPort): void {
    disposing.push(alive ? arm(p) : undefined);
    p.post({ t: 'W.DISPOSE' });
  }

  function release(l: Lease): void {
    if (lease !== l || port === null) return;
    lease = null;
    postDispose(port);
  }

  return {
    prewarm() {
      if (port !== null) return ready;
      let p: HostPort;
      try {
        p = ensure();
      } catch {
        // Not lost: the next acquire() spawns again and throws to its caller (createPracticeClient -> crash screen).
        // Reported, not thrown: prewarm is an optimisation called on mount (and where no Worker exists, e.g. tests).
        return Promise.resolve(false);
      }
      postDispose(p); // the probe: its W.DISPOSED is the first message, as no room has posted before it
      return ready;
    },
    acquire(revoke) {
      const old = lease;
      if (old !== null) {
        release(old);
        old.revoke();
      }
      const p = ensure();
      const l: Lease = { messages: new Set(), crashes: new Set(), revoke };
      lease = l;
      return {
        post(msg) {
          if (lease === l) p.post(msg);
        },
        onMessage(fn) {
          l.messages.add(fn);
          return () => l.messages.delete(fn);
        },
        onCrash(fn) {
          l.crashes.add(fn);
          return () => l.crashes.delete(fn);
        },
        release: () => release(l),
      };
    },
  };
}

/** The tab's one dealer Worker. Spawned lazily (by prewarm or the first table), never at import. */
const tabHost = createSharedHost(createHostWorker);

export const acquireTabHost: SharedHost['acquire'] = (revoke) => tabHost.acquire(revoke);

/**
 * Spawns the tab's dealer Worker now, so later tables open without fetching its script (the app shell warm-up calls
 * it while online — offline practice, R0-L12). Resolves true once that Worker has answered (its script loaded and
 * runs), false if it cannot be made (e.g. no Worker) or crashed first; never rejects. The same promise while the same
 * Worker lives (R0-L34).
 */
export function prewarmPracticeHost(): Promise<boolean> {
  return tabHost.prewarm();
}
