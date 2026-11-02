// Bot I/O contract (bot.io.v1) and the analysis output type (api.analysis.v1 DecisionMetrics).
//
// This file is the single home of BotInput, BotDecision, DecisionMetrics and the BotDecider port types
// (A-AI-BOT types_home, AF-34): the host index re-exports them and session imports them from there, so there is
// no second declaration to drift. Field names and nullability follow the contract one to one; engine types
// (PlayerView, LegalActions, ...) come from @checky/engine/protocol (Phillip, I-02).
import type {
  ActionLogEntry,
  BotStyle,
  EngineActionType,
  EquityMethod,
  ErrorCode,
  HandView,
  Lang,
  LegalActions,
  NoticeCode,
  Occupant,
  OccupantInHand,
  PlayerView,
  PlayerViewMe,
  ProviderId,
  SeatIndex,
  Street,
} from '@checky/engine/protocol';

/** api.analysis.v1 DecisionMetrics. Every screen, bot, review and coach number comes from one computeMetrics. */
export interface DecisionMetrics {
  equity: {
    /** 0..1, ties split 1/k. */
    value: number;
    method: EquityMethod;
    /** Monte Carlo sample count; null when exact. */
    samples: number | null;
    /** 95% half-width 1.96*sqrt(p(1-p)/n); null when exact. */
    halfWidth95: number | null;
    /** Opponents not folded (all-in included); the N of "vs N random hands". */
    opponents: number;
  };
  /** P : C — pot before my call (this street's bets included) : chips to call. null when there is nothing to call. */
  potOdds: null | { pot: number; call: number };
  /** C / (P + C); null with potOdds. */
  requiredEquity: number | null;
  effectiveStack: number;
  /** Flop-start effective stack / flop-start pot; null preflop. */
  spr: number | null;
  /** inPosition is null preflop. */
  position: { label: string; inPosition: boolean | null };
  /** Only at call/fold points (legal.call present). */
  verdict: null | 'call_ok' | 'call_short';
  basis: 'vs_random_hands';
}

export type MetricsPrecision = 'display' | 'bot';

/**
 * The part of a PlayerView that computeMetrics reads. A PlayerView is assignable to it, so callers pass a view
 * unchanged; the metrics Worker can build one from a structured-clone message without branding (`as PlayerView`
 * is banned outside projection, D-L10).
 */
export interface MetricsView {
  readonly me: Pick<PlayerViewMe, 'seat' | 'holeCards'> & { readonly legal: Pick<LegalActions, 'call'> | null };
  readonly seats: readonly {
    readonly seat: SeatIndex;
    readonly occupant: null | (Pick<Occupant, 'isMe' | 'stack'> & {
      readonly inHand: Pick<OccupantInHand, 'bet' | 'folded' | 'position'> | null;
    });
  }[];
  readonly hand: null | (Pick<HandView, 'street' | 'board' | 'buttonSeat' | 'startStacks'> & {
    readonly actions: readonly Pick<ActionLogEntry, 'street' | 'seat' | 'type' | 'added'>[];
  });
}

/** bot.io.v1 BotInput — built by the host Worker from projectView(table, {kind: 'bot', seat}) only (D7, SC9). */
export interface BotInput {
  v: 1;
  seat: SeatIndex;
  view: PlayerView;
  legal: LegalActions;
  /** precision 'bot'. */
  metrics: DecisionMetrics;
  style: BotStyle;
  lang: Lang;
  name: string;
  model: null | { provider: ProviderId; model: string };
  /** At most 10 lines (DV14). */
  chatTail: { from: string; kind: 'human' | 'bot'; text: string }[];
  /** This hand's own decisions only. */
  myPriorThoughts: { street: Street; action: EngineActionType; amount: number; thought: string }[];
}

/** bot.io.v1 BotDecision. `amount` is a street total ("to"); fold, check and call may leave it null. */
export interface BotDecision {
  action: EngineActionType;
  amount: number | null;
  /** <= 200 chars: LLM thought or the rule bot's computed-number sentence. */
  reason: string;
  /** 0..1 */
  confidence: number;
  /** <= 120 chars or null. */
  chat: string | null;
  source: 'rule' | 'llm' | 'fallback';
  fallbackCode: ErrorCode | null;
  usage: null | { inputTokens: number | null; outputTokens: number | null };
}

/** A-AI-USAGE. */
export interface Usage {
  calls: number;
  cap: number;
  inputTokens: number | null;
  outputTokens: number | null;
  byProvider: Record<ProviderId, number>;
}

export type DeciderEvent =
  | { t: 'usage'; usage: Usage }
  | { t: 'notice'; code: Extract<NoticeCode, 'N-LLM-CAP'>; p: { cap: number } }
  | { t: 'notice'; code: Extract<NoticeCode, 'N-LLM-KEY'>; p: { provider: ProviderId; seat: SeatIndex } };

/** Structural AbortSignal so packages without the DOM lib can name it. A real AbortSignal satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
}

/** A-AI-BOT BotDecider port (LLM decider in ai, mock decider in ai/testing). */
export interface BotDecider {
  decide(input: BotInput, signal: AbortSignalLike): Promise<BotDecision>;
  usage(): Usage;
  subscribe(cb: (e: DeciderEvent) => void): () => void;
  setCap(n: number): void;
}
