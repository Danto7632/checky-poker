// createFakeClient(scenario): fixed ClientSnapshots for building and testing screens without a Worker or a
// network (A-SES-FAKE, C3/I-04). Development and tests only: the app must not import it on a release path.
//
// The fixtures obey the same rules as real projections: no other human's unrevealed cards anywhere (D7), no
// currency symbols, no card-shaped names. One chat line carries an XSS probe so the UI can prove it renders
// text as text. The client object has every TableClient/HostTableClient/PracticeTableClient/ArenaTableClient
// method; calls are only recorded (`calls`), never applied, so getSnapshot() always returns the same reference.
//
// This file is one of the two places outside engine/projection allowed to assert `as PlayerView` (D-L10).
import { ERROR_CODES } from '@checky/engine/protocol';
import type {
  ActionLogEntry,
  Card,
  ChatLine,
  ErrorCode,
  HandResult,
  HandView,
  LegalActions,
  Occupant,
  PlayerView,
  PlayerViewShape,
  RoomKind,
  RoomPhase,
  RoomSettings,
  SeatStatus,
  Street,
} from '@checky/engine/protocol';
import type {
  ArenaTableClient,
  ClientSnapshot,
  HostTableClient,
  InviteInfo,
  PracticeTableClient,
} from './types';

export type FakeClient = HostTableClient & PracticeTableClient & ArenaTableClient & {
  /** Every method call in order, for assertions. */
  readonly calls: readonly { method: string; args: readonly unknown[] }[];
};

export const FAKE_SCENARIOS = [
  'waiting',
  'my-turn',
  'showdown',
  'bot-reveal',
  'host-lost',
  'closed',
  'practice-no-limit',
  'practice-pausing',
  'practice-paused',
  'practice-busted',
  'alert',
  'guest-waiting',
  'waiting-next',
  'sitting-out',
  'refill',
  'paused',
  'reconnecting',
  'practice-my-turn',
  'other-tab-host',
] as const;

// Fixed clock values keep snapshots deterministic in tests and stories.
const T0 = 1_000_000;
const INVITE: InviteInfo = {
  code: 'K7M2Q9XRT4',
  display: 'K7M2Q-9XRT4',
  link: 'https://checkypoker.pages.dev/join#K7M2Q9XRT4',
};
const HAND_ID = 'q3V9kL2mN8pR4sT6uW1xYz';

const FRIEND_SETTINGS: RoomSettings = {
  seatCount: 6,
  sb: 50,
  bb: 100,
  startStack: 10000,
  turnSeconds: 30,
  liveEquity: false,
  botChatter: true,
};
const PRACTICE_SETTINGS: RoomSettings = { ...FRIEND_SETTINGS, turnSeconds: 60, liveEquity: true };

// ---------------------------------------------------------------------------------------------------------------
// The friend-room hand used by most scenarios. Seat 0 = Mina (host, BTN), 1 = Kenji (SB, all-in preflop),
// 2 = Sora (BB), 3 = Ada (rule bot), 4 = Rex (rule bot, folds preflop), 5 = Lena (LLM bot).
// ---------------------------------------------------------------------------------------------------------------
type Seat = 0 | 1 | 2 | 3 | 4 | 5;
const NAMES = ['Mina', 'Kenji', 'Sora', 'Ada', 'Rex', 'Lena'] as const;
const BOTS: Partial<Record<Seat, Occupant['bot']>> = {
  3: { engine: 'rule', provider: null, model: null, label: 'Ada', style: 'balanced' },
  4: { engine: 'rule', provider: null, model: null, label: 'Rex', style: 'aggressive' },
  5: { engine: 'llm', provider: 'openai', model: 'gpt-5-mini', label: 'Lena', style: 'tight' },
};
// Hole cards per seat. Sora's (seat 2) are never revealed, so the fixture does not even contain them.
const HOLE: Partial<Record<Seat, [Card, Card]>> = {
  0: ['6h', '5h'],
  1: ['Qs', 'Qd'],
  3: ['Ac', 'Kc'],
  4: ['Jc', 'Tc'],
  5: ['8d', '8s'],
};
const BOARD: Card[] = ['Qh', '7s', '2d', 'Ad', '9c'];

