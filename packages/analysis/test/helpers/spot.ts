// Test fixture builder: a compact spot description -> a full PlayerView at "my turn".
//
// The real projection (projectView over a TableState) is Phillip's R0-end deliverable, so analysis tests build
// views here. The bookkeeping is deliberately plain (to = street total, added = to - previous street bet, a new
// street resets bets) and only serves fixtures; expected values in the tests are written by hand, never derived
// from this file. LegalActions are an approximation good enough for fixtures (fold always allowed, reopened
// true); the 10,000-hand simulation uses the engine's own legalActions instead.
import type {
  ActionLogEntry,
  Card,
  EngineActionType,
  LegalActions,
  PlayerView,
  PlayerViewShape,
  Street,
} from '@checky/engine/protocol';

export interface SpotAction {
  seat: number;
  type: EngineActionType;
  /** Street total for bet/raise (allin and call compute it). */
  to?: number;
  /** Defaults to the previous action's street (PREFLOP first). */
  street?: Street;
}

export interface SpotSpec {
  button: number;
  me: number;
  hole: [Card, Card];
  /** Start-of-hand stacks of the dealt-in seats. */
  stacks: Partial<Record<number, number>>;
  seatCount?: number;
  sb?: number;
  bb?: number;
  board?: Card[];
  actions?: SpotAction[];
  lang?: 'en' | 'ja' | 'ko';
}

const STREET_OF_BOARD: Record<number, Street> = { 0: 'PREFLOP', 3: 'FLOP', 4: 'TURN', 5: 'RIVER' };

function labelsFor(count: number): string[] {
  if (count === 2) return ['BTN/SB', 'BB'];
  const labels = ['BTN', 'SB', 'BB'];
  for (let i = 3; i < count; i += 1) labels.push(i === 3 ? 'UTG' : `UTG+${i - 3}`);
  return labels;
}

interface SeatState {
  stack: number;
  bet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  last: number | null;
}

export function buildSpot(spec: SpotSpec): { view: PlayerView; legal: LegalActions } {
  const seatCount = spec.seatCount ?? 6;
  const sb = spec.sb ?? 50;
  const bb = spec.bb ?? 100;
  const board = spec.board ?? [];
  const finalStreet = STREET_OF_BOARD[board.length];
  if (finalStreet === undefined) throw new Error(`buildSpot: board of ${board.length} cards`);

  const dealt = Object.entries(spec.stacks)
    .filter(([, s]) => (s ?? 0) > 0)
    .map(([seat]) => Number(seat))
    .sort((a, b) => a - b);
  const bi = dealt.indexOf(spec.button);
  if (bi < 0 || !dealt.includes(spec.me)) throw new Error('buildSpot: button and me must be dealt in');
  const ordered = [...dealt.slice(bi), ...dealt.slice(0, bi)];
  const labels = labelsFor(ordered.length);
  const label = new Map(ordered.map((s, i) => [s, labels[i] ?? 'UTG']));
  const sbSeat = ordered.length === 2 ? ordered[0]! : ordered[1]!;
  const bbSeat = ordered.length === 2 ? ordered[1]! : ordered[2]!;

  const st = new Map<number, SeatState>(
    dealt.map((s) => [s, { stack: spec.stacks[s] ?? 0, bet: 0, committed: 0, folded: false, allIn: false, last: null }]),
  );
  const log: ActionLogEntry[] = [];
  let street: Street = 'PREFLOP';
  let currentBet = 0;
  let lastIncrement = bb;

  const put = (seat: number, type: ActionLogEntry['type'], target: number): void => {
    const s = st.get(seat);
    if (s === undefined) throw new Error(`buildSpot: seat ${seat} not dealt in`);
    const to = Math.min(target, s.bet + s.stack);
    const added = to - s.bet;
    s.stack -= added;
    s.bet = to;
    s.committed += added;
    if (s.stack === 0) s.allIn = true;
    if (to > currentBet) {
      lastIncrement = Math.max(lastIncrement, to - currentBet);
      currentBet = to;
    }
    s.last = log.length;
    log.push({ i: log.length, street, seat, type, to, added });
  };
  const newStreet = (next: Street): void => {
    street = next;
    currentBet = 0;
    lastIncrement = bb;
    for (const s of st.values()) s.bet = 0;
  };

  put(sbSeat, 'post_sb', sb);
  put(bbSeat, 'post_bb', bb);
  for (const a of spec.actions ?? []) {
    if (a.street !== undefined && a.street !== street) newStreet(a.street);
    const s = st.get(a.seat);
    if (s === undefined) throw new Error(`buildSpot: seat ${a.seat} not dealt in`);
    if (a.type === 'fold') {
      s.folded = true;
      s.last = log.length;
      log.push({ i: log.length, street, seat: a.seat, type: 'fold', to: s.bet, added: 0 });
    } else if (a.type === 'check') {
      s.last = log.length;
      log.push({ i: log.length, street, seat: a.seat, type: 'check', to: s.bet, added: 0 });
    } else if (a.type === 'call') put(a.seat, 'call', currentBet);
    else if (a.type === 'allin') put(a.seat, 'allin', s.bet + s.stack);
    else {
      if (a.to === undefined) throw new Error(`buildSpot: ${a.type} needs "to"`);
      put(a.seat, a.type, a.to);
    }
  }
  if (street !== finalStreet) newStreet(finalStreet);

  const me = st.get(spec.me)!;
  const owe = currentBet - me.bet;
  const callAmount = Math.min(owe, me.stack);
  const legal: LegalActions = {
    fold: true,
    check: owe <= 0,
    call: owe > 0 ? { amount: callAmount, to: me.bet + callAmount } : null,
    bet: currentBet === 0 && me.stack > 0 ? { min: Math.min(bb, me.stack), max: me.stack } : null,
    raise:
      currentBet > 0 && me.bet + me.stack > currentBet
        ? { minTo: Math.min(currentBet + lastIncrement, me.bet + me.stack), maxTo: me.bet + me.stack }
        : null,
    allIn: { to: me.bet + me.stack },
    reopened: true,
  };

  const seats = Array.from({ length: seatCount }, (_, seat) => {
    const s = st.get(seat);
    if (s === undefined) return { seat, occupant: null };
    return {
      seat,
      occupant: {
        kind: seat === spec.me ? ('human' as const) : ('bot' as const),
        name: `P${seat}`,
        avatarSeed: seat,
        isHost: seat === spec.me,
        isMe: seat === spec.me,
        status: 'ACTIVE' as const,
        connected: true,
        stack: s.stack,
        bot: null,
        inHand: {
          bet: s.bet,
          committed: s.committed,
          folded: s.folded,
          allIn: s.allIn,
          position: label.get(seat) ?? '',
          cards: null,
          lastActionIndex: s.last,
        },
      },
    };
  });

  // Typed as the unbranded shape first so the fixture is checked field by field before the test-only brand.
  const view: PlayerViewShape = {
    pv: '1',
    room: {
      kind: 'practice' as const,
      phase: 'IN_HAND' as const,
      lang: spec.lang ?? 'en',
      settings: { seatCount, sb, bb, startStack: 10000, turnSeconds: null, liveEquity: true, botChatter: true },
      pendingSettings: null,
      locked: false,
      paused: false,
      closingAfterHand: false,
      handsPlayed: 0,
      countdownMs: null,
      hostSeat: spec.me,
    },
    me: { role: 'host' as const, seat: spec.me, status: 'ACTIVE' as const, holeCards: spec.hole, legal, canRefill: false, timeoutStrikes: 0 },
    seats,
    hand: {
      handId: 'AAAAAAAAAAAAAAAAAAAAAA',
      no: 1,
      street: finalStreet,
      board,
      buttonSeat: spec.button,
      sbSeat,
      bbSeat,
      pots: [],
      currentBet,
      toAct: spec.me,
      turnSeq: log.length,
      turnMs: null,
      actions: log,
      startStacks: dealt.map((seat) => ({ seat, stack: spec.stacks[seat] ?? 0 })),
    },
    result: null,
    arena: null,
  };
  return { view: view as PlayerView, legal };
}

