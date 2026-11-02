// AC-8 (SS20 definitions): 31 fixed spots -> potOdds, requiredEquity, effectiveStack, spr, position, verdict,
// basis, opponents. Expected numbers are worked out by hand in the comments (blinds 50/100, 10,000 stacks unless
// stated); verdicts are only asserted where equity is far from the required equity, so the Monte Carlo error
// cannot flip them.
import type { Street } from '@checky/engine/protocol';
import { createSeededRng } from '@checky/engine/util';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/metrics';
import { buildSpot, type SpotAction, type SpotSpec } from './helpers/spot';

const S10K = { 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 10000, 5: 10000 };
const S3 = { 0: 10000, 1: 10000, 2: 10000 };
const HU = { 0: 10000, 1: 10000 };
const checks = (street: Street, seats: number[]): SpotAction[] =>
  seats.map((seat, i): SpotAction => (i === 0 ? { seat, type: 'check', street } : { seat, type: 'check' }));

interface Row {
  name: string;
  spec: SpotSpec;
  potOdds: { pot: number; call: number } | null;
  required: number | null;
  effective: number;
  spr: number | null;
  position: { label: string; inPosition: boolean | null };
  verdict: 'call_ok' | 'call_short' | null;
  opponents: number;
}

const ROWS: Row[] = [
  // 1. HU preflop, BTN/SB first in: pot 50+100, call 50 -> 50/200.
  { name: 'pf HU SB vs BB', spec: { button: 0, me: 0, hole: ['As', 'Ah'], stacks: HU }, potOdds: { pot: 150, call: 50 }, required: 0.25, effective: 10000, spr: null, position: { label: 'BTN/SB', inPosition: null }, verdict: 'call_ok', opponents: 1 },
  // 2. HU BB option after the SB limps: nothing to call.
  { name: 'pf HU BB option', spec: { button: 0, me: 1, hole: ['7c', '2d'], stacks: HU, actions: [{ seat: 0, type: 'call' }] }, potOdds: null, required: null, effective: 10000, spr: null, position: { label: 'BB', inPosition: null }, verdict: null, opponents: 1 },
  // 3. 6-max: UTG 300, two folds, BTN faces 300 into 450 -> 300/750. SB, BB, UTG still in.
  { name: 'pf BTN vs UTG open', spec: { button: 0, me: 0, hole: ['7c', '2d'], stacks: S10K, actions: [{ seat: 3, type: 'raise', to: 300 }, { seat: 4, type: 'fold' }, { seat: 5, type: 'fold' }] }, potOdds: { pot: 450, call: 300 }, required: 0.4, effective: 10000, spr: null, position: { label: 'BTN', inPosition: null }, verdict: 'call_short', opponents: 3 },
  // 4. Short blinds: SB 2000, BB 5000 -> effective min(10000, 5000).
  { name: 'pf short blinds', spec: { button: 0, me: 0, hole: ['Kd', 'Kc'], stacks: { 0: 10000, 1: 2000, 2: 5000, 3: 8000, 4: 10000, 5: 10000 }, actions: [{ seat: 3, type: 'fold' }, { seat: 4, type: 'fold' }, { seat: 5, type: 'fold' }] }, potOdds: { pot: 150, call: 100 }, required: 0.4, effective: 5000, spr: null, position: { label: 'BTN', inPosition: null }, verdict: 'call_ok', opponents: 2 },
  // 5. HU BB vs SB all-in 3000: pot 50+100+2950 = 3100, call 2900 -> 2900/6000; effective 3000.
  { name: 'pf BB vs all-in', spec: { button: 0, me: 1, hole: ['5s', '5d'], stacks: { 0: 3000, 1: 10000 }, actions: [{ seat: 0, type: 'allin' }] }, potOdds: { pot: 3100, call: 2900 }, required: 2900 / 6000, effective: 3000, spr: null, position: { label: 'BB', inPosition: null }, verdict: 'call_ok', opponents: 1 },
  // 6. 3-handed: BTN 250, SB faces 200 into 400 -> 1/3.
  { name: 'pf SB vs BTN 3-way', spec: { button: 0, me: 1, hole: ['Ah', 'Kd'], stacks: S3, actions: [{ seat: 0, type: 'raise', to: 250 }] }, potOdds: { pot: 400, call: 200 }, required: 1 / 3, effective: 10000, spr: null, position: { label: 'SB', inPosition: null }, verdict: 'call_ok', opponents: 2 },
  // 7. HU flop, BB acts first (OOP): flop-start 9900 each, pot 200 -> SPR 49.5.
  { name: 'fl HU OOP check', spec: { button: 0, me: 1, hole: ['8h', '8d'], stacks: HU, board: ['Kc', '7h', '2s'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }] }, potOdds: null, required: null, effective: 9900, spr: 49.5, position: { label: 'BB', inPosition: false }, verdict: null, opponents: 1 },
  // 8. HU flop, BTN faces 100 into 300.
  { name: 'fl HU IP vs bet', spec: { button: 0, me: 0, hole: ['As', 'Ah'], stacks: HU, board: ['Kc', '7h', '2s'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, { seat: 1, type: 'bet', to: 100, street: 'FLOP' }] }, potOdds: { pot: 300, call: 100 }, required: 0.25, effective: 9900, spr: 49.5, position: { label: 'BTN/SB', inPosition: true }, verdict: 'call_ok', opponents: 1 },
  // 9. 6-max flop: UTG 300, BTN call, BB call -> pot 50+100+300+300+200 = 950, SPR 9700/950; UTG acts before BTN.
  { name: 'fl UTG checked to', spec: { button: 0, me: 3, hole: ['Ah', 'Qd'], stacks: S10K, board: ['Ad', 'Ts', '5c'], actions: [{ seat: 3, type: 'raise', to: 300 }, { seat: 4, type: 'fold' }, { seat: 5, type: 'fold' }, { seat: 0, type: 'call' }, { seat: 1, type: 'fold' }, { seat: 2, type: 'call' }, { seat: 2, type: 'check', street: 'FLOP' }] }, potOdds: null, required: null, effective: 9700, spr: 9700 / 950, position: { label: 'UTG', inPosition: false }, verdict: null, opponents: 2 },
  // 10. Same pot, BB check, UTG bets 500, BTN faces 500 into 1450 -> 500/1950.
  { name: 'fl BTN vs UTG bet', spec: { button: 0, me: 0, hole: ['7c', '2d'], stacks: S10K, board: ['Ks', 'Qh', '9c'], actions: [{ seat: 3, type: 'raise', to: 300 }, { seat: 4, type: 'fold' }, { seat: 5, type: 'fold' }, { seat: 0, type: 'call' }, { seat: 1, type: 'fold' }, { seat: 2, type: 'call' }, { seat: 2, type: 'check', street: 'FLOP' }, { seat: 3, type: 'bet', to: 500 }] }, potOdds: { pot: 1450, call: 500 }, required: 500 / 1950, effective: 9700, spr: 9700 / 950, position: { label: 'BTN', inPosition: true }, verdict: 'call_short', opponents: 2 },
  // 11. HU turn: 300 each preflop, 400 each flop (pot 1400), BTN bets 1000 -> 1000/3400; turn-start 9300; SPR 9700/600.
  { name: 'tu HU OOP vs bet', spec: { button: 0, me: 1, hole: ['Ah', 'Qd'], stacks: HU, board: ['Ad', 'Ts', '5c', '8h'], actions: [{ seat: 0, type: 'raise', to: 300 }, { seat: 1, type: 'call' }, { seat: 1, type: 'check', street: 'FLOP' }, { seat: 0, type: 'bet', to: 400 }, { seat: 1, type: 'call' }, { seat: 1, type: 'check', street: 'TURN' }, { seat: 0, type: 'bet', to: 1000 }] }, potOdds: { pot: 2400, call: 1000 }, required: 1000 / 3400, effective: 9300, spr: 9700 / 600, position: { label: 'BB', inPosition: false }, verdict: 'call_ok', opponents: 1 },
  // 12. HU turn checked to the BTN: pot 200.
  { name: 'tu HU IP checked to', spec: { button: 0, me: 0, hole: ['Kh', 'Qh'], stacks: HU, board: ['Jh', 'Th', '2s', '3c'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, ...checks('FLOP', [1, 0]), ...checks('TURN', [1])] }, potOdds: null, required: null, effective: 9900, spr: 49.5, position: { label: 'BTN/SB', inPosition: true }, verdict: null, opponents: 1 },
  // 13. HU river, BB (4000) shoves 3700 into 600 -> 3700/8000; effective 3700; SPR 3900/200; the BTN acts last: IP.
  { name: 'rv HU vs all-in', spec: { button: 0, me: 0, hole: ['Jc', 'Tc'], stacks: { 0: 10000, 1: 4000 }, board: ['9c', '8d', '2h', '3s', 'Qd'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, { seat: 1, type: 'check', street: 'FLOP' }, { seat: 0, type: 'bet', to: 200 }, { seat: 1, type: 'call' }, ...checks('TURN', [1, 0]), { seat: 1, type: 'allin', street: 'RIVER' }] }, potOdds: { pot: 4300, call: 3700 }, required: 3700 / 8000, effective: 3700, spr: 19.5, position: { label: 'BTN/SB', inPosition: true }, verdict: 'call_ok', opponents: 1 },
  // 14. 3-handed limped pot checked to the river, BB acts after SB but before BTN.
  { name: 'rv 3-way BB check', spec: { button: 0, me: 2, hole: ['7h', '6h'], stacks: S3, board: ['Ah', '9h', '2c', '3h', 'Kd'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'call' }, { seat: 2, type: 'check' }, ...checks('FLOP', [1, 2, 0]), ...checks('TURN', [1, 2, 0]), ...checks('RIVER', [1])] }, potOdds: null, required: null, effective: 9900, spr: 33, position: { label: 'BB', inPosition: false }, verdict: null, opponents: 2 },
  // 15. Four of six seats dealt (1, 4 empty), button 2: seat 0 is UTG and first to act.
  { name: 'pf UTG empty seats', spec: { button: 2, me: 0, hole: ['As', 'Ks'], stacks: { 0: 10000, 2: 10000, 3: 10000, 5: 10000 } }, potOdds: { pot: 150, call: 100 }, required: 0.4, effective: 10000, spr: null, position: { label: 'UTG', inPosition: null }, verdict: 'call_ok', opponents: 3 },
  // 16. Same table to the flop: 300 x 3 = 900; flop order from the button (2): 3, 5, 0 -> UTG acts last.
  { name: 'fl UTG last empty seats', spec: { button: 2, me: 0, hole: ['As', 'Ks'], stacks: { 0: 10000, 2: 10000, 3: 10000, 5: 10000 }, board: ['Qs', '7s', '2d'], actions: [{ seat: 0, type: 'raise', to: 300 }, { seat: 2, type: 'fold' }, { seat: 3, type: 'call' }, { seat: 5, type: 'call' }, ...checks('FLOP', [3, 5])] }, potOdds: null, required: null, effective: 9700, spr: 9700 / 900, position: { label: 'UTG', inPosition: true }, verdict: null, opponents: 2 },
  // 17. SB (1500) all-in preflop, 1500 x 3 = 4500; BB bets 2000 -> 2000/8500; SPR 8500/4500; SB still counts for N.
  { name: 'fl vs bet, all-in third', spec: { button: 0, me: 0, hole: ['As', 'Ah'], stacks: { 0: 10000, 1: 1500, 2: 10000 }, board: ['Kc', '7h', '2s'], actions: [{ seat: 0, type: 'raise', to: 300 }, { seat: 1, type: 'allin' }, { seat: 2, type: 'call' }, { seat: 0, type: 'call' }, { seat: 2, type: 'bet', to: 2000, street: 'FLOP' }] }, potOdds: { pot: 6500, call: 2000 }, required: 2000 / 8500, effective: 8500, spr: 8500 / 4500, position: { label: 'BTN', inPosition: true }, verdict: 'call_ok', opponents: 2 },
  // 18. Big stack folds on the flop: turn effective = min(19700, 7700); SPR keeps the flop-start view min(19900, 14900)/300.
  { name: 'tu SPR keeps flop folder', spec: { button: 0, me: 0, hole: ['9d', '8d'], stacks: { 0: 20000, 1: 15000, 2: 8000 }, board: ['Ks', 'Qh', '2c', '4d'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'call' }, { seat: 2, type: 'check' }, { seat: 1, type: 'check', street: 'FLOP' }, { seat: 2, type: 'bet', to: 200 }, { seat: 0, type: 'call' }, { seat: 1, type: 'fold' }, ...checks('TURN', [2])] }, potOdds: null, required: null, effective: 7700, spr: 14900 / 300, position: { label: 'BTN', inPosition: true }, verdict: null, opponents: 1 },
  // 19. Board plays (exact 0.5): pot 50+250+250, +600 flop, +600 river -> 600/2350.
  { name: 'rv board plays vs bet', spec: { button: 0, me: 0, hole: ['2c', '3d'], stacks: S3, board: ['As', 'Ks', 'Qs', 'Js', 'Ts'], actions: [{ seat: 0, type: 'raise', to: 250 }, { seat: 1, type: 'fold' }, { seat: 2, type: 'call' }, { seat: 2, type: 'check', street: 'FLOP' }, { seat: 0, type: 'bet', to: 300 }, { seat: 2, type: 'call' }, ...checks('TURN', [2, 0]), { seat: 2, type: 'bet', to: 600, street: 'RIVER' }] }, potOdds: { pot: 1750, call: 600 }, required: 600 / 2350, effective: 9450, spr: 9750 / 550, position: { label: 'BTN', inPosition: true }, verdict: 'call_ok', opponents: 1 },
  // 20. HU BB vs a 300 open: 200 into 400.
  { name: 'pf HU BB vs open', spec: { button: 0, me: 1, hole: ['Td', '9d'], stacks: HU, actions: [{ seat: 0, type: 'raise', to: 300 }] }, potOdds: { pot: 400, call: 200 }, required: 1 / 3, effective: 10000, spr: null, position: { label: 'BB', inPosition: null }, verdict: 'call_ok', opponents: 1 },
  // 21. Four limpers, BB option: four opponents still in.
  { name: 'pf BB option limpers', spec: { button: 0, me: 2, hole: ['Qh', 'Jh'], stacks: S10K, actions: [{ seat: 3, type: 'call' }, { seat: 4, type: 'call' }, { seat: 5, type: 'fold' }, { seat: 0, type: 'call' }, { seat: 1, type: 'call' }] }, potOdds: null, required: null, effective: 10000, spr: null, position: { label: 'BB', inPosition: null }, verdict: null, opponents: 4 },
  // 22. HU flop check-raise faced by the BB: 300 more into 700.
  { name: 'fl HU vs raise', spec: { button: 0, me: 1, hole: ['6s', '6h'], stacks: HU, board: ['6d', '9c', 'Kh'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, { seat: 1, type: 'bet', to: 100, street: 'FLOP' }, { seat: 0, type: 'raise', to: 400 }] }, potOdds: { pot: 700, call: 300 }, required: 0.3, effective: 9900, spr: 49.5, position: { label: 'BB', inPosition: false }, verdict: 'call_ok', opponents: 1 },
  // 23. Short stack UTG (1500) in a 4-handed limped pot: effective = my 1400; SPR 1400/400.
  { name: 'tu short UTG vs bet', spec: { button: 0, me: 3, hole: ['Ah', 'Qd'], stacks: { 0: 10000, 1: 10000, 2: 10000, 3: 1500 }, board: ['Ad', 'Ts', '5c', '8h'], actions: [{ seat: 3, type: 'call' }, { seat: 0, type: 'call' }, { seat: 1, type: 'call' }, { seat: 2, type: 'check' }, ...checks('FLOP', [1, 2, 3, 0]), { seat: 1, type: 'bet', to: 400, street: 'TURN' }, { seat: 2, type: 'fold' }] }, potOdds: { pot: 800, call: 400 }, required: 1 / 3, effective: 1400, spr: 3.5, position: { label: 'UTG', inPosition: false }, verdict: 'call_ok', opponents: 2 },
  // 24. Six-way limped pot checked to the BTN on the river: five opponents, SPR 9900/600.
  { name: 'rv 6-way BTN check', spec: { button: 0, me: 0, hole: ['8h', '8d'], stacks: S10K, board: ['Kc', '7h', '2s', '3d', '4c'], actions: [{ seat: 3, type: 'call' }, { seat: 4, type: 'call' }, { seat: 5, type: 'call' }, { seat: 0, type: 'call' }, { seat: 1, type: 'call' }, { seat: 2, type: 'check' }, ...checks('FLOP', [1, 2, 3, 4, 5, 0]), ...checks('TURN', [1, 2, 3, 4, 5, 0]), ...checks('RIVER', [1, 2, 3, 4, 5])] }, potOdds: null, required: null, effective: 9900, spr: 16.5, position: { label: 'BTN', inPosition: true }, verdict: null, opponents: 5 },
  // 25. UTG open 300 faces a BTN 3-bet to 900: 600 into 1350.
  { name: 'pf UTG vs 3-bet', spec: { button: 0, me: 3, hole: ['Kd', 'Kc'], stacks: S10K, actions: [{ seat: 3, type: 'raise', to: 300 }, { seat: 4, type: 'fold' }, { seat: 5, type: 'fold' }, { seat: 0, type: 'raise', to: 900 }, { seat: 1, type: 'fold' }, { seat: 2, type: 'fold' }] }, potOdds: { pot: 1350, call: 600 }, required: 600 / 1950, effective: 10000, spr: null, position: { label: 'UTG', inPosition: null }, verdict: 'call_ok', opponents: 1 },
  // 26. HU flop, BB (600) shoves 500 into 200: 500/1200; effective 500; SPR 500/200.
  { name: 'fl HU vs short shove', spec: { button: 0, me: 0, hole: ['Kh', 'Qh'], stacks: { 0: 10000, 1: 600 }, board: ['Jh', 'Th', '2s'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, { seat: 1, type: 'allin', street: 'FLOP' }] }, potOdds: { pot: 700, call: 500 }, required: 500 / 1200, effective: 500, spr: 2.5, position: { label: 'BTN/SB', inPosition: true }, verdict: 'call_ok', opponents: 1 },
  // 27. SB (2000) all-in on the flop and called twice; on the turn the BB acts before the BTN.
  { name: 'tu BB first, all-in SB', spec: { button: 0, me: 2, hole: ['Td', '9d'], stacks: { 0: 10000, 1: 2000, 2: 10000 }, board: ['Ks', 'Qh', '2c', '4d'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'call' }, { seat: 2, type: 'check' }, { seat: 1, type: 'allin', street: 'FLOP' }, { seat: 2, type: 'call' }, { seat: 0, type: 'call' }] }, potOdds: null, required: null, effective: 8000, spr: 33, position: { label: 'BB', inPosition: false }, verdict: null, opponents: 2 },
  // 28. HU river check-raise: 600 more into 1200; river-start 9900.
  { name: 'rv HU vs check-raise', spec: { button: 0, me: 0, hole: ['8h', '8d'], stacks: HU, board: ['Kc', '7h', '2s', '3d', '4c'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, ...checks('FLOP', [1, 0]), ...checks('TURN', [1, 0]), { seat: 1, type: 'check', street: 'RIVER' }, { seat: 0, type: 'bet', to: 200 }, { seat: 1, type: 'raise', to: 800 }] }, potOdds: { pot: 1200, call: 600 }, required: 1 / 3, effective: 9900, spr: 49.5, position: { label: 'BTN/SB', inPosition: true }, verdict: 'call_ok', opponents: 1 },
  // 29. SB faces a 250 open from UTG+1 (BB still in): 200 into 400.
  { name: 'pf SB vs open', spec: { button: 0, me: 1, hole: ['7c', '2d'], stacks: S10K, actions: [{ seat: 3, type: 'fold' }, { seat: 4, type: 'raise', to: 250 }, { seat: 5, type: 'fold' }, { seat: 0, type: 'fold' }] }, potOdds: { pot: 400, call: 200 }, required: 1 / 3, effective: 10000, spr: null, position: { label: 'SB', inPosition: null }, verdict: 'call_short', opponents: 2 },
  // 30. Micro stack (150) on the flop: effective 50, SPR 50/200.
  { name: 'fl micro stack', spec: { button: 0, me: 0, hole: ['5c', '4c'], stacks: { 0: 150, 1: 10000 }, board: ['3d', '2s', '9h'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, { seat: 1, type: 'check', street: 'FLOP' }] }, potOdds: null, required: null, effective: 50, spr: 0.25, position: { label: 'BTN/SB', inPosition: true }, verdict: null, opponents: 1 },
  // 31. HU flop, BB checks, BTN (600) shoves 500; the BB faces it: 500 into 700 -> 500/1200; effective min(9900, 500);
  //     SPR 500/200. Position is seat order (lead review R0 3.2 m1): the all-in BTN still acts after the BB -> OOP.
  { name: 'fl HU OOP vs all-in', spec: { button: 0, me: 1, hole: ['Ac', 'Ad'], stacks: { 0: 600, 1: 10000 }, board: ['Jh', 'Th', '2s'], actions: [{ seat: 0, type: 'call' }, { seat: 1, type: 'check' }, { seat: 1, type: 'check', street: 'FLOP' }, { seat: 0, type: 'allin' }] }, potOdds: { pot: 700, call: 500 }, required: 500 / 1200, effective: 500, spr: 2.5, position: { label: 'BB', inPosition: false }, verdict: 'call_ok', opponents: 1 },
];

describe('SS20 metrics table (AC-8)', () => {
  it('has 31 rows covering every street, call/check spots, heads-up and 6-max, all-in opponents in and out of position', () => {
    expect(ROWS).toHaveLength(31);
  });

  it.each(ROWS)('$name', (row) => {
    const { view } = buildSpot(row.spec);
    const m = computeMetrics(view, { precision: 'display', rng: createSeededRng(row.name) });
    expect(m.potOdds).toEqual(row.potOdds);
    if (row.required === null) expect(m.requiredEquity).toBeNull();
    else expect(m.requiredEquity).toBeCloseTo(row.required, 12);
    expect(m.effectiveStack).toBe(row.effective);
    if (row.spr === null) expect(m.spr).toBeNull();
    else expect(m.spr).toBeCloseTo(row.spr, 12);
    expect(m.position).toEqual(row.position);
    expect(m.verdict).toBe(row.verdict);
    expect(m.basis).toBe('vs_random_hands');
    expect(m.equity.opponents).toBe(row.opponents);
  });
});