function log(i: number, street: Street, seat: Seat, type: ActionLogEntry['type'], to: number, added: number): ActionLogEntry {
  return { i, street, seat, type, to, added };
}
const PREFLOP: ActionLogEntry[] = [
  log(0, 'PREFLOP', 1, 'post_sb', 50, 50),
  log(1, 'PREFLOP', 2, 'post_bb', 100, 100),
  log(2, 'PREFLOP', 3, 'raise', 300, 300),
  log(3, 'PREFLOP', 4, 'fold', 0, 0),
  log(4, 'PREFLOP', 5, 'call', 300, 300),
  log(5, 'PREFLOP', 0, 'call', 300, 300),
  log(6, 'PREFLOP', 1, 'allin', 250, 200),
  log(7, 'PREFLOP', 2, 'call', 300, 200),
];
const FLOP_TO_ME: ActionLogEntry[] = [
  log(8, 'FLOP', 2, 'check', 0, 0),
  log(9, 'FLOP', 3, 'bet', 400, 400),
  log(10, 'FLOP', 5, 'call', 400, 400),
];
const REST: ActionLogEntry[] = [
  log(11, 'FLOP', 0, 'fold', 0, 0),
  log(12, 'FLOP', 2, 'fold', 0, 0),
  log(13, 'TURN', 3, 'bet', 1000, 1000),
  log(14, 'TURN', 5, 'fold', 0, 0),
];
const START_STACKS = [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: seat === 1 ? 250 : 10000 }));

const HUMAN_STATUS: SeatStatus = 'ACTIVE';

interface SeatState {
  stack: number;
  bet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  last: number | null;
}

const ON_FLOP: Record<Seat, SeatState> = {
  0: { stack: 9700, bet: 0, committed: 300, folded: false, allIn: false, last: 5 },
  1: { stack: 0, bet: 0, committed: 250, folded: false, allIn: true, last: 6 },
  2: { stack: 9700, bet: 0, committed: 300, folded: false, allIn: false, last: 8 },
  3: { stack: 9300, bet: 400, committed: 700, folded: false, allIn: false, last: 9 },
  4: { stack: 10000, bet: 0, committed: 0, folded: true, allIn: false, last: 3 },
  5: { stack: 9300, bet: 400, committed: 700, folded: false, allIn: false, last: 10 },
};
const AFTER_HAND: Record<Seat, SeatState> = {
  0: { stack: 9700, bet: 0, committed: 300, folded: true, allIn: false, last: 11 },
  1: { stack: 1250, bet: 0, committed: 250, folded: false, allIn: true, last: 6 },
  2: { stack: 9700, bet: 0, committed: 300, folded: true, allIn: false, last: 12 },
  3: { stack: 10300, bet: 0, committed: 1700, folded: false, allIn: false, last: 13 },
  4: { stack: 10000, bet: 0, committed: 0, folded: true, allIn: false, last: 3 },
  5: { stack: 9300, bet: 0, committed: 700, folded: true, allIn: false, last: 14 },
};
const POSITIONS: Record<Seat, string> = { 0: 'BTN', 1: 'SB', 2: 'BB', 3: 'UTG', 4: 'UTG+1', 5: 'UTG+2' };

/** Which seats show cards to everyone after the hand: showdown seats (1, 3) and every bot dealt in (D16). */
const REVEALED_AFTER: readonly Seat[] = [1, 3, 4, 5];

