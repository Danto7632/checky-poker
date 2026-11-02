// A-APP-COMPOSE (I-23) — the app's single dependency-injection root.
//
// Static part (safe before the gate): config and ONE storage instance (A-STO-CREATE says the app creates it once).
// Game part: session (-> host Worker, later net) and ai are loaded only through loadGameServices(), a dynamic import
// of ./game-services, which screens call after GateRoute has let the user in (SS2 rule 3 — no relay or LLM code is
// even evaluated before the notice is accepted; GateRoute.test.tsx watches module evaluation to prove it).
//
// Lint allows dynamic import() of same-folder files only, which is why the game modules sit behind ./game-services
// instead of `import('@/session')` here.
import * as config from '@/config';
import type { AppConfig } from '@/session';
import { createStorage, type StorageApi } from '@/storage';
import type { GameServices } from './game-services';

export interface AppServices {
  config: AppConfig;
  storage: StorageApi;
}

let appServices: AppServices | null = null;

export function createAppServices(storage: StorageApi): AppServices {
  return { config, storage };
}

/**
 * The process-wide services; storage is created on first use and never again (A-STO-CREATE). If IndexedDB cannot
 * be opened, storage itself falls back to memory and reports E-STO-UNAVAILABLE through issue() (H-01 banner).
 */
export function getAppServices(): AppServices {
  appServices ??= createAppServices(createStorage());
  return appServices;
}

/** Test hook: replace the singleton (composition.test.ts, GateRoute.test.tsx). */
export function setAppServicesForTest(services: AppServices | null): void {
  appServices = services;
}

let gameServices: Promise<GameServices> | null = null;

/**
 * Loads session + ai once, after the gate. Rejects only if the chunk itself fails to load — and then forgets the
 * attempt, so the next call (a shell warm-up retry, "Deal me in", "Start again") imports again instead of replaying
 * the same rejection until a reload. What that retry recovers is a transient fetch failure (a dropped connection, measured in
 * Chrome: the second import() of the same URL is a new request). It does not recover a tab left open across a
 * deploy: the old hashed chunk stays 404 however often it is asked for, and only a reload helps (review O-2).
 * ponytail: one cached instance for the page, bound to the first services passed (the app has exactly one);
 * key the cache by services if a second composition ever appears.
 */
export function loadGameServices(services: AppServices = getAppServices()): Promise<GameServices> {
  gameServices ??= import('./game-services').then(
    (m) => m.createGameServices(services),
    (e: unknown) => {
      gameServices = null;
      throw e;
    },
  );
  return gameServices;
}

/** Test hook: forget the loaded game services. */
export function resetGameServicesForTest(): void {
  gameServices = null;
}
