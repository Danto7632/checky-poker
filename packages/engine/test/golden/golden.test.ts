// AC-4 / AC-5: correct-rule golden scenarios J-2 (G-1..G-12, reproducing bugs B-E1..B-E8 from W1 S1a..S4) and
// legal-action / rejection rules. Expected values are the CORRECT NLHE results, not the old backend behaviour.
import { describe, expect, it } from 'vitest';
import { cardString } from '../../src/cards/card';
import { forceFold } from '../../src/hand/apply';
import { legalActions } from '../../src/hand/legal';
import { voidHand } from '../../src/hand/void';
import { CheckyError } from '../../src/util/checky-error';
import { act, checkDown, newHand, play, rig, runout, stacksOf } from '../helpers/hand';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof CheckyError ? e.code : String(e);
  }
};

describe('G-1 (B-E1, S1b) side pot at showdown', () => {
  it('main 900 -> AA, side 400 -> KK, final 900/900/500', () => {
    let s = rig(newHand({ 1: 1000, 2: 300, 3: 1000 }, 1), { 1: ['Ks', 'Kh'], 2: ['As', 'Ah'], 3: ['Qs', 'Qh'] }, ['2c', '7d', '9s', '3h', '4c']);
    s = act(s, 1, 'call');
    s = act(s, 2, 'allin', 300);
    s = act(s, 3, 'call');
    s = act(s, 1, 'call');
    expect(s.street).toBe('FLOP');
    expect(s.toAct).toBe(3); // seat 2 is all-in; first able seat left of the button
    s = act(s, 3, 'bet', 200);
    s = act(s, 1, 'call');
    s = checkDown(s);
    expect(s.street).toBe('COMPLETE');
    expect(s.result!.pots).toEqual([
      { kind: 'main', amount: 900, eligible: [1, 2, 3], winners: [2], shares: [900] },
      { kind: 'side', amount: 400, eligible: [1, 3], winners: [1], shares: [400] },
    ]);
    expect(stacksOf(s)).toEqual({ 1: 900, 2: 900, 3: 500 });
  });
});

describe('G-2 (B-E2, S1a) no premature runout', () => {
  const start = () => {
    let s = rig(newHand({ 1: 1000, 2: 300, 3: 1000 }, 1), { 1: ['Ks', 'Kh'], 2: ['As', 'Ah'], 3: ['Qs', 'Qh'] }, ['2c', '7d', '9s', '3h', '4c']);
    const a = play(s, 1, 'allin', 1000);
    const b = play(a.state, 2, 'allin', 300);
    s = b.state;
    return { s, events: [...a.events, ...b.events] };
  };
  it('the BB still has to act (call 900 or fold) before any runout', () => {
    const { s, events } = start();
    expect(s.toAct).toBe(3);
    expect(legalActions(s, 3)!.call).toEqual({ amount: 900, to: 1000 });
    expect(events.some((e) => e.t === 'RunoutStarted')).toBe(false);
    expect(s.street).toBe('PREFLOP');
  });
  it('BB folds: BTN excess 700 returned, main 700 to SB (AA), final 700/700/900', () => {
    let s = act(start().s, 3, 'fold');
    s = runout(s);
    expect(s.returned).toEqual([{ seat: 1, amount: 700 }]);
    expect(s.result!.pots).toEqual([{ kind: 'main', amount: 700, eligible: [1, 2], winners: [2], shares: [700] }]);
    expect(stacksOf(s)).toEqual({ 1: 700, 2: 700, 3: 900 });
  });
});

describe('G-3 (B-E3, S2a/S2b/S2c) postflop first actor', () => {
  it('3-handed limped pot: SB acts first on the flop', () => {
    let s = newHand({ 1: 1000, 2: 1000, 3: 1000 }, 1);
    s = act(s, 1, 'call');
    s = act(s, 2, 'call');
    s = act(s, 3, 'check');
    expect([s.street, s.toAct]).toEqual(['FLOP', 2]);
  });
  it('3-handed raised pot: SB first, not the preflop aggressor', () => {
    let s = newHand({ 1: 1000, 2: 1000, 3: 1000 }, 1);
    s = act(s, 1, 'raise', 300);
    s = act(s, 2, 'call');
    s = act(s, 3, 'call');
    expect([s.street, s.toAct]).toEqual(['FLOP', 2]);
  });
  it('heads-up BTN=SB raise, BB call: BB first on the flop', () => {
    let s = newHand({ 1: 1000, 2: 1000 }, 1);
    expect([s.sbSeat, s.bbSeat, s.toAct]).toEqual([1, 2, 1]);
    s = act(s, 1, 'raise', 300);
    s = act(s, 2, 'call');
    expect([s.street, s.toAct]).toEqual(['FLOP', 2]);
  });
});