function friendSeats(me: Seat, state: Record<Seat, SeatState> | null, revealed: readonly Seat[], status: Partial<Record<Seat, SeatStatus>> = {}, connected: Partial<Record<Seat, boolean>> = {}): PlayerViewShape['seats'] {
  return ([0, 1, 2, 3, 4, 5] as const).map((seat) => {
    const s = state?.[seat];
    const bot = BOTS[seat] ?? null;
    const occupant: Occupant = {
      kind: bot === null ? 'human' : 'bot',
      name: NAMES[seat],
      avatarSeed: 101 + seat,
      isHost: seat === 0,
      isMe: seat === me,
      status: status[seat] ?? HUMAN_STATUS,
      connected: connected[seat] ?? true,
      stack: s?.stack ?? 10000,
      bot,
      inHand:
        s === undefined
          ? null
          : {
              bet: s.bet,
              committed: s.committed,
              folded: s.folded,
              allIn: s.allIn,
              position: POSITIONS[seat],
              cards: revealed.includes(seat) ? (HOLE[seat] ?? null) : null,
              lastActionIndex: s.last,
            },
    };
    return { seat, occupant };
  });
}

function friendHand(street: Street, toAct: Seat | null, turnMs: number | null): HandView {
  const done = street === 'COMPLETE';
  return {
    handId: HAND_ID,
    no: 7,
    street,
    board: done ? BOARD : BOARD.slice(0, 3),
    buttonSeat: 0,
    sbSeat: 1,
    bbSeat: 2,
    // Pots hold chips from finished streets; current-street bets sit in front of each player (inHand.bet).
    pots: done
      ? [
          { amount: 1250, eligible: [1, 3] },
          { amount: 1000, eligible: [3] },
        ]
      : [
          { amount: 1250, eligible: [0, 1, 2, 3, 5] },
          { amount: 200, eligible: [0, 2, 3, 5] },
        ],
    currentBet: done ? 0 : 400,
    toAct,
    turnSeq: done ? 14 : 11,
    turnMs,
    actions: done ? [...PREFLOP, ...FLOP_TO_ME, ...REST] : [...PREFLOP, ...FLOP_TO_ME],
    startStacks: START_STACKS,
  };
}

const LEGAL_FACING_BET: LegalActions = {
  fold: true,
  check: false,
  call: { amount: 400, to: 400 },
  bet: null,
  raise: { minTo: 800, maxTo: 9700 },
  allIn: { to: 9700 },
  reopened: true,
};

const RESULT: HandResult = {
  handId: HAND_ID,
  pots: [
    { kind: 'main', amount: 1250, eligible: [1, 3], winners: [1], shares: [1250] },
    { kind: 'side', amount: 1000, eligible: [3], winners: [3], shares: [1000] },
  ],
  returned: [{ seat: 3, amount: 1000 }],
  // R12 order: the last aggressor (seat 3) shows first.
  showdown: [
    { seat: 3, cards: ['Ac', 'Kc'], rank: 'pair', best5: ['Ac', 'Ad', 'Kc', 'Qh', '9c'] },
    { seat: 1, cards: ['Qs', 'Qd'], rank: 'trips', best5: ['Qs', 'Qd', 'Qh', 'Ad', '9c'] },
  ],
  endStacks: ([0, 1, 2, 3, 4, 5] as const).map((seat) => ({ seat, stack: AFTER_HAND[seat].stack })),
  botReveals: [],
};

