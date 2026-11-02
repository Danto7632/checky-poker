// AC-4 R11 property test: 10,000 seeded hands of random LEGAL play (2..6 seats, random stacks incl. short and
// busted seats, random button, occasional forced folds). After every transition "stacks + chips in the pot"
// equals the start total; at the end sum(endStacks) = sum(startStacks).
// "Advertised => accepted" (R0 M2): before every voluntary action, every action legalActions advertises
// (fold, check, call, bet/raise at both ends, allIn.to) must pass applyAction — the UI and the bots build their
// choices from that object alone (B-E4).
import { describe, expect, it } from 'vitest';
import { applyAction, forceFold } from '../../src/hand/apply';
import { createHand } from '../../src/hand/create';
import { legalActions } from '../../src/hand/legal';
import { advanceRunout } from '../../src/hand/runout';
import type { HandState } from '../../src/hand/state';
import type { EngineAction } from '../../src/protocol/view-types';
import { createSeededRng, randomInt, type Rng } from '../../src/util/rng';

// Before settlement the chips are behind (stack) or in the pot (committed); after it they are all in stacks
// (committed stays as the public "what this seat put in" figure).
const total = (s: HandState): number =>
  s.seats.reduce((a, p) => a + p.stack + (s.street === 'COMPLETE' ? 0 : p.committed), 0);
const startTotal = (s: HandState): number => s.startStacks.reduce((a, x) => a + x.stack, 0);

function randomAction(s: HandState, rng: Rng): EngineAction {
  const seat = s.toAct!;
  const l = legalActions(s, seat)!;
  const options: EngineAction[] = [{ seat, type: 'fold' }];
  if (l.check) options.push({ seat, type: 'check' }, { seat, type: 'check' });
  if (l.call) options.push({ seat, type: 'call' }, { seat, type: 'call' });
  if (l.bet) options.push({ seat, type: 'bet', to: l.bet.min + randomInt(rng, l.bet.max - l.bet.min + 1) });
  if (l.raise) options.push({ seat, type: 'raise', to: l.raise.minTo + randomInt(rng, l.raise.maxTo - l.raise.minTo + 1) });
  options.push({ seat, type: 'allin', to: l.allIn.to });
  return options[randomInt(rng, options.length)]!;
}

/** Every boundary action legalActions advertises for the seat to act. */
function advertised(s: HandState): EngineAction[] {
  const seat = s.toAct!;
  const l = legalActions(s, seat)!;
  const out: EngineAction[] = [{ seat, type: 'fold' }, { seat, type: 'allin', to: l.allIn.to }];
  if (l.check) out.push({ seat, type: 'check' });
  if (l.call) out.push({ seat, type: 'call' });
  if (l.bet) out.push({ seat, type: 'bet', to: l.bet.min }, { seat, type: 'bet', to: l.bet.max });
  if (l.raise) out.push({ seat, type: 'raise', to: l.raise.minTo }, { seat, type: 'raise', to: l.raise.maxTo });
  return out;
}

describe('R11 chip conservation (property, seeded)', () => {
  it('10,000 random hands conserve chips at every step', () => {
    const rng = createSeededRng('r11-property');
    const stats = { runouts: 0, sidePots: 0, showdowns: 0, returns: 0, forced: 0, rejectedLegal: 0, advertised: 0, closedShortOfStack: 0, zeroWinner: 0 };
    const rejectedAdvertised: string[] = [];
    for (let h = 0; h < 10000; h += 1) {
      const n = 2 + randomInt(rng, 5);
      const pool = [0, 1, 2, 3, 4, 5];
      const chosen = Array.from({ length: n }, () => pool.splice(randomInt(rng, pool.length), 1)[0]!);
      const stacks = chosen.map((seat) => ({ seat, stack: randomInt(rng, 10) === 0 ? 0 : 1 + randomInt(rng, 3000) }));
      const live = stacks.filter((x) => x.stack > 0);
      if (live.length < 2) continue;
      const button = live[randomInt(rng, live.length)]!.seat;
      let s = createHand({ handId: `h${h}`, seats: stacks, buttonSeat: button, sb: 10, bb: 20 }, rng);
      const start = startTotal(s);
      expect(total(s)).toBe(start);
      // R0 M4, deterministic: every 20th hand, every seat but the first actor leaves before anyone acts. With 3+
      // seats the winner put in 0 — the case whose pot used to vanish.
      if (h % 20 === 0 && s.toAct !== null) {
        const first = s.toAct;
        for (const p of [...s.seats]) if (p.seat !== first) s = forceFold(s, p.seat, 'leave').state;
        expect(total(s)).toBe(start);
        if (s.result !== null && s.result.pots.every((p) => p.winners[0] === first) && s.startStacks.length > 2) {
          const winner = s.seats.find((p) => p.seat === first)!;
          if (winner.committed === 0) stats.zeroWinner += 1;
        }
      }
      for (let step = 0; step < 300 && s.street !== 'COMPLETE'; step += 1) {
        if (s.street === 'RUNOUT') {
          stats.runouts += s.board.length === 0 ? 1 : 0;
          s = advanceRunout(s).state;
        } else if (randomInt(rng, 40) === 0) {
          const victim = s.seats[randomInt(rng, s.seats.length)]!.seat;
          stats.forced += 1;
          s = forceFold(s, victim, 'leave').state;
        } else {
          const l = legalActions(s, s.toAct!)!;
          const me = s.seats.find((p) => p.seat === s.toAct)!;
          if (!l.reopened && l.allIn.to < me.bet + me.stack) stats.closedShortOfStack += 1;
          for (const a of advertised(s)) {
            stats.advertised += 1;
            try {
              applyAction(s, a);
            } catch (e) {
              if (rejectedAdvertised.length < 5) rejectedAdvertised.push(`${JSON.stringify(a)} ${String(e)} ${JSON.stringify(l)}`);
            }
          }
          const action = randomAction(s, rng);
          try {
            s = applyAction(s, action).state;
          } catch (e) {
            stats.rejectedLegal += 1;
            throw e;
          }
        }
        expect(total(s)).toBe(start);
      }
      expect(s.street).toBe('COMPLETE');
      const end = s.result!.endStacks.reduce((a, x) => a + x.stack, 0);
      expect(end).toBe(start);
      expect(s.result!.endStacks.every((x) => x.stack >= 0)).toBe(true);
      if (s.result!.pots.length > 1) stats.sidePots += 1;
      if (s.result!.showdown.length > 0) stats.showdowns += 1;
      if (s.returned.length > 0) stats.returns += 1;
    }
    // The sample must actually exercise the interesting paths.
    expect(stats.runouts).toBeGreaterThan(100);
    expect(stats.sidePots).toBeGreaterThan(100);
    expect(stats.showdowns).toBeGreaterThan(500);
    expect(stats.returns).toBeGreaterThan(100);
    expect(stats.forced).toBeGreaterThan(100);
    expect(stats.rejectedLegal).toBe(0);
    expect(rejectedAdvertised).toEqual([]);
    expect(stats.advertised).toBeGreaterThan(100_000);
    // The M2 path (raising closed while chips remain behind) and the M4 path must actually occur in the sample.
    expect(stats.closedShortOfStack).toBeGreaterThan(100);
    expect(stats.zeroWinner).toBeGreaterThan(100);
  });
});