describe('G-4 (B-E4, S3) minimum re-raise', () => {
  it('raise to 1000 (+900): re-raise to 1100 is E-ACT-AMOUNT, minTo 1900, all-in still allowed', () => {
    let s = newHand({ 1: 5000, 2: 5000, 3: 5000 }, 1);
    s = act(s, 1, 'raise', 1000);
    expect(legalActions(s, 2)!.raise).toEqual({ minTo: 1900, maxTo: 5000 });
    const before = s;
    expect(code(() => act(s, 2, 'raise', 1100))).toBe('E-ACT-AMOUNT');
    expect(s).toBe(before);
    s = act(s, 2, 'raise', 1900);
    expect(legalActions(s, 3)!.raise!.minTo).toBe(2800);
    expect(act(s, 3, 'allin', 5000).currentBet).toBe(5000);
  });
});

describe('G-5 (B-E5, S4) busted seat is not dealt', () => {
  it('hand 1 busts seat 3; hand 2 gives it no cards, no blind, no pot', () => {
    let h1 = rig(newHand({ 1: 1000, 2: 1000, 3: 300 }, 1), { 1: ['Ks', 'Kh'], 2: ['8c', '8d'], 3: ['Qs', 'Qh'] }, ['2c', '7d', '9s', '3h', '4c']);
    h1 = act(h1, 1, 'raise', 300);
    h1 = act(h1, 2, 'fold');
    h1 = act(h1, 3, 'allin', 300);
    h1 = runout(h1);
    expect(stacksOf(h1)).toEqual({ 1: 1350, 2: 950, 3: 0 });
    const h2 = newHand({ 1: 1350, 2: 950, 3: 0 }, 2);
    expect(h2.seats.map((p) => p.seat)).toEqual([1, 2]);
    expect(h2.actions.map((a) => a.seat)).toEqual([2, 1]); // heads-up: button 2 = SB, seat 1 = BB
    expect(Object.keys(h2.positions)).toEqual(['1', '2']);
    const done = checkDown(h2);
    expect(done.result!.pots.every((p) => !p.eligible.includes(3))).toBe(true);
  });
});

describe('G-6 (B-E6) under-raise all-in does not reopen', () => {
  it('BTN 300, SB call, BB all-in 450: BTN and SB may only call or fold', () => {
    let s = newHand({ 1: 5000, 2: 5000, 3: 450, 4: 5000 }, 1);
    // 4-handed: SB 2, BB 3, UTG 4 acts first.
    s = act(s, 4, 'fold');
    s = act(s, 1, 'raise', 300);
    s = act(s, 2, 'call');
    s = act(s, 3, 'allin', 450);
    for (const seat of [1, 2]) {
      expect(s.toAct).toBe(seat);
      const legal = legalActions(s, seat)!;
      expect(legal.reopened).toBe(false);
      expect(legal.raise).toBeNull();
      expect(legal.call).toEqual({ amount: 150, to: 450 });
      expect(legal.allIn).toEqual({ to: 450 }); // R0 M2: capped at the call while raising is closed
      expect(code(() => act(s, seat, 'allin', 5000))).toBe('E-ACT-ILLEGAL');
      expect(code(() => act(s, seat, 'raise', 750))).toBe('E-ACT-ILLEGAL');
      s = act(s, seat, 'call');
    }
    expect(s.street).toBe('FLOP');
  });
  it('a full raise after the under-raise reopens', () => {
    let s = newHand({ 1: 5000, 2: 5000, 3: 450, 4: 5000 }, 1);
    s = act(s, 4, 'call'); // UTG limps
    s = act(s, 1, 'raise', 300);
    s = act(s, 2, 'fold');
    s = act(s, 3, 'allin', 450); // +150: incomplete
    // UTG acted at 100; it now faces 350 more >= the 200 full-raise increment -> reopened.
    expect(legalActions(s, 4)!.reopened).toBe(true);
    expect(legalActions(s, 4)!.raise).toEqual({ minTo: 650, maxTo: 5000 });
  });
});

