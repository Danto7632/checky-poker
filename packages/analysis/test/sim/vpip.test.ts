// AC-4 (SS14-AC2, US19 AC2): VPIP aggressive > balanced > tight.
// One 6-seat table, two seats per style, 1,000 hands with the button rotating, so every style plays the same
// opponents and positions and is measured over 2,000 dealt hands (>= 1,000 per style). VPIP = share of dealt
// hands with a voluntary preflop call / bet / raise / all-in (blinds and checks do not count).
import type { BotStyle } from '@checky/engine/protocol';
import { describe, expect, it } from 'vitest';
import { log } from '../helpers/io';
import { simulate } from './driver';

const SEED = 'vpip';
const STYLES: BotStyle[] = ['aggressive', 'balanced', 'tight', 'aggressive', 'balanced', 'tight'];

describe('rule bot VPIP order', () => {
  it('aggressive > balanced > tight over 1,000 hands', () => {
    const r = simulate({ seed: SEED, hands: 1000, styles: STYLES });
    const by = (style: BotStyle): { vpip: number; dealt: number } => {
      let v = 0;
      let d = 0;
      STYLES.forEach((s, seat) => {
        if (s !== style) return;
        v += r.vpip[seat]!;
        d += r.dealt[seat]!;
      });
      return { vpip: v / d, dealt: d };
    };
    const a = by('aggressive');
    const b = by('balanced');
    const t = by('tight');
    log(
      `vpip aggressive=${a.vpip.toFixed(3)} balanced=${b.vpip.toFixed(3)} tight=${t.vpip.toFixed(3)} dealt=${a.dealt}/${b.dealt}/${t.dealt} seed=${SEED} illegal=${r.failures.length}`,
    );
    expect(r.failures).toEqual([]);
    expect(Math.min(a.dealt, b.dealt, t.dealt)).toBeGreaterThanOrEqual(1000);
    expect(a.vpip).toBeGreaterThan(b.vpip);
    expect(b.vpip).toBeGreaterThan(t.vpip);
  }, 300_000);
});