const RESULT_WITH_REVEALS: HandResult = {
  ...RESULT,
  botReveals: [
    {
      seat: 4,
      name: 'Rex',
      engine: 'rule',
      provider: null,
      model: null,
      style: 'aggressive',
      holeCards: ['Jc', 'Tc'],
      decisions: [
        {
          actionIndex: 3,
          street: 'PREFLOP',
          action: 'fold',
          amount: 0,
          thought: 'Suited connectors, but a raise and a caller behind me. Folding.',
          metrics: {
            equity: 0.284,
            opponents: 5,
            method: 'mc',
            samples: 1000,
            halfWidth95: 0.031,
            exact: false,
            potOdds: [550, 300],
            required: 0.353,
            spr: 22.2,
            position: 'UTG+1',
            inPosition: false,
          },
          fallback: false,
          fallbackCode: null,
        },
      ],
      chat: [],
    },
    {
      seat: 5,
      name: 'Lena',
      engine: 'llm',
      provider: 'openai',
      model: 'gpt-5-mini',
      style: 'tight',
      holeCards: ['8d', '8s'],
      decisions: [
        {
          actionIndex: 4,
          street: 'PREFLOP',
          action: 'call',
          amount: 300,
          thought: '(No AI reply -> rule decision)',
          metrics: null,
          fallback: true,
          fallbackCode: 'E-LLM-TIMEOUT',
        },
        {
          actionIndex: 10,
          street: 'FLOP',
          action: 'call',
          amount: 400,
          thought: 'Middle pair under an overcard. One call, then re-evaluate.',
          metrics: null,
          fallback: false,
          fallbackCode: null,
        },
        {
          actionIndex: 14,
          street: 'TURN',
          action: 'fold',
          amount: 0,
          thought: 'The ace on the turn hits the bettor. Letting it go.',
          metrics: {
            equity: 0.093,
            opponents: 1,
            method: 'exact',
            samples: null,
            halfWidth95: null,
            exact: true,
            potOdds: [3250, 1000],
            required: 0.235,
            spr: 9.3,
            position: 'UTG+2',
            inPosition: false,
          },
          fallback: false,
          fallbackCode: null,
        },
      ],
      chat: [{ actionIndex: 10, text: 'I will stick around for one more card.' }],
    },
  ],
};

const CHAT: ChatLine[] = [
  { id: 'c1', seat: 1, name: 'Kenji', kind: 'human', text: '<img src=x onerror=alert(1)>', sys: null, handId: HAND_ID, atMs: T0 - 9000 },
  { id: 'c2', seat: 5, name: 'Lena', kind: 'bot', text: 'I will stick around for one more card.', sys: null, handId: HAND_ID, atMs: T0 - 6000 },
  { id: 'c3', seat: null, name: 'Sora', kind: 'system', text: 'Sora joined', sys: { code: 'joined', name: 'Sora' }, handId: null, atMs: T0 - 60000 },
];

function room(kind: RoomKind, phase: RoomPhase, settings: RoomSettings, extra: Partial<PlayerViewShape['room']> = {}): PlayerViewShape['room'] {
  return {
    kind,
    phase,
    lang: 'en',
    settings,
    pendingSettings: null,
    locked: false,
    paused: false,
    closingAfterHand: false,
    handsPlayed: 6,
    countdownMs: null,
    hostSeat: 0,
    ...extra,
  };
}

function view(shape: PlayerViewShape): PlayerView {
  return shape as PlayerView;
}

/** Friend room on the flop, seen from `me`. Only the viewer's own hole cards are present. */
function friendFlopView(me: Seat, opts: { roomExtra?: Partial<PlayerViewShape['room']>; status?: Partial<Record<Seat, SeatStatus>>; connected?: Partial<Record<Seat, boolean>> } = {}): PlayerView {
  const myTurn = me === 0;
  return view({
    pv: '1',
    room: room('friend', 'IN_HAND', FRIEND_SETTINGS, { pendingSettings: { sb: 100, bb: 200 }, ...opts.roomExtra }),
    me: {
      role: me === 0 ? 'host' : 'player',
      seat: me,
      status: opts.status?.[me] ?? 'ACTIVE',
      holeCards: HOLE[me] ?? null,
      legal: myTurn ? LEGAL_FACING_BET : null,
      canRefill: false,
      timeoutStrikes: 0,
    },
    seats: friendSeats(me, ON_FLOP, [], opts.status, opts.connected),
    hand: friendHand('FLOP', 0, 24000),
    result: null,
    arena: null,
  });
}