// R0 M2 (review repro c.tt): legalActions used to advertise allIn.to = whole stack with reopened false, and
// applyAction rejected exactly that amount with E-ACT-ILLEGAL.
describe('R0 M2 advertised all-in is accepted when raising is closed', () => {
  it('heads-up 2000/500: SB limps, BB shoves 500 -> SB allIn.to = call.to 500, accepted and logged as a call', () => {
    let s = newHand({ 0: 2000, 1: 500 }, 0);
    s = act(s, 0, 'call');
    s = act(s, 1, 'allin', 500);
    const legal = legalActions(s, 0)!;
    expect(legal).toEqual({ fold: true, check: false, call: { amount: 400, to: 500 }, bet: null, raise: null, allIn: { to: 500 }, reopened: false });
    expect(code(() => act(s, 0, 'allin', 2000))).toBe('E-ACT-ILLEGAL');
    const after = act(s, 0, 'allin', legal.allIn.to);
    const last = after.actions.at(-1)!;
    expect(last).toMatchObject({ seat: 0, type: 'call', to: 500, added: 400 });
    expect(after.seats.find((p) => p.seat === 0)).toMatchObject({ stack: 1500, allIn: false });
    expect(after.street).toBe('RUNOUT');
  });
  it('nobody left to respond and short: allIn.to = call.to = whole stack, logged as allin', () => {
    let s = newHand({ 0: 3000, 1: 5000, 2: 400, 3: 3000 }, 0); // SB 1, BB 2, UTG 3
    s = act(s, 3, 'allin', 3000);
    s = act(s, 0, 'call'); // all-in call
    s = act(s, 1, 'fold');
    const legal = legalActions(s, 2)!;
    expect(legal).toMatchObject({ call: { amount: 300, to: 400 }, raise: null, allIn: { to: 400 }, reopened: false });
    expect(act(s, 2, 'allin', legal.allIn.to).actions.at(-1)).toMatchObject({ seat: 2, type: 'allin', to: 400, added: 300 });
  });
});

describe('G-7 (B-E7) closing mid-hand voids the hand', () => {
  it('voidHand gives every dealt seat its start stack back; chips are preserved', () => {
    let s = newHand({ 0: 1000, 1: 1000, 2: 1000 }, 0);
    s = act(s, 0, 'raise', 400);
    s = act(s, 1, 'call');
    const { startStacks } = voidHand(s);
    expect(startStacks).toEqual([{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }]);
  });
});

describe('G-8 (B-E8) odd chip goes to the first winner left of the button', () => {
  const tie = (button: number) => {
    let s = rig(newHand({ 0: 101, 1: 101, 2: 101 }, button, [1, 2]), { 0: ['5h', '6h'], 1: ['Th', '3h'], 2: ['Tc', '4d'] }, ['As', 'Ks', 'Qs', 'Jd', '2c']);
    for (let guard = 0; s.toAct !== null && guard < 5; guard += 1) s = act(s, s.toAct, 'allin', legalActions(s, s.toAct)!.allIn.to);
    return runout(s);
  };
  it('button 0: seat 1 is first left of the button and gets 152', () => {
    const s = tie(0);
    expect(s.result!.pots).toEqual([{ kind: 'main', amount: 303, eligible: [0, 1, 2], winners: [1, 2], shares: [152, 151] }]);
  });
  it('button 1: seat 2 is first left of the button and gets 152', () => {
    const s = tie(1);
    expect(s.result!.pots[0]!.winners).toEqual([2, 1]);
    expect(s.result!.pots[0]!.shares).toEqual([152, 151]);
  });
});

describe('G-9 (R1) heads-up order', () => {
  it('button = SB acts first preflop, BB first on every later street', () => {
    let s = newHand({ 0: 1000, 5: 1000 }, 5);
    expect([s.sbSeat, s.bbSeat, s.toAct]).toEqual([5, 0, 5]);
    s = act(s, 5, 'call');
    expect(s.toAct).toBe(0); // BB option
    s = act(s, 0, 'check');
    expect([s.street, s.toAct]).toEqual(['FLOP', 0]);
    s = act(s, 0, 'check');
    s = act(s, 5, 'check');
    expect([s.street, s.toAct]).toEqual(['TURN', 0]);
  });
});

