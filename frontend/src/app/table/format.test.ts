// Unit tests for table/format.ts: numbers (G-6), cards, seat state, turn clock, pause state, equity display (SC4)
// and rank parts (AF-10). Table rows mirror components.md / ui-spec so a spec change shows up as a failing row.
import { describe, expect, it } from 'vitest';
import type { Card, HandView, Occupant, RankCode, RoomSettings, SeatView } from '@checky/engine/protocol';
import { translate } from '../i18n/useT';
import { fakeView } from '../testing/table-fixtures';
import {
  equityDisplay,
  formatChips,
  formatDelta,
  formatPercent1,
  formatPotOdds,
  halfWidthPoints,
  parseCard,
  handInPlay,
  mustRefill,
  pauseState,
  potTotal,
  rankParts,
  seatTurnClock,
  seatVisualState,
  sizerPresets,
  separateAllIn,
  sizerRange,
} from './format';

const occupant = (over: Partial<Occupant> = {}): Occupant => ({
  kind: 'human',
  name: 'Mina',
  avatarSeed: 3,
  isHost: false,
  isMe: false,
  status: 'ACTIVE',
  connected: true,
  stack: 9400,
  bot: null,
  inHand: { bet: 0, committed: 0, folded: false, allIn: false, position: 'BTN', cards: null, lastActionIndex: null },
  ...over,
});

const hand = (over: Partial<HandView> = {}): HandView => ({
  handId: 'h1',
  no: 1,
  street: 'FLOP',
  board: [],
  buttonSeat: 0,
  sbSeat: 1,
  bbSeat: 2,
  pots: [{ amount: 600, eligible: [0, 1, 2] }],
  currentBet: 0,
  toAct: 1,
  turnSeq: 4,
  turnMs: 24000,
  actions: [],
  startStacks: [],
  ...over,
});

const settings = (turnSeconds: RoomSettings['turnSeconds']): RoomSettings => ({
  seatCount: 3,
  sb: 50,
  bb: 100,
  startStack: 10000,
  turnSeconds,
  liveEquity: true,
  botChatter: true,
});

const DV = { DV9: 10000 };

describe('numbers (patterns section 9)', () => {
  it.each([
    [9_400, 'en', true, '9,400'], // below 10,000 never shortened
    [10_000, 'en', true, '10k'], // ".0" dropped
    [12_500, 'en', true, '12.5k'], // lowercase k
    [12_350, 'en', true, '12.4k'],
    [12_500, 'ja', true, '12,500'], // ja always full numbers
    [12_500, 'en', false, '12,500'], // results and menus: full numbers
  ] as const)('formatChips(%d, %s, compact=%s) = %s', (n, lang, compact, expected) => {
    expect(formatChips(n, lang, compact)).toBe(expected);
  });

  it('formatDelta uses + and the real minus sign U+2212', () => {
    expect(formatDelta(2400, 'en')).toBe('+2,400');
    expect(formatDelta(-1200, 'en')).toBe('\u22121,200');
    expect(formatDelta(0, 'en')).toBe('0');
  });

  it('percent and pot odds keep one decimal', () => {
    expect(formatPercent1(0.412, 'en')).toBe('41.2');
    expect(formatPercent1(0.5, 'ja')).toBe('50.0');
    expect(formatPotOdds(6000, 2400, 'en')).toBe('2.5 : 1');
    expect(formatPotOdds(300, 100, 'en')).toBe('3.0 : 1');
  });
});

describe('parseCard', () => {
  it('maps T to 10 and colours hearts/diamonds red', () => {
    expect(parseCard('Td')).toEqual({ rank: 'T', suit: 'd', face: '10', red: true });
    expect(parseCard('As')).toEqual({ rank: 'A', suit: 's', face: 'A', red: false });
    expect(parseCard('7h').red).toBe(true);
    expect(parseCard('2c').red).toBe(false);
  });
});

