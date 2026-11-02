// Public shapes of the session module (api.session.v1 — the only game API the UI subscribes to).
//
// The UI reads a ClientSnapshot through useSyncExternalStore(client.subscribe, client.getSnapshot): the
// snapshot is immutable and getSnapshot returns the SAME reference until something changed. Every action
// method that the contract types as Promise<Ack> resolves {ok:true} or {ok:false, code} and never rejects.
import type { DeviceStore, HandStore, LocalProfile } from '@/storage';
import type { BotDecider } from '@/host';
import type * as ConfigModule from '@/config';
import type {
  BotSpec,
  ChatLine,
  ConnStage,
  EngineAction,
  ErrorCode,
  NoticeCode,
  PlayerView,
  RoomSettings,
  RoomSummary,
  SeatIndex,
} from '@checky/engine/protocol';

export type Ack = { ok: true } | { ok: false; code: ErrorCode };

export interface InviteInfo {
  code: string;
  display: string;
  link: string;
}

export interface ClientNotice {
  code: NoticeCode;
  p: Record<string, unknown>;
  atMs: number;
}

export interface ClientSnapshot {
  conn: {
    stage: ConnStage;
    error: ErrorCode | null;
    hostLost: null | { startedAtMs: number; deadlineMs: number };
    reconnecting: boolean;
    /** True only when this tab was rejected as the host's own other tab (H.REJECT E-JOIN-OTHER-TAB, F-JN-03). */
    hostTab: boolean;
  };
  view: PlayerView | null;
  /** Last 100 lines, memory only. */
  chat: ChatLine[];
  /** Last 20. */
  notices: ClientNotice[];
  host: null | { invite: InviteInfo; selfOnline: boolean };
  closed: RoomSummary | null;
  /** Non-fatal Worker error shown as a screen (E-ENG-INVARIANT). Cleared when the next hand starts. */
  alert: null | { code: ErrorCode; atMs: number };
}

export interface TableClient {
  getSnapshot(): ClientSnapshot;
  subscribe(listener: () => void): () => void;
  act(action: EngineAction): Promise<Ack>;
  sit(mode: 'out' | 'in'): void;
  refill(): void;
  leave(): Promise<void>;
  cancelWait(): void;
  chat(text: string): Promise<Ack>;
  inviteInfo(): InviteInfo | null;
  dispose(): void;
}

export interface PracticeTableClient extends TableClient {
  /** In a hand: pause after it (pending). Between hands: pause now. */
  pause(): void;
  /** Pending pause: cancel it. PAUSED: resume (sits me back in first when I was sitting out). */
  resume(): void;
  /** Applied with the next H.VIEW (room.settings) plus a local N-SETTINGS (implemented in 3-1, MA-R1-07). */
  setOption(opt: { liveEquity?: boolean; botChatter?: boolean }): void;
}

export interface ArenaTableClient extends TableClient {
  pause(): void;
  resume(): void;
}

export interface HostTableClient extends TableClient {
  start(): Promise<Ack>;
  pause(): void;
  resume(): void;
  close(mode: 'after_hand' | 'now'): void;
  lock(on: boolean): void;
  kick(seat: SeatIndex): void;
  setBlinds(sb: number, bb: number): void;
  setOption(opt: { liveEquity?: boolean; botChatter?: boolean }): void;
  addBot(seat: SeatIndex | null, spec: BotSpec): Promise<Ack>;
  updateBot(seat: SeatIndex, spec: BotSpec): Promise<Ack>;
  removeBot(seat: SeatIndex): Promise<Ack>;
  invite(): InviteInfo;
}

/**
 * The slice of the lead's config module that session uses. app/composition.ts can pass the module namespace
 * itself (`import * as config from '@/config'`); tests pass a literal with DV shortcuts and a debugLog spy.
 */
export type AppConfig = Pick<typeof ConfigModule, 'defaults' | 'APP_VERSION' | 'debugLog' | 'getE2EHooks'>;

export interface SessionDeps {
  /** Optional (M3A-12). Without it, llm BotSpecs are decided by the rule bot (D-P11). */
  botDecider?: BotDecider;
  hands: HandStore;
  device: DeviceStore;
  config: AppConfig;
}

export interface PracticeOptions {
  settings: RoomSettings;
  /** 1..5 bots; seatCount becomes bots.length + 1 whatever settings.seatCount says (M3A-15). */
  bots: BotSpec[];
  profile: LocalProfile;
  deps: SessionDeps;
}