describe('G-10 (R7, SC14) three side pots and a return', () => {
  it('100/300/600/1000 all-in: main 400, side 600, side 600, 400 returned', () => {
    let s = newHand({ 0: 100, 1: 300, 2: 600, 3: 1000 }, 0);
    for (let guard = 0; s.toAct !== null && guard < 6; guard += 1) s = act(s, s.toAct, 'allin', legalActions(s, s.toAct)!.allIn.to);
    s = runout(s);
    expect(s.returned).toEqual([{ seat: 3, amount: 400 }]);
    expect(s.result!.pots.map((p) => [p.kind, p.amount, p.eligible])).toEqual([
      ['main', 400, [0, 1, 2, 3]],
      ['side', 600, [1, 2, 3]],
      ['side', 600, [2, 3]],
    ]);
    expect(Object.values(stacksOf(s)).reduce((a, b) => a + b, 0)).toBe(2000);
  });
});

describe('G-11 (R12) showdown order and folded cards', () => {
  it('last river aggressor shows first, then clockwise; the folded seat is not shown', () => {
    let s = rig(newHand({ 0: 1000, 1: 1000, 2: 1000, 3: 1000 }, 0), { 0: ['2h', '3d'], 1: ['Ah', 'Ad'], 2: ['Kh', 'Kd'], 3: ['7c', '8c'] }, ['2c', '9d', 'Ts', '4h', '5s']);
    s = act(s, 3, 'call');
    s = act(s, 0, 'call');
    s = act(s, 1, 'call');
    s = act(s, 2, 'check');
    s = act(s, 1, 'check');
    s = act(s, 2, 'check');
    s = act(s, 3, 'check');
    s = act(s, 0, 'fold');
    for (const street of ['TURN', 'RIVER']) {
      expect(s.street).toBe(street);
      s = act(s, 1, 'check');
      s = act(s, 2, street === 'RIVER' ? 'bet' : 'check', street === 'RIVER' ? 200 : undefined);
      if (street === 'RIVER') {
        s = act(s, 3, 'call');
        s = act(s, 1, 'call');
      } else {
        s = act(s, 3, 'check');
      }
    }
    expect(s.street).toBe('COMPLETE');
    expect(s.result!.showdown.map((x) => x.seat)).toEqual([2, 3, 1]);
    expect(s.result!.showdown.some((x) => x.seat === 0)).toBe(false);
    expect(s.result!.showdown.find((x) => x.seat === 3)!.best5.map(cardString)).toHaveLength(5);
  });
  it('checked-down river: first live seat left of the button shows first', () => {
    const s = checkDown(newHand({ 0: 1000, 1: 1000, 2: 1000 }, 0));
    expect(s.result!.showdown.map((x) => x.seat)).toEqual([1, 2, 0]);
  });
});

describe('G-12 uncalled bet and conservation', () => {
  it('an uncalled river bet is returned and listed; total chips unchanged', () => {
    let s = newHand({ 0: 1000, 1: 1000 }, 0);
    s = act(s, 0, 'call');
    s = act(s, 1, 'check');
    s = act(s, 1, 'bet', 500);
    s = act(s, 0, 'fold');
    expect(s.street).toBe('COMPLETE');
    expect(s.returned).toEqual([{ seat: 1, amount: 500 }]);
    expect(s.result!.showdown).toEqual([]);
    expect(stacksOf(s)).toEqual({ 0: 900, 1: 1100 });
  });
});