describe('seatVisualState (components.md 3.3, 7 rows)', () => {
  it.each([
    ['waitingNext', occupant({ status: 'WAITING_NEXT' }), false],
    ['sittingOut', occupant({ status: 'SITTING_OUT' }), false],
    ['reconnecting', occupant({ status: 'DISCONNECTED' }), false],
    ['reconnecting', occupant({ connected: false }), false],
    ['folded', occupant({ inHand: { ...occupant().inHand!, folded: true } }), false],
    ['allIn', occupant({ inHand: { ...occupant().inHand!, allIn: true } }), false],
    ['thinking', occupant({ kind: 'bot', bot: { engine: 'rule', provider: null, model: null, label: 'House 1', style: 'balanced' } }), true],
    ['active', occupant(), true],
  ] as const)('%s', (expected, occ, toAct) => {
    expect(seatVisualState(occ, toAct, true)).toBe(expected);
  });

  // R0-L15 follow-up: between hands inHand is the finished hand, the stack is the table stack (a refill shows 10,000).
  it('All-in only while the hand is played; "Folded" stays between hands (it is still true of the result)', () => {
    const shoved = occupant({ stack: 10000, inHand: { ...occupant().inHand!, allIn: true } });
    expect(seatVisualState(shoved, false, true)).toBe('allIn');
    expect(seatVisualState(shoved, false, false)).toBe('active');
    expect(seatVisualState(occupant({ inHand: { ...occupant().inHand!, folded: true } }), false, false)).toBe('folded');
  });

  it.each([
    ['IN_HAND', true],
    ['CLOSING_AFTER_HAND', true],
    ['BETWEEN_HANDS', false],
    ['PAUSED', false],
    ['WAITING', false],
  ] as const)('handInPlay(%s) -> %s', (phase, expected) => {
    expect(handInPlay(phase)).toBe(expected);
  });
});

describe('seatTurnClock (components.md 3.3, 6 cases)', () => {
  const human: SeatView = { seat: 1, occupant: occupant() };
  const ruleBot: SeatView = {
    seat: 1,
    occupant: occupant({ kind: 'bot', bot: { engine: 'rule', provider: null, model: null, label: 'House 1', style: 'tight' } }),
  };
  const llmBot: SeatView = {
    seat: 1,
    occupant: occupant({ kind: 'bot', bot: { engine: 'llm', provider: 'openai', model: 'gpt', label: 'GPT', style: 'aggressive' } }),
  };

  it('not to act -> null', () => {
    expect(seatTurnClock({ ...human, seat: 2 }, hand(), settings(30), DV)).toBeNull();
  });
  it('turnMs null (practice no limit) -> null', () => {
    expect(seatTurnClock(human, hand({ turnMs: null }), settings(null), DV)).toBeNull();
  });
  it('rule bot -> null even with a turnMs', () => {
    expect(seatTurnClock(ruleBot, hand(), settings(30), DV)).toBeNull();
  });
  it('LLM bot -> DV9 total', () => {
    expect(seatTurnClock(llmBot, hand({ turnMs: 7000 }), settings(30), DV)).toEqual({ remainingMs: 7000, totalMs: 10000 });
  });
  it('human with turnSeconds -> turnSeconds x 1000 total', () => {
    expect(seatTurnClock(human, hand(), settings(30), DV)).toEqual({ remainingMs: 24000, totalMs: 30000 });
  });
  it('human, turnMs present but turnSeconds null (inconsistent) -> null', () => {
    expect(seatTurnClock(human, hand(), settings(null), DV)).toBeNull();
  });
});

describe('mustRefill (lead decision R0-L3)', () => {
  const base = fakeView('practice-paused');
  const at = (kind: 'practice' | 'friend', phase: 'PAUSED' | 'BETWEEN_HANDS', canRefill: boolean) =>
    mustRefill({ room: { ...base.room, kind, phase }, me: { ...base.me, canRefill } });
  it.each([
    ['practice', 'PAUSED', true, true],
    ['practice', 'PAUSED', false, false],
    ['practice', 'BETWEEN_HANDS', true, false],
    ['friend', 'PAUSED', true, false],
  ] as const)('%s %s canRefill=%s -> %s', (kind, phase, canRefill, expected) => {
    expect(at(kind, phase, canRefill)).toBe(expected);
  });
});

