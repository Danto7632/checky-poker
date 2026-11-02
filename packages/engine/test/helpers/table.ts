// Table test harness: a fake clock, a seeded rng, and a timer queue that plays the role of the shell.
// `bots: 'auto'` answers every BOT_REQUEST with a passive decision (check, else call, else fold) so hands
// progress without analysis; tests may also answer bot requests themselves.
import type { TableConfig } from '../../src/protocol/messages';
import type { HostCommand } from '../../src/protocol/messages';
import type { BotSpec, RoomKind, RoomSettings } from '../../src/protocol/view-types';
import { legalActions } from '../../src/hand/legal';
import { createTable, reduceTable } from '../../src/table/reduce';
import type { Effect, Reduced, TableBotDecision, TableInput, TableState } from '../../src/table/state';
import { createSeededRng, type Rng } from '../../src/util/rng';

export function settings(over: Partial<RoomSettings> = {}): RoomSettings {
  return { seatCount: 6, sb: 50, bb: 100, startStack: 10000, turnSeconds: 60, liveEquity: true, botChatter: true, ...over };
}

/** Contract default literals (DV values) — the engine never reads config itself. */
export function tableConfig(kind: RoomKind, over: Partial<RoomSettings> = {}): TableConfig {
  return {
    kind,
    transport: kind === 'friend' ? 'p2p' : 'none',
    settings: settings(over),
    lang: 'en',
    nextHandDelayMs: 5000,
    nextHandDelayWithRevealMs: 8000,
    maxTimeoutStrikes: 3,
    hostReconnectWaitMs: 30000,
    botThinkMs: [800, 1500],
    llmDecisionTimeoutMs: 10000,
    chatMaxLen: 200,
    chatPerSec: 1,
    botChatMaxLen: 120,
    thoughtMaxLen: 200,
    botChatTail: 10,
  };
}

export const HOST = { rpk: 'rpkHostDeviceKey000000', nick: 'Mina', avatarSeed: 7, lang: 'en' as const };

/**
 * A performance.now()-like clock (the production shell clock, R0-L14): small, fractional, strictly increasing on
 * every read — a real performance.now() never goes back, so `deadline - now` never exceeds the timer length. Tied
 * to Date.now(), so vitest fake timers move it.
 */
export function fractionalClock(): { nowMs(): number } {
  const t0 = Date.now();
  let last = -1;
  return { nowMs: () => (last = Math.max(last + 0.0137, Date.now() - t0 + 0.25)) };
}
export const ruleBot = (label: string): BotSpec => ({ engine: 'rule', style: 'balanced', provider: null, model: null, label });

export class Harness {
  table: TableState;
  now = 1_000_000;
  readonly rng: Rng;
  readonly log: Effect[][] = [];
  readonly timers = new Map<string, number>();
  bots: 'auto' | 'manual' = 'auto';
  last: Reduced | null = null;

  constructor(cfg: TableConfig, seed = 'table') {
    this.rng = createSeededRng(seed);
    this.table = createTable(cfg, HOST);
  }

  private ctx() {
    return { rng: this.rng, clock: { nowMs: () => this.now } };
  }

  input(i: TableInput): Reduced {
    const r = reduceTable(this.table, i, this.ctx());
    this.table = r.table;
    this.log.push(r.effects);
    for (const e of r.effects) {
      if (e.t === 'TIMER_START') this.timers.set(e.id, this.now + e.ms);
      if (e.t === 'TIMER_CANCEL') this.timers.delete(e.id);
    }
    if (this.bots === 'auto') {
      for (const e of r.effects) if (e.t === 'BOT_REQUEST') this.answerBot(e.reqId);
    }
    // `last` is the outer input even when auto-answered bot decisions ran inside it.
    this.last = r;
    return r;
  }

  answerBot(reqId: string, decision?: TableBotDecision | null): Reduced {
    const hand = this.table.hand!;
    const legal = legalActions(hand, hand.toAct!);
    const passive: TableBotDecision = legal?.check ? { action: 'check', amount: null } : legal?.call ? { action: 'call', amount: null } : { action: 'fold', amount: null };
    return this.input({ t: 'BOT_DECISION', reqId, decision: decision === undefined ? passive : decision, code: null });
  }

  cmd(cmd: HostCommand, c?: number): Reduced {
    return this.input(c === undefined ? { t: 'HOST_CMD', cmd } : { t: 'HOST_CMD', cmd, c });
  }

  /** Fire every timer due within `ms`, in deadline order, advancing the clock. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers.entries()].sort((a, b) => a[1] - b[1])[0];
      if (next === undefined || next[1] > end) break;
      this.timers.delete(next[0]);
      this.now = Math.max(this.now, next[1]);
      this.input({ t: 'TIMER', id: next[0] });
    }
    this.now = end;
  }

  effects(): Effect[] {
    return this.last?.effects ?? [];
  }

  notices(): string[] {
    return this.effects().flatMap((e) => (e.t === 'SEND' && e.env.t === 'H.NOTICE' ? [e.env.b.code] : []));
  }

  errors(): string[] {
    return this.effects().flatMap((e) => (e.t === 'ERROR' ? [e.code] : []));
  }

  /** Leave a pause as a player would: refill first when busted (practice refuses to resume a busted seat). */
  resume(): Reduced {
    if (this.table.seats[0]?.stack === 0) this.cmd({ t: 'REFILL' });
    return this.cmd({ t: 'RESUME' });
  }

  /** Human (seat 0) acts with the current handId/turnSeq. */
  act(type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin', to?: number, c?: number): Reduced {
    const hand = this.table.hand!;
    const action = to === undefined ? { seat: 0, type } : { seat: 0, type, to };
    return this.cmd({ t: 'ACT', handId: hand.handId, turnSeq: hand.turnSeq, action }, c);
  }

  /** Play the human passively whenever it is its turn, firing timers, until `pred` holds or the budget ends. */
  playUntil(pred: (t: TableState) => boolean, budgetMs = 600_000): void {
    const end = this.now + budgetMs;
    while (!pred(this.table) && this.now < end) {
      const hand = this.table.hand;
      if (hand !== null && hand.toAct === 0 && (this.table.phase === 'IN_HAND' || this.table.phase === 'CLOSING_AFTER_HAND')) {
        const legal = legalActions(hand, 0)!;
        this.act(legal.check ? 'check' : 'call');
        continue;
      }
      const next = [...this.timers.values()].sort((a, b) => a - b)[0];
      if (next === undefined) break;
      this.advance(next - this.now);
    }
  }
}

export function practice(bots = 5, over: Partial<RoomSettings> = {}, seed = 'practice'): Harness {
  const h = new Harness(tableConfig('practice', { seatCount: bots + 1, ...over }), seed);
  for (let i = 0; i < bots; i += 1) h.cmd({ t: 'ADD_BOT', seat: null, bot: ruleBot(`Bot${i + 1}`) });
  return h;
}
