// AC-3 (SS14-AC1, US19 AC1, MS-R0-2): 10,000 hands of six rule bots (styles mixed) on the real engine, bot
// precision metrics, fixed seed: every decision must be legal as given (no nearestLegal correction).
// Runtime ~3-4 min on an M3 Pro (about 80,000 decisions x ~2.5 ms of bot-precision metrics); see ml.md.
// `allin=` counts the bot's own all-ins (short stacks in unopened pots, lead review R0 3.2 M1), so the run shows
// the engine taking that path too, not only bets, raises and calls.
import { describe, expect, it } from 'vitest';
import { log, nowMs } from '../helpers/io';
import { simulate } from './driver';

const SEED = 'ms-r0-2';

describe('rule bots: 10,000 hands, zero illegal actions', () => {
  it('every decision is inside the LegalActions it was given and the engine accepts it', () => {
    const t0 = nowMs();
    let allins = 0;
    const r = simulate({
      seed: SEED,
      hands: 10_000,
      styles: ['aggressive', 'balanced', 'tight', 'aggressive', 'balanced', 'tight'],
      onDecision: (d) => {
        if (d.decision.action === 'allin') allins += 1;
      },
    });
    const s = ((nowMs() - t0) / 1000).toFixed(1);
    log(`hands=${r.hands} illegal=${r.failures.length} seed=${SEED} decisions=${r.decisions} allin=${allins} seconds=${s}`);
    for (const f of r.failures.slice(0, 5)) log(`illegal: seed=${SEED} hand=${f.hand} seat=${f.seat} ${f.reason} ${JSON.stringify(f.decision)} legal=${JSON.stringify(f.legal)}`);
    expect(r.hands).toBe(10_000);
    expect(r.decisions).toBeGreaterThan(10_000);
    expect(r.failures).toEqual([]);
    expect(allins).toBeGreaterThan(0);
  }, 900_000);
});
