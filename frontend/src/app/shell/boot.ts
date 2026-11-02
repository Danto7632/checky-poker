// A-APP-BOOT — runs as the very first module of the app (the first import in main.tsx), before React and before any
// analytics beacon could read the address bar.
//
// Secret fragments are moved off the URL immediately (api-contracts section 1, ADR-0013):
//   /join#<CODE>          -> sessionStorage cp.boot.v1 = {"route":"/join","secret":"<CODE>"}   (2-3 consumes it)
//   /replay#<ver>.<data>  -> sessionStorage cp.replay.v1 = "<ver>.<data>"                     (4-3 consumes it)
// then history.replaceState(null, '', pathname) removes the hash. /history#h=… and /settings#… are not secret and
// stay (strip_on_boot: false). If sessionStorage is unavailable the secret still lives in `bootDestination` for this
// page, and the hash is removed anyway: keeping a secret off the URL matters more than surviving a reload.
//
// This file must stay import-free so nothing can run before it.
export interface BootDestination {
  /** Path the app was opened on, e.g. "/join". */
  route: string;
  /** Invite code (join) or share payload (replay) taken from the fragment; null otherwise. */
  secret: string | null;
}

export const BOOT_KEY = 'cp.boot.v1';
export const REPLAY_KEY = 'cp.replay.v1';

export interface BootEnv {
  location: { pathname: string; hash: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  sessionStorage: Pick<Storage, 'setItem'> | null;
}

function defaultEnv(): BootEnv {
  let store: BootEnv['sessionStorage'] = null;
  try {
    store = window.sessionStorage;
  } catch {
    store = null; // storage access can throw (privacy settings); the in-memory value below still works
  }
  return { location: window.location, history: window.history, sessionStorage: store };
}

function trySet(store: BootEnv['sessionStorage'], key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Quota or privacy mode: keep going, bootDestination still carries the value for this page.
  }
}

export function captureBootDestination(env: BootEnv = defaultEnv()): BootDestination {
  const route = env.location.pathname.replace(/\/+$/, '') || '/';
  const raw = env.location.hash.startsWith('#') ? env.location.hash.slice(1) : env.location.hash;
  if (raw === '' || (route !== '/join' && route !== '/replay')) return { route, secret: null };

  if (route === '/join') trySet(env.sessionStorage, BOOT_KEY, JSON.stringify({ route, secret: raw }));
  else trySet(env.sessionStorage, REPLAY_KEY, raw);
  env.history.replaceState(null, '', env.location.pathname);
  return { route, secret: raw };
}

export const bootDestination: BootDestination =
  typeof window === 'undefined' ? { route: '/', secret: null } : captureBootDestination();