describe('pauseState (components.md 3.15, 3 states)', () => {
  it.each([
    [false, 'IN_HAND', 'running'],
    [true, 'IN_HAND', 'pending'],
    [true, 'PAUSED', 'paused'],
    [false, 'PAUSED', 'paused'],
  ] as const)('paused=%s phase=%s -> %s', (paused, phase, expected) => {
    expect(pauseState(paused, phase)).toBe(expected);
  });
});

describe('equityDisplay (ui-spec 0.5, SC4, T2-005)', () => {
  it.each([
    [0.0231, '2.4'], // ceiling, not rounding (rounding would give 2.3)
    [0.02, '2'], // ".0" dropped
    [0.0004, '0.1'], // minimum 0.1
    [0.0001, '0.1'],
    [0.0237, '2.4'],
    [0.07, '7'], // float trap: 0.07 * 1000 = 70.00000000000001
    [0.029, '2.9'], // float trap: 29.000000000000004
    [0.023, '2.3'], // exact tenth stays put
  ])('half-width %f -> ±%s%%', (hw, expected) => {
    const d = equityDisplay({ method: 'mc', value: 0.241, halfWidth95: hw, samples: 10000 }, 'en');
    expect(d.vars.hw).toBe(expected);
    expect(translate('en', 'odds.estimate', d.vars)).toBe(`Estimate ±${expected}%`);
  });

  it('halfWidthPoints keeps the minimum at 0.1 for 0', () => {
    expect(halfWidthPoints(0)).toBe(0.1);
  });

  it('mc with half-width: "≈" value, Estimate badge, sr sentence, tooltip when samples exist', () => {
    const d = equityDisplay({ method: 'mc', value: 0.241, halfWidth95: 0.0237, samples: 10000 }, 'en');
    expect(translate('en', d.valueKey, d.vars)).toBe('≈24.1%');
    expect(d.badgeKey).toBe('odds.estimate');
    expect(d.srKey).toBe('odds.sr.mc');
    expect(d.tipKey).toBe('odds.estimate.tip');
    expect(translate('en', 'odds.estimate.tip', d.vars)).toBe('Estimated from 10,000 random boards — usually within ±2.4 points.');
  });

  it('exact: value only, no badge, no tooltip (contract display_rule)', () => {
    const d = equityDisplay({ method: 'exact', value: 0.412, halfWidth95: null, samples: null }, 'en');
    expect(translate('en', d.valueKey, d.vars)).toBe('41.2%');
    expect(d.badgeKey).toBeNull();
    expect(d.tipKey).toBeNull();
    expect(d.srKey).toBe('odds.sr.exact');
  });

  it('mc without half-width: "Estimate" with no ±, mcNoHw sentence', () => {
    const d = equityDisplay({ method: 'mc', value: 0.5, halfWidth95: null, samples: null }, 'en');
    expect(d.badgeKey).toBe('odds.estimate.noHw');
    expect(d.srKey).toBe('odds.sr.mcNoHw');
    expect(d.tipKey).toBeNull();
  });

  it('a missing method counts as an estimate (rule 1)', () => {
    expect(equityDisplay({ value: 0.5, halfWidth95: 0.01, samples: null }, 'en').exact).toBe(false);
  });
});

describe('rankParts (ui-spec 0.6: 9 codes + royal + wheel)', () => {
  const cases: [RankCode, Card[], ReturnType<typeof rankParts>][] = [
    ['high_card', ['Ks', '9d', '7c', '4h', '2s'], { key: 'high_card', r1: 'K' }],
    ['pair', ['9h', '9c', 'As', 'Kd', '4s'], { key: 'pair', r1: '9' }],
    ['two_pair', ['9h', '9c', 'Ks', 'Kd', '4s'], { key: 'two_pair', r1: 'K', r2: '9' }],
    ['trips', ['7h', '7c', '7s', 'Kd', '4s'], { key: 'trips', r1: '7' }],
    ['straight', ['9h', '8c', '7s', '6d', '5s'], { key: 'straight', r1: '9' }],
    ['straight', ['Ah', '2c', '3s', '4d', '5s'], { key: 'straight', r1: '5' }], // wheel
    ['flush', ['Ah', 'Jh', '9h', '6h', '2h'], { key: 'flush', r1: 'A' }],
    ['full_house', ['4h', '4c', 'Ks', 'Kd', 'Kc'], { key: 'full_house', r1: 'K', r2: '4' }],
    ['quads', ['Qh', 'Qc', 'Qs', 'Qd', '3s'], { key: 'quads', r1: 'Q' }],
    ['straight_flush', ['9s', '8s', '7s', '6s', '5s'], { key: 'straight_flush', r1: '9' }],
    ['straight_flush', ['As', 'Ks', 'Qs', 'Js', 'Ts'], { key: 'royal_flush' }],
    ['straight_flush', ['As', '2s', '3s', '4s', '5s'], { key: 'straight_flush', r1: '5' }], // steel wheel
  ];
  it.each(cases)('%s %j', (code, best5, expected) => {
    expect(rankParts(code, best5)).toEqual(expected);
  });
});

