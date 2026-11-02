// Bot input assembly and rule-bot decisions inside the Worker (bot.io.v1, SS14, AC-14).
//
// A BotInput is built ONLY from projectView(table, {kind: 'bot', seat}) — the bot's own seat view — and passes
// verifyView like every other exit, so no other seat's private card can reach a bot (D7, SC9). Rule bots are
// decided right here, in the Worker (no W.BOT_REQ to the main thread). In R0 every bot, including engine 'llm'
// specs, is decided by the rule bot (D-P11: no decider in R0); 3-1 adds the W.BOT_REQ bridge for LLM bots.
// `memory` is the bot's own decisions this hand (myPriorThoughts); the shell keeps it sealed with the hand.
import { computeMetrics, decideRuleBot, type BotDecision, type BotInput } from '@checky/analysis';
import { verifyView } from '@checky/engine/projection';
import type { EngineActionType, PlayerView, Street } from '@checky/engine/protocol';
import type { TableState, Viewer } from '@checky/engine/table';
import type { Rng } from '@checky/engine/util';

/** The projection function. Injectable only so the T-003 mutation test can prove verifyView guards every exit. */
export type Project = (table: TableState, viewer: Viewer) => PlayerView;

export type BotThought = { street: Street; action: EngineActionType; amount: number; thought: string };
export type BotMemory = Record<number, BotThought[]>;

export interface BotBrain {
  decideRuleBot: (input: BotInput, rng: Rng) => BotDecision;
  computeMetrics: typeof computeMetrics;
}

export const defaultBrain: BotBrain = { decideRuleBot, computeMetrics };

export function buildBotInput(table: TableState, seat: number, memory: BotMemory, project: Project, brain: BotBrain, rng: Rng): BotInput {
  const viewer: Viewer = { kind: 'bot', seat };
  const view = project(table, viewer);
  verifyView(view, table, viewer);
  const legal = view.me.legal;
  const spec = table.seats[seat]?.bot;
  if (legal === null || spec === null || spec === undefined) throw new RangeError('buildBotInput: not a bot on turn');
  return {
    v: 1,
    seat,
    view,
    legal,
    metrics: brain.computeMetrics(view, { precision: 'bot', rng }),
    style: spec.style,
    lang: table.config.lang,
    name: spec.label,
    model: spec.engine === 'llm' && spec.provider !== null && spec.model !== null ? { provider: spec.provider, model: spec.model } : null,
    // Chat reaches bots with table/chat in 2-1 (DV14 tail of 10).
    chatTail: [],
    myPriorThoughts: (memory[seat] ?? []).map((x) => ({ ...x })),
  };
}

/** Decide in the Worker with the rule bot. A rule-bot failure is answered with the table's safe default. */
export function decideInWorker(input: BotInput, brain: BotBrain, rng: Rng): BotDecision | null {
  try {
    return { ...brain.decideRuleBot(input, rng), source: 'rule' };
  } catch {
    // The reducer plays check/fold for a null decision; the shell reports E-ACT-ILLEGAL via W.ERROR.
    return null;
  }
}
