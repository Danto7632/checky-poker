// AC-5 (US19 AC4, SS14 rule 4): the same BotInput with the same seeded Rng gives a deep-equal decision.
// The global-random ban (Math.random = 0) is the lint rule `no-restricted-properties` over packages/*/src.
import { createSeededRng } from '@checky/engine/util';
import { describe, expect, it } from 'vitest';
import { decideRuleBot } from '../src/bot/rule-bot';
import { randomInput } from './helpers/random-input';

describe('rule bot determinism', () => {
  it('1,000 random inputs: same input + same seed -> same decision', () => {
    const gen = createSeededRng('determinism/inputs');
    let differsAcrossSeeds = 0;
    for (let i = 0; i < 1000; i += 1) {
      const input = randomInput(gen);
      const frozen: unknown = JSON.parse(JSON.stringify(input));
      const a = decideRuleBot(input, createSeededRng(`det/${i}`));
      const b = decideRuleBot(input, createSeededRng(`det/${i}`));
      expect(b).toEqual(a);
      expect(input).toEqual(frozen); // the bot does not mutate its input
      if (JSON.stringify(decideRuleBot(input, createSeededRng(`other/${i}`))) !== JSON.stringify(a)) differsAcrossSeeds += 1;
    }
    // Sanity: the Rng really feeds the decision (bluffs, sizes), so other seeds change some of them.
    expect(differsAcrossSeeds).toBeGreaterThan(0);
  });
});