describe('pot and bet sizer (components.md 3.6, 3.9)', () => {
  it('potTotal = settled pots + bets in front', () => {
    const seats: SeatView[] = [
      { seat: 0, occupant: occupant({ inHand: { ...occupant().inHand!, bet: 400 } }) },
      { seat: 1, occupant: null },
      { seat: 2, occupant: occupant({ inHand: { ...occupant().inHand!, bet: 1200 } }) },
    ];
    expect(potTotal(hand({ pots: [{ amount: 1800, eligible: [] }, { amount: 600, eligible: [] }] }), seats)).toBe(4000);
    expect(potTotal(null, seats)).toBe(0);
  });

  it('sizerRange: raise only when reopened, else bet, else none', () => {
    const base = { fold: true, check: false, call: { amount: 400, to: 400 }, allIn: { to: 9400 } };
    expect(sizerRange({ ...base, bet: null, raise: { minTo: 800, maxTo: 9400 }, reopened: true })).toEqual({ kind: 'raise', min: 800, max: 9400 });
    expect(sizerRange({ ...base, bet: null, raise: { minTo: 800, maxTo: 9400 }, reopened: false })).toBeNull();
    expect(sizerRange({ ...base, call: null, check: true, bet: { min: 100, max: 9400 }, raise: null, reopened: true })).toEqual({ kind: 'bet', min: 100, max: 9400 });
  });

  it('separateAllIn: only when all-in puts in more than the call (or my bet when nothing is owed) — R0 M2', () => {
    const base = { fold: true, check: false, bet: null, raise: null, reopened: true };
    expect(separateAllIn({ ...base, call: { amount: 200, to: 600 }, allIn: { to: 600 } }, 400)).toBe(false); // = call
    expect(separateAllIn({ ...base, call: { amount: 200, to: 600 }, allIn: { to: 601 } }, 400)).toBe(true);
    expect(separateAllIn({ ...base, check: true, call: null, allIn: { to: 300 } }, 300)).toBe(false); // = my bet
    expect(separateAllIn({ ...base, check: true, call: null, allIn: { to: 80 } }, 0)).toBe(true); // stack < BB, nothing bet
  });

  it('presets: facing a bet uses B + C + f(P + C); hidden below min and at/above max', () => {
    // Facing 400 with nothing in front, pot shown 1,000: half = 400 + 0.5 x 1,400 = 1,100.
    expect(sizerPresets({ kind: 'raise', min: 800, max: 9400 }, 1000, 0, 400)).toEqual([
      { id: 'min', to: 800 },
      { id: 'half', to: 1100 },
      { id: 'threeQuarter', to: 1450 },
      { id: 'pot', to: 1800 },
    ]);
    // Unopened pot of 600: half = 300 (below min 400 -> hidden), pot = 600.
    expect(sizerPresets({ kind: 'bet', min: 400, max: 5000 }, 600, 0, 0)).toEqual([
      { id: 'min', to: 400 },
      { id: 'threeQuarter', to: 450 },
      { id: 'pot', to: 600 },
    ]);
    // Short stack: every fraction is >= max, only Min stays.
    expect(sizerPresets({ kind: 'bet', min: 100, max: 300 }, 600, 0, 0)).toEqual([{ id: 'min', to: 100 }]);
  });
});