describe('AC-5 legal actions and rejections', () => {
  it('not your turn / illegal / amount are rejected and leave the state untouched', () => {
    const s = newHand({ 0: 1000, 1: 1000, 2: 1000 }, 0);
    const snapshot = JSON.stringify(s);
    expect(s.toAct).toBe(0);
    expect(code(() => act(s, 1, 'call'))).toBe('E-ACT-NOT-YOUR-TURN');
    expect(code(() => act(s, 0, 'check'))).toBe('E-ACT-ILLEGAL');
    expect(code(() => act(s, 0, 'bet', 300))).toBe('E-ACT-ILLEGAL'); // preflop there is a bet (the BB): raise, not bet
    expect(code(() => act(s, 0, 'raise', 150))).toBe('E-ACT-AMOUNT');
    expect(code(() => act(s, 0, 'raise', 5000))).toBe('E-ACT-AMOUNT');
    expect(code(() => act(s, 0, 'raise'))).toBe('E-ACT-AMOUNT');
    expect(code(() => act(s, 0, 'allin', 999))).toBe('E-ACT-AMOUNT');
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('legalActions is null off turn and follows the contract readings', () => {
    let s = newHand({ 0: 1000, 1: 1000, 2: 60 }, 0);
    expect(legalActions(s, 1)).toBeNull();
    expect(legalActions(s, 0)).toEqual({
      fold: true,
      check: false,
      call: { amount: 100, to: 100 },
      bet: null,
      raise: { minTo: 200, maxTo: 1000 },
      allIn: { to: 1000 },
      reopened: true,
    });
    // Short BB (60) posted all-in; the price to call is still the full BB.
    expect(s.seats.find((p) => p.seat === 2)!.allIn).toBe(true);
    s = act(s, 0, 'call');
    s = act(s, 1, 'call');
    // Flop: SB first. With 1 opponent able to act, betting is open; stack < BB means bet null (only all-in).
    expect(s.street).toBe('FLOP');
    const tiny = newHand({ 0: 1000, 1: 1000 }, 0);
    const l = legalActions(act(act(tiny, 0, 'call'), 1, 'check'), 1)!;
    expect(l.bet).toEqual({ min: 100, max: 900 });
  });

  it('all-in call when the stack does not cover the call', () => {
    let s = newHand({ 0: 1000, 1: 250, 2: 1000 }, 0);
    s = act(s, 0, 'raise', 400);
    expect(legalActions(s, 1)!.call).toEqual({ amount: 200, to: 250 });
    expect(legalActions(s, 1)!.raise).toBeNull();
    s = act(s, 1, 'call');
    expect(s.actions.at(-1)).toMatchObject({ seat: 1, type: 'allin', to: 250, added: 200 });
  });

  it('there is no "call any" or auto-raise path: only fold/check/call/bet/raise/allin exist', () => {
    const s = newHand({ 0: 1000, 1: 1000 }, 0);
    expect(code(() => act(s, 0, 'callany' as never))).toBe('E-ACT-ILLEGAL');
  });

  it('forceFold (R13): out of turn, keeps all-in eligibility, closes the hand when one is left', () => {
    let s = newHand({ 0: 1000, 1: 1000, 2: 1000 }, 0);
    s = forceFold(s, 2, 'leave').state; // BB leaves while UTG(0) is on turn
    expect(s.toAct).toBe(0);
    expect(s.actions.at(-1)).toMatchObject({ seat: 2, type: 'fold', auto: 'leave' });
    s = forceFold(s, 0, 'kick').state;
    expect(s.street).toBe('COMPLETE');
    // The BB's 100 is dead money (it left): the SB wins 150 and nothing is returned to a folded seat.
    expect(stacksOf(s)).toEqual({ 0: 1000, 1: 1100, 2: 900 });
    expect(s.returned).toEqual([]);
    let a = newHand({ 0: 1000, 1: 300, 2: 1000 }, 0);
    a = act(a, 0, 'call');
    a = act(a, 1, 'allin', 300);
    const kept = forceFold(a, 1, 'leave');
    expect(kept.state).toBe(a); // all-in seat keeps its eligibility: no change
  });

  // R0 M4 (review repro a.tt): the lowest pot layer had no eligible seat, so its chips vanished (E-ENG-INVARIANT).
  it('both blinds leave before the button acts: the button (put in 0) wins 150', () => {
    let s = newHand({ 0: 1000, 1: 1000, 2: 1000 }, 0); // SB 1, BB 2, the button acts first
    s = forceFold(s, 1, 'leave').state;
    s = forceFold(s, 2, 'leave').state;
    expect(s.street).toBe('COMPLETE');
    expect(s.result!.pots).toEqual([{ kind: 'main', amount: 150, eligible: [0], winners: [0], shares: [150] }]);
    expect(stacksOf(s)).toEqual({ 0: 1150, 1: 950, 2: 900 });
    expect(s.returned).toEqual([]);
  });

  it('dead money above a short all-in goes to the highest pot a live seat reached, not to the short stack', () => {
    // UTG 3 all-in 100, BTN 0 all-in 300, SB 1 raises to 500 and leaves while the BB is on turn, BB folds: the
    // 200 above 300 is dead money for the BTN's side pot; UTG can still only win its 100-level main pot.
    let s = newHand({ 0: 300, 1: 5000, 2: 5000, 3: 100 }, 0);
    s = act(s, 3, 'allin', 100);
    s = act(s, 0, 'allin', 300);
    s = act(s, 1, 'raise', 500);
    s = forceFold(s, 1, 'leave').state;
    s = act(s, 2, 'fold');
    expect(s.returned).toEqual([]); // a folded bettor gets nothing back (R-4)
    s = runout(s);
    expect(s.street).toBe('COMPLETE');
    expect(s.result!.pots.map((p) => ({ amount: p.amount, eligible: p.eligible }))).toEqual([
      { amount: 400, eligible: [0, 3] },
      { amount: 600, eligible: [0] },
    ]);
  });
});