/**
 * A limped pot checked down to the last street of `board`, me on the button, `opponents` others still in.
 * facing: the first player after the button bets 300 on the last street and everyone else calls before me.
 * Preflop (empty board) it is my first decision: the UTG.. seats limp (heads-up I am the SB and act first).
 */
export function limpedSpot(hole: [Card, Card], board: Card[], opponents: number, facing: boolean, lang: 'en' | 'ja' = 'en'): SpotSpec {
  const players = opponents + 1;
  const stacks: Partial<Record<number, number>> = {};
  for (let s = 0; s < players; s += 1) stacks[s] = 10000;
  const actions: SpotAction[] = [];
  const streets: Street[] = ['FLOP', 'TURN', 'RIVER'].slice(0, Math.max(0, board.length - 2)) as Street[];
  const early = Array.from({ length: Math.max(0, players - 3) }, (_, i) => i + 3);
  if (board.length === 0) {
    for (const s of early) actions.push({ seat: s, type: 'call' });
    return { button: 0, me: 0, hole, stacks, board, actions, lang };
  }
  for (const s of early) actions.push({ seat: s, type: 'call' });
  if (players === 2) actions.push({ seat: 0, type: 'call' }, { seat: 1, type: 'check' });
  else actions.push({ seat: 0, type: 'call' }, { seat: 1, type: 'call' }, { seat: 2, type: 'check' });
  const after = Array.from({ length: opponents }, (_, i) => i + 1); // post-flop order before the button
  streets.forEach((street, k) => {
    const last = k === streets.length - 1;
    if (last && facing) {
      actions.push({ seat: after[0]!, type: 'bet', to: 300, street });
      for (const s of after.slice(1)) actions.push({ seat: s, type: 'call' });
      return;
    }
    after.forEach((s, i) => actions.push(i === 0 ? { seat: s, type: 'check', street } : { seat: s, type: 'check' }));
    if (!last) actions.push({ seat: 0, type: 'check' });
  });
  return { button: 0, me: 0, hole, stacks, board, actions, lang };
}