function friendAfterView(me: Seat, countdownMs: number, result: HandResult): PlayerView {
  return view({
    pv: '1',
    room: room('friend', 'BETWEEN_HANDS', FRIEND_SETTINGS, { countdownMs }),
    me: { role: 'host', seat: me, status: 'ACTIVE', holeCards: HOLE[me] ?? null, legal: null, canRefill: false, timeoutStrikes: 0 },
    seats: friendSeats(me, AFTER_HAND, REVEALED_AFTER),
    hand: friendHand('COMPLETE', null, null),
    result,
    arena: null,
  });
}

function waitingView(me: Seat, seated: readonly Seat[]): PlayerView {
  const seats = friendSeats(me, null, []).map((s) => (seated.includes(s.seat as Seat) ? s : { seat: s.seat, occupant: null }));
  return view({
    pv: '1',
    room: room('friend', 'WAITING', FRIEND_SETTINGS, { handsPlayed: 0 }),
    me: { role: me === 0 ? 'host' : 'player', seat: me, status: 'ACTIVE', holeCards: null, legal: null, canRefill: false, timeoutStrikes: 0 },
    seats,
    hand: null,
    result: null,
    arena: null,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Practice: me (seat 0) + five rule bots. Button 3, SB 4, BB 5, so seat 0 opens preflop facing the big blind.
// The finished hand (COMPLETE) is "everyone folds to the big blind": BB wins the small blind, its unmatched
// 50 is returned, and every bot's cards are shown afterwards (D16) while mine stay mine.
// ---------------------------------------------------------------------------------------------------------------
const PRACTICE_BOTS = ['Ada', 'Rex', 'Kai', 'Lena', 'Bo'] as const;
const PRACTICE_STYLES = ['balanced', 'aggressive', 'tight', 'balanced', 'aggressive'] as const;
const PRACTICE_HOLE: [Card, Card] = ['Js', 'Jh'];
const PRACTICE_BOT_HOLE: [Card, Card][] = [
  ['9d', '4c'],
  ['Kh', '3s'],
  ['7c', '2h'],
  ['Td', '6s'],
  ['Ah', '5c'],
];
const PRACTICE_POSITIONS = ['UTG', 'UTG+1', 'UTG+2', 'BTN', 'SB', 'BB'] as const;
type PracticeStreet = 'PREFLOP' | 'COMPLETE' | 'VOIDED';

function practiceSeats(street: PracticeStreet): PlayerViewShape['seats'] {
  const done = street === 'COMPLETE';
  return [0, 1, 2, 3, 4, 5].map((seat) => {
    const bot =
      seat === 0
        ? null
        : { engine: 'rule' as const, provider: null, model: null, label: PRACTICE_BOTS[seat - 1]!, style: PRACTICE_STYLES[seat - 1]! };
    const blind = seat === 4 ? 50 : seat === 5 ? 100 : 0;
    // After the fold-around: SB lost 50, BB won it (its own extra 50 came back as `returned`).
    const stack = done ? 10000 + (seat === 4 ? -50 : seat === 5 ? 50 : 0) : street === 'PREFLOP' ? 10000 - blind : 10000;
    return {
      seat,
      occupant: {
        kind: bot === null ? 'human' : 'bot',
        name: seat === 0 ? 'Mina' : PRACTICE_BOTS[seat - 1]!,
        avatarSeed: 201 + seat,
        isHost: seat === 0,
        isMe: seat === 0,
        status: 'ACTIVE',
        connected: true,
        stack,
        bot,
        inHand:
          street === 'VOIDED'
            ? null
            : {
                bet: done ? 0 : blind,
                committed: done ? (seat === 4 ? 50 : seat === 5 ? 50 : 0) : blind,
                folded: done && seat !== 5,
                allIn: false,
                position: PRACTICE_POSITIONS[seat]!,
                cards: done && seat !== 0 ? PRACTICE_BOT_HOLE[seat - 1]! : null,
                lastActionIndex: done ? (seat === 5 ? 1 : seat + 2) : seat === 4 ? 0 : seat === 5 ? 1 : null,
              },
      },
    };
  });
}

const PRACTICE_LEGAL: LegalActions = {
  fold: true,
  check: false,
  call: { amount: 100, to: 100 },
  bet: null,
  raise: { minTo: 200, maxTo: 10000 },
  allIn: { to: 10000 },
  reopened: true,
};

const PRACTICE_BLINDS: ActionLogEntry[] = [log(0, 'PREFLOP', 4, 'post_sb', 50, 50), log(1, 'PREFLOP', 5, 'post_bb', 100, 100)];
const PRACTICE_FOLDS: ActionLogEntry[] = [0, 1, 2, 3, 4].map((seat, k) => log(2 + k, 'PREFLOP', seat as Seat, 'fold', seat === 4 ? 50 : 0, 0));

function practiceHand(street: PracticeStreet, turnMs: number | null): HandView {
  const done = street === 'COMPLETE';
  return {
    handId: 'pR4c7T1cE0hAnD2xYz9QwA',
    no: 3,
    street,
    board: [],
    buttonSeat: 3,
    sbSeat: 4,
    bbSeat: 5,
    pots: done ? [{ amount: 100, eligible: [5] }] : [],
    currentBet: street === 'PREFLOP' ? 100 : 0,
    toAct: street === 'PREFLOP' ? 0 : null,
    turnSeq: done ? 6 : 1,
    turnMs: street === 'PREFLOP' ? turnMs : null,
    actions: done ? [...PRACTICE_BLINDS, ...PRACTICE_FOLDS] : PRACTICE_BLINDS,
    startStacks: [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: 10000 })),
  };
}

const PRACTICE_RESULT: HandResult = {
  handId: 'pR4c7T1cE0hAnD2xYz9QwA',
  pots: [{ kind: 'main', amount: 100, eligible: [5], winners: [5], shares: [100] }],
  returned: [{ seat: 5, amount: 50 }],
  showdown: [],
  endStacks: [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: 10000 + (seat === 4 ? -50 : seat === 5 ? 50 : 0) })),
  botReveals: [],
};

