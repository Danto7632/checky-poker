// Game services — loaded only after the gate (see composition.ts), first by the shell warm-up (practice/warmup.ts).
// This is the one app module that imports the session and ai indexes as values, so their whole graph (host Worker,
// metrics Worker, later net) stays out of the pre-gate bundle.
//
// R0-R1 wiring (D-A12): SessionDeps has no botDecider — practice house bots are decided by the rule bot inside the
// Worker; no fake decider is ever injected here. 3-3 adds a fresh createLlmBotDecider() per room.
import type { DecisionMetrics, MetricsView } from '@checky/analysis';
import type { BotSpec, RoomSettings } from '@checky/engine/protocol';
import { computeMetricsAsync, prewarmMetrics } from '@/ai';
import { createPracticeClient, prewarmPracticeHost } from '@/session';
import type { PracticeTableClient, SessionDeps } from '@/session';
import type { LocalProfile } from '@/storage';
import type { AppServices } from './composition';

export interface PracticeRequest {
  settings: RoomSettings;
  bots: BotSpec[];
  /** Snapshot taken by the caller at creation time: a nickname change applies from the next client (US2 AC3). */
  profile: LocalProfile;
}

export interface GameServices {
  /** Throws an error with a `code` when the table cannot be created (shown as the practice crash screen). */
  createPractice(req: PracticeRequest): PracticeTableClient;
  computeMetrics(view: MetricsView): Promise<DecisionMetrics>;
  /**
   * Spawns the tab's dealer Worker and metrics Worker now, while their scripts can still be fetched (the shell
   * warm-up once per tab, R0-L12 / R0-L29), and reused by every later table. Resolves true once BOTH have answered —
   * their scripts were fetched and run (lead review 4 R0-L36) — and false if either could not be made or crashed
   * first. Never rejects; idempotent while the same Workers live (prewarmPracticeHost / prewarmMetrics).
   */
  prewarm(): Promise<boolean>;
}

export function sessionDeps(services: AppServices): SessionDeps {
  return { hands: services.storage.hands, device: services.storage.device, config: services.config };
}

export function createGameServices(services: AppServices): GameServices {
  return {
    createPractice(req) {
      return createPracticeClient({ settings: req.settings, bots: req.bots, profile: req.profile, deps: sessionDeps(services) });
    },
    computeMetrics: (view) => computeMetricsAsync(view, 'display'),
    // Both are called before either is awaited, so the two Worker scripts are fetched in parallel.
    prewarm: () => Promise.all([prewarmPracticeHost(), prewarmMetrics()]).then(([host, metrics]) => host && metrics),
  };
}
