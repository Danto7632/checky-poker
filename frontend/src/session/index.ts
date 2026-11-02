// session — the only game API the UI subscribes to (api.session.v1). app imports this index only.
export type {
  Ack,
  AppConfig,
  ArenaTableClient,
  ClientNotice,
  ClientSnapshot,
  HostTableClient,
  InviteInfo,
  PracticeOptions,
  PracticeTableClient,
  SessionDeps,
  TableClient,
} from './types';
export type { BotDecider, BotDecision, BotInput } from '@/host';
export { createPracticeClient } from './practice';
export { prewarmPracticeHost } from './shared-host';
export { createFakeClient, FAKE_SCENARIOS } from './fake';
export type { FakeClient } from './fake';