function practiceView(opts: { settings?: RoomSettings; phase?: RoomPhase; paused?: boolean; turnMs?: number | null; street?: PracticeStreet }): PlayerView {
  const settings = opts.settings ?? PRACTICE_SETTINGS;
  const street = opts.street ?? 'PREFLOP';
  return view({
    pv: '1',
    room: room('practice', opts.phase ?? 'IN_HAND', settings, { paused: opts.paused ?? false, handsPlayed: 2 }),
    me: {
      role: 'host',
      seat: 0,
      status: 'ACTIVE',
      holeCards: street === 'VOIDED' ? null : PRACTICE_HOLE,
      legal: street === 'PREFLOP' ? PRACTICE_LEGAL : null,
      canRefill: false,
      timeoutStrikes: 0,
    },
    seats: practiceSeats(street),
    hand: practiceHand(street, opts.turnMs === undefined ? 52000 : opts.turnMs),
    // A hand that ended into PAUSED keeps its result on screen until the next hand starts (F-JN-05).
    result: street === 'COMPLETE' ? PRACTICE_RESULT : null,
    arena: null,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario table
// ---------------------------------------------------------------------------------------------------------------
interface Built {
  snapshot: ClientSnapshot;
  invite: InviteInfo | null;
}

function snapshot(over: Partial<ClientSnapshot>): ClientSnapshot {
  return {
    conn: { stage: 'ready', error: null, hostLost: null, reconnecting: false, hostTab: false },
    view: null,
    chat: [],
    notices: [],
    host: null,
    closed: null,
    alert: null,
    ...over,
  };
}

const HOST = { invite: INVITE, selfOnline: true };

function build(scenario: string): Built {
  switch (scenario) {
    case 'waiting':
      return { snapshot: snapshot({ view: waitingView(0, [0]), host: HOST }), invite: INVITE };
    case 'guest-waiting':
      return { snapshot: snapshot({ view: waitingView(1, [0, 1]) }), invite: INVITE };
    case 'my-turn':
      return {
        snapshot: snapshot({
          view: friendFlopView(0),
          chat: CHAT,
          notices: [{ code: 'N-BLINDS-NEXT', p: { sb: 100, bb: 200 }, atMs: T0 - 3000 }],
          host: HOST,
        }),
        invite: INVITE,
      };
    case 'showdown':
      return { snapshot: snapshot({ view: friendAfterView(0, 5000, RESULT), host: HOST }), invite: INVITE };
    case 'bot-reveal':
      return {
        snapshot: snapshot({ view: friendAfterView(0, 8000, RESULT_WITH_REVEALS), chat: [CHAT[1]!], host: HOST }),
        invite: INVITE,
      };
    case 'host-lost':
      return {
        snapshot: snapshot({
          view: friendFlopView(2),
          conn: { stage: 'host_lost', error: 'E-NET-HOST-LOST', hostLost: { startedAtMs: T0, deadlineMs: T0 + 30000 }, reconnecting: false, hostTab: false },
        }),
        invite: INVITE,
      };
    case 'closed':
      return {
        snapshot: snapshot({
          conn: { stage: 'closed', error: null, hostLost: null, reconnecting: false, hostTab: false },
          closed: {
            reason: 'host_closed',
            voidedHandId: null,
            handsPlayed: 7,
            seats: ([0, 1, 2, 3, 4, 5] as const).map((seat) => ({
              seat,
              name: NAMES[seat],
              kind: BOTS[seat] === undefined ? ('human' as const) : ('bot' as const),
              finalStack: AFTER_HAND[seat].stack,
            })),
            settings: FRIEND_SETTINGS,
          },
        }),
        invite: null,
      };
    case 'waiting-next':
      return { snapshot: snapshot({ view: friendFlopView(2, { status: { 2: 'WAITING_NEXT' } }) }), invite: INVITE };
    case 'sitting-out':
      return { snapshot: snapshot({ view: friendFlopView(2, { status: { 2: 'SITTING_OUT' } }) }), invite: INVITE };
    case 'refill': {
      const v = friendAfterView(0, 5000, RESULT);
      // My stack hit 0 in this hand (the stack fields say so; the rest of the fixture is the showdown hand). A
      // busted seat is SITTING_OUT from hand end on; a refill during the countdown sits it back in (R0 M1, D-P12).
      const seats = v.seats.map((s) => (s.seat === 0 && s.occupant ? { ...s, occupant: { ...s.occupant, stack: 0, status: 'SITTING_OUT' as const } } : s));
      const result = { ...RESULT, endStacks: RESULT.endStacks.map((e) => (e.seat === 0 ? { seat: 0, stack: 0 } : e)) };
      return {
        snapshot: snapshot({ view: view({ ...v, seats, result, me: { ...v.me, status: 'SITTING_OUT', canRefill: true } }), host: HOST }),
        invite: INVITE,
      };
    }
    case 'paused':
      return { snapshot: snapshot({ view: friendFlopView(0, { roomExtra: { paused: true } }), host: HOST }), invite: INVITE };
    case 'reconnecting':
      return {
        snapshot: snapshot({
          conn: { stage: 'reconnecting', error: null, hostLost: null, reconnecting: true, hostTab: false },
          view: friendFlopView(2, { connected: { 1: false } }),
        }),
        invite: INVITE,
      };
    case 'practice-my-turn':
      return { snapshot: snapshot({ view: practiceView({}) }), invite: null };
    case 'practice-no-limit':
      return { snapshot: snapshot({ view: practiceView({ settings: { ...PRACTICE_SETTINGS, turnSeconds: null }, turnMs: null }) }), invite: null };
    case 'practice-pausing':
      // A pending pause only exists during a hand (F-JN-05: between hands, Pause stops at once).
      return { snapshot: snapshot({ view: practiceView({ paused: true }) }), invite: null };
    case 'practice-paused':
      return { snapshot: snapshot({ view: practiceView({ phase: 'PAUSED', paused: true, street: 'COMPLETE', turnMs: null }) }), invite: null };
    case 'practice-busted': {
      // R0-L3: paused with my stack at 0 — RESUME and SIT in are dropped until a refill, so the screen offers the
      // refill CTA instead of Resume. Only my stack fields say "busted"; the rest is the practice-paused hand.
      const v = practiceView({ phase: 'PAUSED', paused: true, street: 'COMPLETE', turnMs: null });
      const seats = v.seats.map((s) => (s.seat === 0 && s.occupant ? { ...s, occupant: { ...s.occupant, stack: 0, status: 'SITTING_OUT' as const } } : s));
      const result = { ...PRACTICE_RESULT, endStacks: PRACTICE_RESULT.endStacks.map((e) => (e.seat === 0 ? { seat: 0, stack: 0 } : e)) };
      return { snapshot: snapshot({ view: view({ ...v, seats, result, me: { ...v.me, status: 'SITTING_OUT', canRefill: true } }) }), invite: null };
    }
    case 'alert':
      return {
        snapshot: snapshot({
          view: practiceView({ phase: 'PAUSED', paused: true, street: 'VOIDED', turnMs: null }),
          alert: { code: 'E-ENG-INVARIANT', atMs: T0 },
        }),
        invite: null,
      };
    case 'other-tab-host':
      return {
        snapshot: snapshot({ conn: { stage: 'failed', error: 'E-JOIN-OTHER-TAB', hostLost: null, reconnecting: false, hostTab: true } }),
        invite: null,
      };
    default:
      break;
  }
  if (scenario.startsWith('join-failed:')) {
    const code = scenario.slice('join-failed:'.length);
    if (!isJoinFailure(code)) throw new Error(`createFakeClient: join-failed takes an E-NET-* or E-JOIN-* code, got ${code}`);
    return {
      snapshot: snapshot({ conn: { stage: 'failed', error: code, hostLost: null, reconnecting: false, hostTab: false } }),
      invite: null,
    };
  }
  throw new Error(`createFakeClient: unknown scenario ${scenario}`);
}

function isJoinFailure(code: string): code is ErrorCode {
  return (code.startsWith('E-NET-') || code.startsWith('E-JOIN-')) && (ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Scenarios: see FAKE_SCENARIOS, plus `join-failed:<E-NET-*|E-JOIN-*>`. Throws on anything else.
 * Ack-returning methods resolve {ok: true}; nothing changes the snapshot.
 */
export function createFakeClient(scenario: string): FakeClient {
  const { snapshot: snap, invite } = build(scenario);
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const record = (method: string, args: readonly unknown[]): void => {
    calls.push({ method, args });
  };
  const ok = (method: string, args: readonly unknown[]) => {
    record(method, args);
    return Promise.resolve({ ok: true } as const);
  };
  return {
    calls,
    getSnapshot: () => snap,
    subscribe: (listener) => {
      record('subscribe', [listener]);
      return () => record('unsubscribe', []);
    },
    act: (action) => ok('act', [action]),
    sit: (mode) => record('sit', [mode]),
    refill: () => record('refill', []),
    leave: () => {
      record('leave', []);
      return Promise.resolve();
    },
    cancelWait: () => record('cancelWait', []),
    chat: (text) => ok('chat', [text]),
    inviteInfo: () => invite,
    dispose: () => record('dispose', []),
    start: () => ok('start', []),
    pause: () => record('pause', []),
    resume: () => record('resume', []),
    close: (mode) => record('close', [mode]),
    lock: (on) => record('lock', [on]),
    kick: (seat) => record('kick', [seat]),
    setBlinds: (sb, bb) => record('setBlinds', [sb, bb]),
    setOption: (opt) => record('setOption', [opt]),
    addBot: (seat, spec) => ok('addBot', [seat, spec]),
    updateBot: (seat, spec) => ok('updateBot', [seat, spec]),
    removeBot: (seat) => ok('removeBot', [seat]),
    invite: () => {
      record('invite', []);
      return INVITE;
    },
  };
}
