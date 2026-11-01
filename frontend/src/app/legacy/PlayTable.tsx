import { useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Settings, Users, Info, Trophy, Clock, Coins, Target, X, Plus, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getCurrentAuth, getCurrentUserId } from "../auth";
import { apiFetch } from "../api";
import { audioManager } from "../audio";
import { useI18n } from "../i18n";

type Position = number; // Used as seat index
type Role = "BTN" | "SB" | "BB" | "UTG" | "MP" | "HJ" | "CO" | "UTG+1" | "UTG+2" | "UTG+3" | "UTG+4" | "UTG+5" | "BTN/SB";
type GamePhase = "init" | "dealing" | "preflop" | "flop_deal" | "flop" | "turn_deal" | "turn" | "river_deal" | "river" | "showdown";
type HandScore = { category: number; values: number[] };

interface Player {
  id: string;
  name: string;
  pos: Position;
  role: Role;
  avatarSeed: string;
  avatarUrl?: string;
  chips: number;
  bet: number;
  status: "active" | "folded";
  allIn?: boolean;
  cardsDealt: boolean;
  holeCards: string[];
  seatId?: number;
}

type LiveActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
type ActionFxType = "check" | "call" | "bet" | "raise" | "fold" | "all-in";

interface PersistentAggroFx {
  playerId: string;
  handId: string;
  street: string;
  type: "bet" | "raise";
  maxBetAmount: number;
}

interface LiveParticipant {
  seatId: number;
  playerId: string;
  userId?: string;
  roleType?: "human" | "bot";
  displayName: string;
  stackAmount: number;
  currentBetAmount: number;
  folded: boolean;
  sittingOut?: boolean;
  allIn?: boolean;
  holeCards: string[];
  avatarInfo?: {
    hairStyle: string;
    skinTone: string;
    hairColor: string;
    faceType: string;
    eyeType: string;
    mouthType: string;
    outfit: string;
  } | null;
}

interface LiveSeat {
  seatId: number;
  participant: LiveParticipant | null;
}

interface LivePendingJoin {
  userId: string;
  displayName: string;
  preferredSeatId?: number;
  createdAt: string;
}

interface SocialFriendSummary {
  id: string;
  nickname: string;
  role: "guest" | "free" | "pro";
}

interface LiveRoom {
  id: string;
  type: "ai_bot" | "cash" | "tournament";
  status: string;
  hostUserId: string;
  isPrivate: boolean;
  hasBeenPublic: boolean;
  maxSeats: number;
  blindSmall: number;
  blindBig: number;
  seats: LiveSeat[];
  pendingJoins?: LivePendingJoin[];
}
type BotStyle = "balanced" | "aggressive" | "tight";

interface BotModelOption {
  id: string;
  label: string;
  provider: "local" | "openai" | "claude" | "gemini";
  modelTier: "free" | "paid" | "random";
  model: string;
  proOnly?: boolean;
}

const BOT_MODEL_OPTIONS: BotModelOption[] = [
  {
    id: "random-custom",
    label: "Custom RNG Policy (No LLM)",
    provider: "local",
    modelTier: "random",
    model: "custom-rng-v1",
  },
  {
    id: "local-qwen",
    label: "Local Qwen3 8B",
    provider: "local",
    modelTier: "free",
    model: "qwen3:8b",
  },
  {
    id: "local-qwen25",
    label: "Local Qwen 2.5 Coder",
    provider: "local",
    modelTier: "free",
    model: "qwen2.5-coder:3b",
  },
  {
    id: "openai-gpt41-mini",
    label: "OpenAI GPT-4.1 mini",
    provider: "openai",
    modelTier: "paid",
    model: "gpt-4.1-mini",
    proOnly: true,
  },
  {
    id: "claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet",
    provider: "claude",
    modelTier: "paid",
    model: "claude-3-5-sonnet-latest",
    proOnly: true,
  },
  {
    id: "gemini-1-5-pro",
    label: "Gemini 1.5 Pro",
    provider: "gemini",
    modelTier: "paid",
    model: "gemini-1.5-pro",
    proOnly: true,
  },
];

interface LiveGameState {
  handId: string;
  street: string;
  boardCards: string[];
  actions?: Array<{
    order: number;
    seatId: number;
    playerId: string;
    action: LiveActionType;
    amount: number;
    potAfter: number;
    street: string;
  }>;
  currentTurnSeatId: number | null;
  minCallAmount: number;
  minRaiseAmount: number;
  maxBetAmount: number;
  potAmount: number;
  positions: Record<string, string>;
  winnerPlayerIds?: string[];
}

interface LiveGameSnapshot {
  roomStatus: string;
  gameState: LiveGameState | null;
}

const SUIT_MAP: Record<string, string> = {
  S: "\u2660",
  H: "\u2665",
  D: "\u2666",
  C: "\u2663",
};

function toUiCard(card: string) {
  if (card.length < 2) return card;
  const rank = card.slice(0, -1);
  const suit = card.slice(-1).toUpperCase();
  return `${rank}${SUIT_MAP[suit] ?? suit}`;
}

function toUiRole(label?: string): Role {
  if (label === "BTN" || label === "SB" || label === "BB" || label === "UTG" || label === "MP" || label === "HJ" || label === "CO" || label === "UTG+1" || label === "UTG+2" || label === "UTG+3" || label === "UTG+4" || label === "UTG+5" || label === "BTN/SB") {
    return label;
  }
  return "UTG";
}

function toAvatarUrl(seed: string, avatar?: LiveParticipant["avatarInfo"]): string {
  const params = new URLSearchParams({ seed });
  if (avatar) {
    params.set("top", avatar.hairStyle);
    params.set("skinColor", avatar.skinTone);
    params.set("hairColor", avatar.hairColor);
    params.set("clothing", avatar.outfit);
    params.set("mouth", avatar.mouthType);
    params.set("eyes", avatar.eyeType);
    params.set("eyebrows", avatar.faceType);
  }
  return `https://api.dicebear.com/7.x/avataaars/svg?${params.toString()}`;
}

function toUiPhase(_roomStatus: string, street?: string): GamePhase {
  if (street === "RESULT" || street === "SHOWDOWN") {
    return "showdown";
  }
  if (street === "RIVER") return "river";
  if (street === "TURN") return "turn";
  if (street === "FLOP") return "flop";
  if (street === "PREFLOP") return "preflop";
  return "init";
}

function toPhaseFromBoardCount(boardCount: number): GamePhase {
  if (boardCount >= 5) return "river";
  if (boardCount === 4) return "turn";
  if (boardCount >= 3) return "flop";
  return "preflop";
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function samePlayers(prev: Player[], next: Player[]) {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.pos !== b.pos ||
      a.role !== b.role ||
      a.avatarSeed !== b.avatarSeed ||
      a.avatarUrl !== b.avatarUrl ||
      a.chips !== b.chips ||
      a.bet !== b.bet ||
      a.status !== b.status ||
      Boolean(a.allIn) !== Boolean(b.allIn) ||
      a.cardsDealt !== b.cardsDealt ||
      a.seatId !== b.seatId ||
      !sameStringArray(a.holeCards, b.holeCards)
    ) {
      return false;
    }
  }
  return true;
}

function samePendingJoins(a: LivePendingJoin[] | undefined, b: LivePendingJoin[] | undefined) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const x = left[i];
    const y = right[i];
    if (
      x.userId !== y.userId ||
      x.displayName !== y.displayName ||
      x.preferredSeatId !== y.preferredSeatId ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  return true;
}

const getInitialPlayers = (count: number, max: number): Player[] => {
  const all: Player[] = [
    { id: "hero", name: "YOU", pos: 0, role: "SB", avatarSeed: "You", chips: 10420, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p1", name: "AI Bot 1", pos: 1, role: "BB", avatarSeed: "Felix", chips: 12000, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p2", name: "AI Bot 2", pos: 2, role: "UTG", avatarSeed: "Aneka", chips: 9800, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p3", name: "AI Bot 3", pos: 3, role: "BTN", avatarSeed: "Oliver", chips: 8500, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p4", name: "AI Bot 4", pos: 4, role: "MP", avatarSeed: "Jasper", chips: 11000, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p5", name: "AI Bot 5", pos: 5, role: "HJ", avatarSeed: "Zoe", chips: 9200, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p6", name: "AI Bot 6", pos: 6, role: "CO", avatarSeed: "Luna", chips: 10500, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p7", name: "AI Bot 7", pos: 7, role: "UTG+1", avatarSeed: "Max", chips: 8800, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
    { id: "p8", name: "AI Bot 8", pos: 8, role: "UTG+2", avatarSeed: "Leo", chips: 9500, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
  ];
  
  if (count === 4 && max === 4) {
      // Keep hardcoded positions for 4-player classic layout
      return [
        { id: "p1", name: "AI Bot 1", pos: 2, role: "UTG", avatarSeed: "Felix", chips: 12000, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
        { id: "p2", name: "AI Bot 2", pos: 1, role: "BB", avatarSeed: "Aneka", chips: 9800, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
        { id: "p3", name: "AI Bot 3", pos: 3, role: "BTN", avatarSeed: "Oliver", chips: 8500, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
        { id: "hero", name: "YOU", pos: 0, role: "SB", avatarSeed: "You", chips: 10420, bet: 0, status: "active", cardsDealt: false, holeCards: [] },
      ];
  }
  
  const actualCount = Math.min(count, max, 9);
  const selected = all.slice(0, actualCount);
  
  // Distribute players evenly around the table if it's not fully packed
  return selected.map((p, idx) => ({ ...p, pos: Math.floor(idx * (max / actualCount)) }));
};

const FULL_COMMUNITY_CARDS = ["Q♠", "J♠", "10♠", "2♥", "5♣"];
const HERO_CARDS = ["A♠", "K♠"];
const TURN_TIMER_SECONDS = 15;
const SHOWDOWN_RESULT_DISPLAY_MS = 12000;
const SHOWDOWN_RESULT_DISPLAY_HUMAN_MS = 21000;
const SHOWDOWN_RESULT_DISPLAY_AI_BOT_MS = 18000;
const QUICK_RESULT_DISPLAY_MS = 12000;
const QUICK_RESULT_DISPLAY_AI_BOT_MS = 18000;
const HAND_RESET_CLEANUP_MS = 5000;
const LIVE_SYNC_INTERVAL_MS = 600;
const ACTION_FX_DURATION_MS = 1000;
const SHOWDOWN_AFTER_ACTION_DELAY_MS = 800;

const AVATAR_TOP_OPTIONS = ["shortFlat", "shortCurly", "straight01", "longButNotTooLong", "bob", "hat", "hijab", "turban"];
const AVATAR_OUTFIT_OPTIONS = ["hoodie", "blazerAndShirt", "blazerAndSweater", "graphicShirt", "shirtCrewNeck", "shirtVNeck"];
const AVATAR_EYE_OPTIONS = ["default", "happy", "wink", "surprised", "squint"];
const AVATAR_MOUTH_OPTIONS = ["smile", "default", "serious", "sad", "twinkle"];
const AVATAR_FACE_OPTIONS = ["default", "defaultNatural", "raisedExcited", "sadConcerned", "upDown"];
const AVATAR_SKIN_COLORS = ["ffdbb4", "edb98a", "d08b5b", "ae5d29", "614335", "fd9841", "f8d25c"];
const AVATAR_HAIR_COLORS = ["2c1b18", "a55728", "724133", "d6b370", "c93305", "f59797", "e8e1e1"];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function createRandomAvatarInfo(): NonNullable<LiveParticipant["avatarInfo"]> {
  return {
    hairStyle: pickRandom(AVATAR_TOP_OPTIONS),
    skinTone: pickRandom(AVATAR_SKIN_COLORS),
    hairColor: pickRandom(AVATAR_HAIR_COLORS),
    faceType: pickRandom(AVATAR_FACE_OPTIONS),
    eyeType: pickRandom(AVATAR_EYE_OPTIONS),
    mouthType: pickRandom(AVATAR_MOUTH_OPTIONS),
    outfit: pickRandom(AVATAR_OUTFIT_OPTIONS),
  };
}

function getLiveShowdownDisplayMs(room: LiveRoom): number {
  if (room.type === "ai_bot") {
    return SHOWDOWN_RESULT_DISPLAY_AI_BOT_MS;
  }

  const humanCount = room.seats.reduce((count, seat) => {
    const participant = seat.participant;
    if (!participant) return count;
    const isHuman = participant.roleType === "human" || Boolean(participant.userId);
    return isHuman ? count + 1 : count;
  }, 0);

  return humanCount >= 2 ? SHOWDOWN_RESULT_DISPLAY_HUMAN_MS : SHOWDOWN_RESULT_DISPLAY_MS;
}

const RAW_SUITS = ["S", "H", "D", "C"];
const RAW_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

function createRawDeck(): string[] {
  return RAW_SUITS.flatMap((suit) => RAW_RANKS.map((rank) => `${rank}${suit}`));
}

function parseRawRank(rankToken: string): number {
  if (rankToken === "A") return 14;
  if (rankToken === "K") return 13;
  if (rankToken === "Q") return 12;
  if (rankToken === "J") return 11;
  if (rankToken === "T") return 10;
  const parsed = Number.parseInt(rankToken, 10);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function parseRawCard(card: string): { rank: number; suit: string } {
  const suit = card.slice(-1).toUpperCase();
  const rankToken = card.slice(0, -1).toUpperCase();
  return {
    rank: parseRawRank(rankToken),
    suit,
  };
}

function straightHigh(ranks: number[]): number | null {
  const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
  if (unique.includes(14)) {
    unique.push(1);
  }

  for (let i = 0; i <= unique.length - 5; i += 1) {
    const start = unique[i];
    let ok = true;
    for (let step = 1; step < 5; step += 1) {
      if (!unique.includes(start - step)) {
        ok = false;
        break;
      }
    }
    if (ok) return start === 1 ? 5 : start;
  }

  return null;
}

function evaluateFive(cards: string[]): HandScore {
  const parsed = cards.map(parseRawCard);
  const ranks = parsed.map((card) => card.rank).sort((a, b) => b - a);
  const suits = parsed.map((card) => card.suit);

  const flush = suits.every((suit) => suit === suits[0]);
  const straight = straightHigh(ranks);

  const rankCounts = new Map<number, number>();
  for (const rank of ranks) {
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  const groups = Array.from(rankCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (flush && straight) return { category: 8, values: [straight] };
  if (groups[0]?.[1] === 4) return { category: 7, values: [groups[0][0], groups[1][0]] };
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) return { category: 6, values: [groups[0][0], groups[1][0]] };
  if (flush) return { category: 5, values: ranks };
  if (straight) return { category: 4, values: [straight] };

  if (groups[0]?.[1] === 3) {
    const trips = groups[0][0];
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a);
    return { category: 3, values: [trips, ...kickers] };
  }

  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups.find((group) => group[1] === 1)?.[0] ?? 0;
    return { category: 2, values: [highPair, lowPair, kicker] };
  }

  if (groups[0]?.[1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a);
    return { category: 1, values: [pair, ...kickers] };
  }

  return { category: 0, values: ranks };
}

function compareScore(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < length; i += 1) {
    const av = a.values[i] ?? 0;
    const bv = b.values[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function chooseFive(cards: string[]): string[][] {
  const combinations: string[][] = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            combinations.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return combinations;
}

function bestScore(cards: string[]): HandScore {
  const combinations = chooseFive(cards);
  let best = evaluateFive(combinations[0]);
  for (let i = 1; i < combinations.length; i += 1) {
    const current = evaluateFive(combinations[i]);
    if (compareScore(current, best) > 0) {
      best = current;
    }
  }
  return best;
}

function handScoreLabel(score: HandScore): string {
  if (score.category === 8) {
    return score.values[0] === 14 ? "Royal Flush" : "Straight Flush";
  }
  if (score.category === 7) return "Four of a Kind";
  if (score.category === 6) return "Full House";
  if (score.category === 5) return "Flush";
  if (score.category === 4) return "Straight";
  if (score.category === 3) return "Three of a Kind";
  if (score.category === 2) return "Two Pair";
  if (score.category === 1) return "One Pair";
  return "High Card";
}

function estimateHeroWinRate(params: {
  heroCards: string[];
  boardCards: string[];
  opponents: number;
  iterations?: number;
}): number | null {
  const { heroCards, boardCards, opponents, iterations = 260 } = params;
  if (heroCards.length < 2 || opponents < 1 || boardCards.length > 5) {
    return null;
  }

  const hero = heroCards.slice(0, 2);
  const knownBoard = boardCards.slice(0, 5);
  const known = new Set([...hero, ...knownBoard]);
  const baseDeck = createRawDeck().filter((card) => !known.has(card));
  const boardNeed = Math.max(0, 5 - knownBoard.length);
  const need = opponents * 2 + boardNeed;
  if (baseDeck.length < need) {
    return null;
  }

  let point = 0;
  let total = 0;

  for (let t = 0; t < iterations; t += 1) {
    const selected: string[] = [];
    const used = new Set<number>();

    while (selected.length < need) {
      const idx = Math.floor(Math.random() * baseDeck.length);
      if (used.has(idx)) continue;
      used.add(idx);
      selected.push(baseDeck[idx]);
    }

    const runout = selected.slice(0, boardNeed);
    const board5 = [...knownBoard, ...runout];
    const heroScore = bestScore([...hero, ...board5]);

    let heroRank = 1;
    let tieCount = 1;
    for (let opp = 0; opp < opponents; opp += 1) {
      const start = boardNeed + opp * 2;
      const oppHand = [selected[start], selected[start + 1]];
      const score = bestScore([...oppHand, ...board5]);
      const compared = compareScore(score, heroScore);
      if (compared > 0) {
        heroRank = 0;
      } else if (compared === 0) {
        tieCount += 1;
      }
    }

    if (heroRank === 1) {
      point += 1 / tieCount;
    }
    total += 1;
  }

  if (total === 0) return null;
  return Math.round((point / total) * 1000) / 10;
}

function ChipStack({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  const numChips = Math.min(6, Math.ceil(amount / 50));
  
  return (
    <div className="relative w-8 h-8 flex flex-col items-center justify-center animate-in zoom-in duration-300">
      {Array.from({ length: numChips }).map((_, i) => (
        <div
          key={i}
          className="absolute w-5 h-5 md:w-6 md:h-6 rounded-full border border-dashed border-white/50 bg-yellow-500 shadow-md"
          style={{ bottom: i * 4, zIndex: i }}
        />
      ))}
      <div className="absolute -bottom-5 bg-black/80 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-black text-white whitespace-nowrap z-20 border border-white/10">
        ${amount}
      </div>
    </div>
  );
}

function TimerRing({ isActive, duration = TURN_TIMER_SECONDS, resetToken }: { isActive: boolean; duration?: number; resetToken: string }) {
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    if (!isActive) return;
    setTimeLeft(duration);
    const interval = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 0.1 : 0));
    }, 100);
    return () => clearInterval(interval);
  }, [isActive, duration, resetToken]);

  if (!isActive) return null;

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / duration) * circumference;
  const isDanger = timeLeft <= 5;

  return (
    <svg className="absolute -inset-[6px] w-[calc(100%+12px)] h-[calc(100%+12px)] -rotate-90 pointer-events-none z-0">
      <circle cx="50%" cy="50%" r={radius} fill="transparent" stroke="rgba(0,0,0,0.5)" strokeWidth="6" />
      <circle
        cx="50%" cy="50%" r={radius} fill="transparent"
        stroke={isDanger ? "#EF4444" : "#06B6D4"}
        strokeWidth="6" strokeDasharray={circumference} strokeDashoffset={circumference - progress}
        strokeLinecap="round" className="transition-all duration-100 ease-linear"
      />
    </svg>
  );
}

export function PlayTable() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { isPro } = getCurrentAuth();
  const currentUserId = getCurrentUserId();
  
  const isTournament = location.state?.mode === "tournament";
  const queryRoomId = new URLSearchParams(location.search).get("roomId")?.trim() ?? "";
  const stateRoomId = typeof location.state?.roomId === "string" ? (location.state.roomId as string).trim() : "";
  const roomId = queryRoomId || stateRoomId;
  const isLiveMode = !isTournament && roomId.length > 0;
  const isSpectatingStart = location.state?.spectate === true;
  const numPlayers = location.state?.table?.players || 4;
  const maxPlayers = location.state?.table?.max || numPlayers;
  
  const [phase, setPhase] = useState<GamePhase>("init");
  const [players, setPlayers] = useState<Player[]>(() =>
    isLiveMode ? [] : getInitialPlayers(numPlayers, maxPlayers),
  );
  const [gameStarted, setGameStarted] = useState(false);
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [pot, setPot] = useState(0);
  const [communityCards, setCommunityCards] = useState<string[]>([]);
  const [log, setLog] = useState<string>("Waiting to start...");
  const [heroEquity, setHeroEquity] = useState<number | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [winningCards, setWinningCards] = useState<string[]>([]);
  const [winningHandRank, setWinningHandRank] = useState<string | null>(null);
  const [showdownHoldUntil, setShowdownHoldUntil] = useState(0);
  const showdownHoldUntilRef = useRef(0);
  const lastResultHandIdRef = useRef<string | null>(null);
  const [liveRoom, setLiveRoom] = useState<LiveRoom | null>(null);
  const [liveGame, setLiveGame] = useState<LiveGameSnapshot | null>(null);
  const [heroSeatId, setHeroSeatId] = useState<number | null>(null);
  const [pendingHeroAction, setPendingHeroAction] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [botModelId, setBotModelId] = useState<string>("random-custom");
  const [botStyle, setBotStyle] = useState<BotStyle>("balanced");
  const lastAnimatedLiveHandIdRef = useRef<string | null>(null);
  const autoNextHandKeyRef = useRef<string | null>(null);
  const lastSeenLiveActionKeyRef = useRef<string | null>(null);
  const [actionFxByPlayer, setActionFxByPlayer] = useState<Record<string, { type: ActionFxType; expiresAt: number }>>({});
  const [persistentAggroFx, setPersistentAggroFx] = useState<PersistentAggroFx | null>(null);
  const [showdownDelayUntil, setShowdownDelayUntil] = useState(0);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteFriends, setInviteFriends] = useState<SocialFriendSummary[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState("");
  const prevHeroDealtRef = useRef(false);
  const prevCommunityCountRef = useRef<number | null>(null);
  const prevWinnerRef = useRef<string | null>(null);

  // Raise Action State
  const [isRaising, setIsRaising] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState<string>("");

  // Manage user sitting status
  const [userState, setUserState] = useState<"playing" | "spectating" | "waiting" | "eliminated">(isSpectatingStart ? "spectating" : "playing");

  // Tournament States
  const [tourneyPlayersLeft, setTourneyPlayersLeft] = useState(100);
  const [tourneyStage, setTourneyStage] = useState<"Starting Table" | "In The Money (ITM)" | "Semi-Final Table" | "Final Table">("Starting Table");
  const [isTableBreaking, setIsTableBreaking] = useState(false);
  const [nextStageName, setNextStageName] = useState("");
  const tableSeatCount = isLiveMode ? (liveRoom?.maxSeats ?? maxPlayers) : maxPlayers;
  const isRoomHost = Boolean(currentUserId) && liveRoom?.hostUserId === currentUserId;
  const canManageLiveRoom = !isLiveMode || (isRoomHost && !!liveRoom?.isPrivate && !liveRoom?.hasBeenPublic);
  const liveActivePlayers =
    liveRoom?.seats.filter((seat) => seat.participant && !seat.participant.sittingOut).length ?? 0;
  const inferredMode = location.state?.mode === "bot"
    ? "ai_bot"
    : (location.state?.mode === "cash" || location.state?.mode === "cash-game")
      ? "cash"
      : location.state?.mode === "tournament"
        ? "tournament"
        : null;
  const roomMode = liveRoom?.type ?? inferredMode;
  const canAddBotToRoom = roomMode === "ai_bot";
  const canSendPrivateInvite = Boolean(isLiveMode && liveRoom?.isPrivate && !liveRoom?.hasBeenPublic);
  const canConvertToPublic = Boolean(isLiveMode && canManageLiveRoom && liveRoom?.isPrivate && !liveRoom?.hasBeenPublic);
  const tableModeLabel = roomMode === "ai_bot"
    ? t("AI Bot Game")
    : roomMode === "cash"
      ? t("Cash Game")
      : t("Game Table");
  const autoContinueBotRoom = Boolean(
    isLiveMode && roomMode === "ai_bot" && liveRoom?.isPrivate,
  );
  const isHeroLiveTurn = Boolean(
    isLiveMode &&
    heroSeatId !== null &&
    liveGame?.gameState?.currentTurnSeatId === heroSeatId &&
    !pendingHeroAction,
  );
  const isHeroActionTurn = userState === "playing" && (isLiveMode ? isHeroLiveTurn : activeTurn === "hero");
  const liveLatestAction = liveGame?.gameState?.actions?.[liveGame.gameState.actions.length - 1];
  const isLiveHandEndedByFold = Boolean(
    isLiveMode &&
    liveGame?.gameState?.street === "RESULT" &&
    liveLatestAction?.action === "fold",
  );
  const isLiveResultStreet = Boolean(
    isLiveMode &&
    (liveGame?.gameState?.street === "SHOWDOWN" || liveGame?.gameState?.street === "RESULT"),
  );
  const isShowdownRevealBlocked =
    isLiveMode && isLiveResultStreet && Date.now() < showdownDelayUntil;
  const isCardRevealPhase = isLiveMode
    ? ((liveGame?.gameState?.street === "SHOWDOWN" ||
      (liveGame?.gameState?.street === "RESULT" && !isLiveHandEndedByFold)) &&
      !isShowdownRevealBlocked)
    : phase === "showdown";
  const isShowdownDisplayActive = phase === "showdown" || (winner !== null && Date.now() < showdownHoldUntil);
  const turnTimerResetToken = isLiveMode
    ? `${liveGame?.gameState?.handId ?? "no-hand"}:${liveGame?.gameState?.street ?? "no-street"}:${liveGame?.gameState?.currentTurnSeatId ?? "none"}:${liveGame?.gameState?.minCallAmount ?? 0}:${liveGame?.gameState?.maxBetAmount ?? 0}`
    : `${phase}:${activeTurn ?? "none"}`;
  const heroPlayer = players.find((player) => player.id === "hero");
  const parsedRaiseAmount = Number.parseInt(raiseAmount, 10);
  const normalizedRaiseAmount = Number.isFinite(parsedRaiseAmount)
    ? Math.max(0, Math.floor(parsedRaiseAmount))
    : 0;
  const liveMinRaiseTo = isLiveMode && liveGame?.gameState
    ? (liveGame.gameState.maxBetAmount > 0
      ? liveGame.gameState.maxBetAmount + Math.max(liveGame.gameState.minRaiseAmount, liveRoom?.blindBig ?? 0)
      : Math.max(liveGame.gameState.minRaiseAmount, liveRoom?.blindBig ?? 1))
    : 0;
  const canConfirmRaise = isLiveMode
    ? normalizedRaiseAmount > 0 && !actionBusy && normalizedRaiseAmount >= liveMinRaiseTo
    : normalizedRaiseAmount > 0 && !actionBusy;

  useEffect(() => {
    showdownHoldUntilRef.current = showdownHoldUntil;
  }, [showdownHoldUntil]);

  const triggerActionFx = (playerId: string, type: ActionFxType) => {
    const expiresAt = Date.now() + ACTION_FX_DURATION_MS;
    setActionFxByPlayer((prev) => ({
      ...prev,
      [playerId]: { type, expiresAt },
    }));

    setTimeout(() => {
      setActionFxByPlayer((prev) => {
        const current = prev[playerId];
        if (!current || current.expiresAt !== expiresAt) return prev;
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    }, ACTION_FX_DURATION_MS + 40);
  };

  useEffect(() => {
    if (!isLiveMode) {
      setPendingHeroAction(false);
      setPersistentAggroFx(null);
      return;
    }

    const nextTurnSeatId = liveGame?.gameState?.currentTurnSeatId ?? null;
    if (heroSeatId !== null && nextTurnSeatId !== heroSeatId) {
      setPendingHeroAction(false);
    }
  }, [isLiveMode, heroSeatId, liveGame?.gameState?.currentTurnSeatId]);

  useEffect(() => {
    if (!isLiveMode || !autoContinueBotRoom || !canManageLiveRoom) return;

    if (liveRoom?.status !== "HAND_ENDED") {
      autoNextHandKeyRef.current = null;
      return;
    }

    if (heroSeatId === null || userState !== "playing") return;

    const handKey = `${roomId}:${liveGame?.gameState?.handId ?? "ended"}`;
    if (autoNextHandKeyRef.current === handKey) return;
    autoNextHandKeyRef.current = handKey;

    const timer = setTimeout(() => {
      void handleLiveStartOrNext();
    }, QUICK_RESULT_DISPLAY_AI_BOT_MS);

    return () => clearTimeout(timer);
  }, [
    isLiveMode,
    autoContinueBotRoom,
    canManageLiveRoom,
    liveRoom?.status,
    heroSeatId,
    userState,
    roomId,
    liveGame?.gameState?.handId,
  ]);

  useEffect(() => {
    if (showdownHoldUntil <= 0) return;

    const clearResultVisuals = () => {
      setWinner((prev) => (prev === null ? prev : null));
      setWinningCards((prev) => (prev.length === 0 ? prev : []));
      setWinningHandRank((prev) => (prev === null ? prev : null));
      lastResultHandIdRef.current = null;
      showdownHoldUntilRef.current = 0;
      setShowdownHoldUntil((prev) => (prev === 0 ? prev : 0));
    };

    const remaining = showdownHoldUntil - Date.now();
    if (remaining <= 0) {
      clearResultVisuals();
      return;
    }

    const timer = setTimeout(() => {
      clearResultVisuals();
    }, remaining + 20);

    return () => clearTimeout(timer);
  }, [showdownHoldUntil]);

  useEffect(() => {
    if (showdownDelayUntil <= 0) return;
    const remaining = showdownDelayUntil - Date.now();
    if (remaining <= 0) {
      setShowdownDelayUntil(0);
      return;
    }

    const timer = setTimeout(() => {
      setShowdownDelayUntil(0);
    }, remaining + 20);

    return () => clearTimeout(timer);
  }, [showdownDelayUntil]);

  const syncLiveTable = async () => {
    if (!isLiveMode) return;

    try {
      let game: LiveGameSnapshot | null = null;
      try {
        game = await apiFetch<LiveGameSnapshot>(`/game/rooms/${roomId}/state`);
      } catch {
        game = null;
      }

      const room = await apiFetch<LiveRoom>(`/rooms/${roomId}`);
      const nextHandId = game?.gameState?.handId ?? null;
      const shouldAnimateDeal = Boolean(
        nextHandId && nextHandId !== lastAnimatedLiveHandIdRef.current,
      );
      if (shouldAnimateDeal && nextHandId) {
        lastAnimatedLiveHandIdRef.current = nextHandId;
      }

      setLiveRoom((prev) => {
        const prevSeats = prev?.seats ?? [];
        const nextSeats = room.seats;
        if (
          prev &&
          prev.id === room.id &&
          prev.type === room.type &&
          prev.status === room.status &&
          prev.hostUserId === room.hostUserId &&
          prev.isPrivate === room.isPrivate &&
          prev.hasBeenPublic === room.hasBeenPublic &&
          prev.maxSeats === room.maxSeats &&
          prev.blindSmall === room.blindSmall &&
          prev.blindBig === room.blindBig &&
          samePendingJoins(prev.pendingJoins, room.pendingJoins) &&
          prevSeats.length === nextSeats.length &&
          prevSeats.every((seat, idx) => {
            const nextSeat = nextSeats[idx];
            if (seat.seatId !== nextSeat.seatId) return false;
            const p = seat.participant;
            const n = nextSeat.participant;
            if (!p && !n) return true;
            if (!p || !n) return false;
            return (
              p.seatId === n.seatId &&
              p.playerId === n.playerId &&
              p.userId === n.userId &&
              p.displayName === n.displayName &&
              p.stackAmount === n.stackAmount &&
              p.currentBetAmount === n.currentBetAmount &&
              p.folded === n.folded &&
              Boolean(p.sittingOut) === Boolean(n.sittingOut) &&
              sameStringArray(p.holeCards, n.holeCards)
            );
          })
        ) {
          return prev;
        }
        return room;
      });
      setLiveGame((prev) => {
        if (!prev && !game) return prev;
        if (!prev || !game) return game;

        const prevState = prev.gameState;
        const nextState = game.gameState;
		if (!prevState && !nextState) {
			return prev;
		}
		if (!prevState || !nextState) {
			return game;
		}
        if (
          prev.roomStatus === game.roomStatus &&
          prevState.handId === nextState.handId &&
          prevState.street === nextState.street &&
          (prevState.actions?.length ?? 0) === (nextState.actions?.length ?? 0) &&
          (prevState.actions?.[prevState.actions.length - 1]?.action ?? "") ===
            (nextState.actions?.[nextState.actions.length - 1]?.action ?? "") &&
          prevState.currentTurnSeatId === nextState.currentTurnSeatId &&
          prevState.minCallAmount === nextState.minCallAmount &&
          prevState.minRaiseAmount === nextState.minRaiseAmount &&
          prevState.maxBetAmount === nextState.maxBetAmount &&
          prevState.potAmount === nextState.potAmount &&
          sameStringArray(prevState.boardCards, nextState.boardCards)
        ) {
          return prev;
        }
        return game;
      });

      const seatMap = new Map<number, string>();
      let mySeat: number | null = null;
      let myParticipant: LiveParticipant | null = null;
      const isWaitingJoin = Boolean(
        currentUserId && room.pendingJoins?.some((item) => item.userId === currentUserId),
      );
      const mappedPlayers: Player[] = room.seats
        .filter((seat) => seat.participant)
        .map((seat) => {
          const participant = seat.participant as LiveParticipant;
          const isHero = !!currentUserId && participant.userId === currentUserId;
          if (isHero) {
            mySeat = seat.seatId;
            myParticipant = participant;
          }
          const playerId = isHero ? "hero" : `seat-${seat.seatId}`;
          seatMap.set(seat.seatId, playerId);

          const rawLabel = game?.gameState?.positions?.[String(seat.seatId)];
          return {
            id: playerId,
            name: isHero ? "YOU" : participant.displayName,
            pos: Math.max(0, seat.seatId - 1),
            role: toUiRole(rawLabel),
            avatarSeed: participant.displayName,
            avatarUrl: toAvatarUrl(participant.displayName, participant.avatarInfo),
            chips: participant.stackAmount,
            bet: participant.currentBetAmount,
            status: participant.sittingOut || participant.folded ? "folded" : "active",
            allIn: Boolean(participant.allIn),
            cardsDealt: participant.holeCards.length > 0 && !shouldAnimateDeal,
            holeCards: participant.holeCards,
            seatId: seat.seatId,
          };
        });

      setPlayers((prev) => (samePlayers(prev, mappedPlayers) ? prev : mappedPlayers));
      setHeroSeatId(mySeat);
      setUserState((prev) => {
        const next = mySeat === null
          ? (isWaitingJoin ? "waiting" : "spectating")
          : myParticipant?.sittingOut
            ? (isWaitingJoin ? "waiting" : "spectating")
            : "playing";
        return prev === next ? prev : next;
      });

      if (game?.gameState) {
        const nextState = game.gameState;
        setPersistentAggroFx((prev) => {
          if (!prev) return prev;
          if (prev.handId !== nextState.handId || prev.street !== nextState.street) {
            return null;
          }
          return prev;
        });

        const latestAction = nextState.actions?.[nextState.actions.length - 1];
        const latestActionKey = latestAction
          ? `${nextState.handId}:${latestAction.order}:${latestAction.action}`
          : null;

        if (latestAction && latestActionKey && latestActionKey !== lastSeenLiveActionKeyRef.current) {
          lastSeenLiveActionKeyRef.current = latestActionKey;

          const actorPlayerId = seatMap.get(latestAction.seatId);
          if (actorPlayerId) {
            if (latestAction.action === "bet" || latestAction.action === "raise") {
              const nextAggroFx: PersistentAggroFx = {
                playerId: actorPlayerId,
                handId: nextState.handId,
                street: nextState.street,
                type: latestAction.action,
                maxBetAmount: nextState.maxBetAmount,
              };
              setPersistentAggroFx((prev) => {
                if (
                  !prev ||
                  prev.handId !== nextState.handId ||
                  prev.street !== nextState.street ||
                  nextState.maxBetAmount >= prev.maxBetAmount
                ) {
                  return nextAggroFx;
                }
                return prev;
              });
            } else if (latestAction.action === "all-in") {
              setPersistentAggroFx(null);
              triggerActionFx(actorPlayerId, "all-in");
            } else {
              triggerActionFx(actorPlayerId, latestAction.action as ActionFxType);
            }
          }

          const shouldDelayShowdown =
            (latestAction.action === "check" || latestAction.action === "fold") &&
            (nextState.street === "SHOWDOWN" || nextState.street === "RESULT");
          if (shouldDelayShowdown) {
            setShowdownDelayUntil(Date.now() + SHOWDOWN_AFTER_ACTION_DELAY_MS);
          }
        }

        const endedByFold =
          nextState.street === "RESULT" && latestAction?.action === "fold";
        const nextPhase = endedByFold
          ? toPhaseFromBoardCount(nextState.boardCards.length)
          : toUiPhase(room.status, nextState.street);
        const displayPhase = shouldAnimateDeal && nextPhase === "preflop" ? "dealing" : nextPhase;
        const nextCommunityCards = nextState.boardCards.map(toUiCard);
        const nextTurn =
          nextState.currentTurnSeatId
            ? seatMap.get(nextState.currentTurnSeatId) ?? null
            : null;

        setPhase((prev) => (prev === displayPhase ? prev : displayPhase));
        setCommunityCards((prev) =>
          sameStringArray(prev, nextCommunityCards) ? prev : nextCommunityCards,
        );
        setPot((prev) => (prev === nextState.potAmount ? prev : nextState.potAmount));
        setActiveTurn((prev) => (prev === nextTurn ? prev : nextTurn));

        const winnerPlayerId = nextState.winnerPlayerIds?.[0];
        if (winnerPlayerId) {
          const isShowdownStreet =
            nextState.street === "SHOWDOWN" ||
            (nextState.street === "RESULT" && !endedByFold);
          const winnerSeat = room.seats.find(
            (seat) => seat.participant?.playerId === winnerPlayerId,
          );
          const winnerLocalId = winnerSeat ? seatMap.get(winnerSeat.seatId) ?? null : null;
          const winnerRawCards = isShowdownStreet ? (winnerSeat?.participant?.holeCards ?? []) : [];
          const winnerUiCards = isShowdownStreet
            ? [...winnerRawCards.map(toUiCard), ...nextCommunityCards]
            : [];

          setWinner((prev) => (prev === winnerLocalId ? prev : winnerLocalId));
          setWinningCards((prev) => (sameStringArray(prev, winnerUiCards) ? prev : winnerUiCards));
          if (lastResultHandIdRef.current !== nextState.handId) {
            lastResultHandIdRef.current = nextState.handId;
            const holdUntil = Date.now() + getLiveShowdownDisplayMs(room);
            showdownHoldUntilRef.current = holdUntil;
            setShowdownHoldUntil(holdUntil);
          }

          if (isShowdownStreet && winnerRawCards.length === 2 && nextState.boardCards.length >= 3) {
            const score = bestScore([...winnerRawCards, ...nextState.boardCards]);
            const nextRank = handScoreLabel(score);
            setWinningHandRank((prev) => (prev === nextRank ? prev : nextRank));
          } else {
            setWinningHandRank((prev) => (prev === null ? prev : null));
          }
        } else if (room.status !== "HAND_ENDED" && Date.now() >= showdownHoldUntilRef.current) {
          setWinner((prev) => (prev === null ? prev : null));
          setWinningCards((prev) => (prev.length === 0 ? prev : []));
          setWinningHandRank((prev) => (prev === null ? prev : null));
          lastResultHandIdRef.current = null;
        }

        if (shouldAnimateDeal && nextPhase === "preflop") {
          setTimeout(() => {
            void syncLiveTable();
          }, 450);
        }
      } else {
        lastSeenLiveActionKeyRef.current = null;
        setPersistentAggroFx(null);
        setPhase((prev) => (prev === "init" ? prev : "init"));
        setCommunityCards((prev) => (prev.length === 0 ? prev : []));
        setPot((prev) => (prev === 0 ? prev : 0));
        setActiveTurn((prev) => (prev === null ? prev : null));
        if (Date.now() >= showdownHoldUntilRef.current) {
          setWinner((prev) => (prev === null ? prev : null));
          setWinningCards((prev) => (prev.length === 0 ? prev : []));
          setWinningHandRank((prev) => (prev === null ? prev : null));
          lastResultHandIdRef.current = null;
        }
      }

      if (isWaitingJoin) {
        setLog("Entry queued. You will join on the next available hand.");
      } else if (myParticipant?.sittingOut) {
        setLog("Spectating from your seat.");
      } else if (room.status === "HAND_ENDED") {
        const shouldAutoContinue = room.type === "ai_bot" && room.isPrivate;
        setLog(
          shouldAutoContinue
            ? "Hand complete. Auto starting next hand..."
            : "Hand complete. Ready for next hand.",
        );
      } else if (room.status === "IN_HAND") {
        setLog("Live hand in progress");
      } else if (!room.isPrivate) {
        setLog("Public room auto starts when 2+ players are seated.");
      } else if (!isRoomHost) {
        setLog("Waiting for host control...");
      } else {
        setLog("Private room ready. Seat players and start when ready.");
      }

      setGameStarted(room.status !== "WAITING_SETUP");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load room state.";
      if (
        /룸을 찾을 수 없습니다|Room not found|404/i.test(message)
      ) {
        navigate("/lobby");
        return;
      }
      setLog(message);
    }
  };

  useEffect(() => {
    if (!isLiveMode) return;

    void syncLiveTable();
    const timer = setInterval(() => {
      if (!liveBusy) {
        void syncLiveTable();
      }
    }, LIVE_SYNC_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isLiveMode, roomId, currentUserId, liveBusy]);

  useEffect(() => {
    if (selectedSeat === null) return;
    setBotModelId("random-custom");
    setBotStyle("balanced");
  }, [selectedSeat]);

  const loadInviteFriends = async () => {
    if (!canSendPrivateInvite) {
      setInviteFriends([]);
      return;
    }

    setInviteBusy(true);
    try {
      const friends = await apiFetch<SocialFriendSummary[]>("/social/friends");
      setInviteFriends(Array.isArray(friends) ? friends : []);
      setInviteNotice("");
    } catch (error) {
      setInviteFriends([]);
      setInviteNotice(error instanceof Error ? error.message : t("Failed to load friends."));
    } finally {
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    if (canAddBotToRoom || selectedSeat === null) return;
    setSelectedSeat(null);
  }, [canAddBotToRoom, selectedSeat]);

  useEffect(() => {
    if (!showInviteModal) return;
    if (!canSendPrivateInvite) {
      setShowInviteModal(false);
      return;
    }
    void loadInviteFriends();
  }, [showInviteModal, canSendPrivateInvite]);

  useEffect(() => {
    const hero = players.find((player) => player.id === "hero");
    const heroDealtNow = Boolean(hero?.cardsDealt) && userState === "playing";
    if (heroDealtNow && !prevHeroDealtRef.current) {
      audioManager.playCardPlace();
    }
    prevHeroDealtRef.current = heroDealtNow;
  }, [players, userState, liveGame?.gameState?.handId, phase]);

  useEffect(() => {
    const currentCount = communityCards.length;
    const prevCount = prevCommunityCountRef.current;
    if (prevCount !== null) {
      const openedFlop = prevCount < 3 && currentCount >= 3;
      const openedTurn = prevCount < 4 && currentCount >= 4;
      const openedRiver = prevCount < 5 && currentCount >= 5;
      if (openedFlop || openedTurn || openedRiver) {
        audioManager.playCardSlide();
      }
    }
    prevCommunityCountRef.current = currentCount;
  }, [communityCards.length, liveGame?.gameState?.handId]);

  useEffect(() => {
    if (winner && winner !== prevWinnerRef.current) {
      audioManager.playVictory();
    }
    prevWinnerRef.current = winner;
  }, [winner]);

  useEffect(() => {
    if (!isLiveMode) return;

    const state = liveGame?.gameState;
    const hero = players.find((player) => player.id === "hero");
    if (!state || !hero || hero.holeCards.length < 2) {
      setHeroEquity(null);
      return;
    }

    const activeOpponents = players.filter(
      (player) => player.id !== "hero" && player.status !== "folded",
    ).length;
    const estimated = estimateHeroWinRate({
      heroCards: hero.holeCards,
      boardCards: state.boardCards,
      opponents: Math.max(activeOpponents, 1),
      iterations: state.boardCards.length === 0 ? 160 : 240,
    });
    setHeroEquity(estimated);
  }, [
    isLiveMode,
    liveGame?.gameState?.handId,
    liveGame?.gameState?.boardCards?.join(","),
    players.find((player) => player.id === "hero")?.holeCards.join(","),
    players.filter((player) => player.id !== "hero" && player.status !== "folded").length,
  ]);

  useEffect(() => {
    if (!isTournament) return;
    let newStage = tourneyStage;
    if (tourneyPlayersLeft <= 9) newStage = "Final Table";
    else if (tourneyPlayersLeft <= 18) newStage = "Semi-Final Table";
    else if (tourneyPlayersLeft <= 36) newStage = "In The Money (ITM)";
    else newStage = "Starting Table";

    if (newStage !== tourneyStage) {
       setNextStageName(newStage);
       setIsTableBreaking(true);
       setLog(`Table Breaking... Moving to ${newStage}`);
       setTimeout(() => {
          setTourneyStage(newStage as any);
          setIsTableBreaking(false);
          setLog(`Welcome to the ${newStage}!`);
       }, 4000);
    }
  }, [tourneyPlayersLeft, tourneyStage, isTournament]);

  useEffect(() => {
    if (isLiveMode) return;
    // Hide Hero's cards if spectating initially
    if (userState !== "playing" && phase === "init") {
       setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, status: "folded" } : p));
    }
  }, [userState, phase, isLiveMode]);

  useEffect(() => {
    if (isLiveMode) return;
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "init") {
      setHeroEquity(null);
      if (gameStarted) {
        setLog(isTournament ? "Tournament starting..." : "Starting next hand...");
        timeout = setTimeout(() => setPhase("dealing"), 1500);
      } else {
        setLog(isTournament ? "Tournament waiting to start..." : "Waiting to start...");
      }
    } 
    else if (phase === "dealing") {
      setLog("Dealing hole cards...");
      const sequence = async () => {
        for (let i = 0; i < players.length; i++) {
          if (players[i].id === "hero" && userState !== "playing") continue; // Skip dealing to spectator
          await new Promise(r => setTimeout(r, 400));
          setPlayers(prev => prev.map((p, idx) => idx === i ? { ...p, cardsDealt: true } : p));
        }
        await new Promise(r => setTimeout(r, 800));
        setPhase("preflop");
      };
      sequence();
    }
    else if (phase === "preflop") {
      setHeroEquity(65);
      setPlayers(prev => prev.map(p => {
        if (p.id === "hero" && userState !== "playing") return p;
        if (p.role === "SB") return { ...p, bet: 50, chips: p.chips - 50 };
        if (p.role === "BB") return { ...p, bet: 100, chips: p.chips - 100 };
        if (["p4", "p5", "p6", "p7"].includes(p.id)) return { ...p, status: "folded" };
        return p;
      }));
      setPot(userState === "playing" ? 150 : 100); // adjust pot based on if SB (hero) posted blind
      setLog("Pre-flop: Action is on UTG");
      setActiveTurn("p1");

      timeout = setTimeout(() => {
        setLog("UTG (AI Bot 1) folds");
        setPlayers(prev => prev.map(p => p.id === "p1" ? { ...p, status: "folded" } : p));
        setActiveTurn("p3");
        
        setTimeout(() => {
          setLog("BTN (AI Bot 3) calls 100");
          setPlayers(prev => prev.map(p => p.id === "p3" ? { ...p, bet: 100, chips: p.chips - 100 } : p));
          setPot(p => p + 100);

          if (userState === "playing") {
             setActiveTurn("hero");
             setLog("Action is on YOU");
          } else {
             // Skip Hero completely if spectating
             setLog("Action skipped (You are sitting out)");
             setActiveTurn("p2");
             setTimeout(() => {
               setLog("BB checks");
               setActiveTurn(null);
               setTimeout(() => setPhase("flop_deal"), 1500);
             }, 1500);
          }
        }, 2000);
      }, 2000);
    }
    else if (phase === "flop_deal") {
      setLog("Dealing Flop...");
      setActiveTurn(null);
      setPlayers(prev => prev.map(p => ({ ...p, bet: 0 })));
      
      const sequence = async () => {
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 400));
          setCommunityCards(FULL_COMMUNITY_CARDS.slice(0, i + 1));
        }
        await new Promise(r => setTimeout(r, 800));
        setPhase("flop");
      };
      sequence();
    }
    else if (phase === "flop") {
      setHeroEquity(99); // Royal Flush flopped
      if (userState === "playing" && players.find(p => p.id === "hero")?.status !== "folded") {
         setLog("Flop: Action is on YOU (SB)");
         setActiveTurn("hero");
      } else {
         setLog("Flop: Action is on BB");
         setActiveTurn("p2");
         timeout = setTimeout(() => {
             setLog("BB checks");
             setActiveTurn("p3");
             setTimeout(() => {
                 setLog("BTN checks");
                 setActiveTurn(null);
                 setPhase("turn_deal");
             }, 1500);
         }, 1500);
      }
    }
    else if (phase === "turn_deal") {
      setLog("Dealing Turn...");
      setActiveTurn(null);
      setPlayers(prev => prev.map(p => ({ ...p, bet: 0 })));
      setTimeout(() => {
         setCommunityCards(FULL_COMMUNITY_CARDS.slice(0, 4));
         setTimeout(() => setPhase("turn"), 800);
      }, 400);
    }
    else if (phase === "turn") {
      if (userState === "playing" && players.find(p => p.id === "hero")?.status !== "folded") {
         setLog("Turn: Action is on YOU (SB)");
         setActiveTurn("hero");
      } else {
         setLog("Turn: Action is on BB");
         setActiveTurn("p2");
         timeout = setTimeout(() => {
             setLog("BB checks");
             setActiveTurn("p3");
             setTimeout(() => {
                 setLog("BTN checks");
                 setActiveTurn(null);
                 setPhase("river_deal");
             }, 1500);
         }, 1500);
      }
    }
    else if (phase === "river_deal") {
      setLog("Dealing River...");
      setActiveTurn(null);
      setPlayers(prev => prev.map(p => ({ ...p, bet: 0 })));
      setTimeout(() => {
         setCommunityCards(FULL_COMMUNITY_CARDS.slice(0, 5));
         setTimeout(() => setPhase("river"), 800);
      }, 400);
    }
    else if (phase === "river") {
      if (userState === "playing" && players.find(p => p.id === "hero")?.status !== "folded") {
         setLog("River: Action is on YOU (SB)");
         setActiveTurn("hero");
      } else {
         setLog("River: Action is on BB");
         setActiveTurn("p2");
         timeout = setTimeout(() => {
             setLog("BB checks");
             setActiveTurn("p3");
             setTimeout(() => {
                 setLog("BTN checks");
                 setActiveTurn(null);
                 setLog("Hand Complete. Analyzing...");
                 setPhase("showdown");
             }, 1500);
         }, 1500);
      }
    }
    else if (phase === "showdown") {
       const heroFolded = players.find(p => p.id === "hero")?.status === "folded";
       if (heroFolded) {
           setLog("Showdown! BB wins!");
           setWinner("p2");
           setWinningCards(["2♠", "2♦", "2♥", "Q♠", "J♠"]);
           setWinningHandRank("Three of a Kind, 2s");
           setPlayers(prev => prev.map(p => p.id === "p2" ? { ...p, chips: p.chips + pot } : p));
       } else {
           setLog("Showdown! YOU win with Royal Flush");
           setWinner("hero");
           setWinningCards(["A♠", "K♠", "Q♠", "J♠", "10♠"]);
           setWinningHandRank("Royal Flush");
           setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, chips: p.chips + pot } : p));
       }
       const holdUntil = Date.now() + SHOWDOWN_RESULT_DISPLAY_MS;
       showdownHoldUntilRef.current = holdUntil;
       setShowdownHoldUntil(holdUntil);
       setTimeout(() => {
          resetHand();
         }, SHOWDOWN_RESULT_DISPLAY_MS);
    }

    return () => clearTimeout(timeout);
  }, [phase, isTournament, userState, gameStarted, isLiveMode]);

  // Handle Timeout (Auto fold or auto check)
  useEffect(() => {
    if (isLiveMode) return;
    if (activeTurn !== "hero") return;
    
    // 15초 제한 시간
    const timer = setTimeout(() => {
      setLog("Time's up! Auto acting...");
      if (phase === "preflop") {
         // 프리플랍에서는 추가 베팅(Call 50)이 필요하므로 자동 FOLD
         handleHeroAction("fold");
      } else if (phase === "flop" || phase === "turn" || phase === "river") {
         // 플랍, 턴, 리버에서는 추가 베팅이 필요 없으므로(0) 자동 CHECK
         handleHeroAction("call");
      }
    }, TURN_TIMER_SECONDS * 1000);

    return () => clearTimeout(timer);
  }, [activeTurn, phase, isLiveMode]);

  const resetHand = () => {
    setLog("Hand Complete. Hand saved to Review Log.");
    setTimeout(() => {
      if (userState === "waiting") {
        setUserState("playing");
      }
      if (isTournament) {
        setTourneyPlayersLeft(prev => {
           const drop = Math.floor(Math.random() * 5) + 1; // Drop 1-5 players
           return Math.max(2, prev - drop);
        });
      }
      setPhase("init");
      setWinner(null);
      setWinningCards([]);
      setWinningHandRank(null);
      lastResultHandIdRef.current = null;
      showdownHoldUntilRef.current = 0;
      setShowdownHoldUntil(0);
      setPlayers(prev => prev.map(p => ({
        ...p,
        status: (p.chips <= 0 && p.id === "hero") ? "folded" : "active",
        bet: 0,
        cardsDealt: false
      })));
      setPot(0);
      setCommunityCards([]);
      setActiveTurn(null);
      setHeroEquity(null);
      setIsRaising(false);
      setRaiseAmount("");
    }, HAND_RESET_CLEANUP_MS);
  };

  const handleLiveStartOrNext = async () => {
    if (!isLiveMode || !liveRoom) return;

    setLiveBusy(true);
    try {
      if (liveRoom.status === "HAND_ENDED") {
        await apiFetch(`/game/rooms/${roomId}/next-hand`, { method: "POST" });
      } else {
        await apiFetch(`/rooms/${roomId}/start-game`, { method: "POST" });
      }
      await syncLiveTable();
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Request failed."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleConvertPublic = async () => {
    if (!isLiveMode || !liveRoom || !canConvertToPublic) return;

    setLiveBusy(true);
    try {
      await apiFetch(`/rooms/${roomId}/convert-public`, { method: "POST" });
      await syncLiveTable();
      setLog("Room converted to public. Host controls are now disabled.");
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to convert room to public."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleUpdateBlinds = async () => {
    if (!isLiveMode || !liveRoom || !canManageLiveRoom) return;

    const smallInput = window.prompt(t("Small blind amount"), String(liveRoom.blindSmall));
    if (smallInput === null) return;
    const parsedSmall = Number.parseInt(smallInput, 10);
    if (!Number.isFinite(parsedSmall) || parsedSmall < 1) {
      alert(t("Small blind must be an integer greater than or equal to 1."));
      return;
    }

    const bigInput = window.prompt(t("Big blind amount"), String(Math.max(liveRoom.blindBig, parsedSmall)));
    if (bigInput === null) return;
    const parsedBig = Number.parseInt(bigInput, 10);
    if (!Number.isFinite(parsedBig) || parsedBig < parsedSmall) {
      alert(t("Big blind must be an integer greater than or equal to small blind."));
      return;
    }

    setLiveBusy(true);
    try {
      await apiFetch(`/rooms/${roomId}/blinds`, {
        method: "PATCH",
        body: JSON.stringify({
          blindSmall: parsedSmall,
          blindBig: parsedBig,
        }),
      });
      await syncLiveTable();
      setLog(t("Blinds updated: {small} / {big}", { small: parsedSmall, big: parsedBig }));
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to update blinds."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleSitOut = async () => {
    if (!isLiveMode) {
      setUserState("spectating");
      setLog("You are now sitting out.");
      return;
    }

    if (heroSeatId === null) {
      setUserState("spectating");
      return;
    }

    setLiveBusy(true);
    try {
      await apiFetch(`/rooms/${roomId}/seats/${heroSeatId}/sit-out`, { method: "POST" });
      await syncLiveTable();
      setLog("You are now spectating from your seat.");
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to sit out."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleSitIn = async () => {
    if (!isLiveMode) {
      setUserState("waiting");
      setLog("Added to waitlist. Waiting for next hand...");
      return;
    }

    if (heroSeatId === null) {
      alert(t("You need to take a seat first."));
      return;
    }

    setLiveBusy(true);
    try {
      await apiFetch(`/rooms/${roomId}/seats/${heroSeatId}/sit-in`, { method: "POST" });
      await syncLiveTable();
      setLog("Sit in requested.");
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to sit in."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleCancelWaiting = async () => {
    if (!isLiveMode) {
      setUserState("spectating");
      setLog("Waitlist cancelled. Spectating.");
      return;
    }

    setLiveBusy(true);
    try {
      await apiFetch(`/rooms/${roomId}/waiting/cancel`, { method: "POST" });
      await syncLiveTable();
      setLog("Entry wait cancelled.");
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to cancel waiting."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleLeaveTable = async () => {
    if (!isLiveMode) {
      navigate("/lobby");
      return;
    }

    setLiveBusy(true);
    try {
      await apiFetch(`/rooms/${roomId}/leave-room`, { method: "POST" });
      navigate("/lobby");
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to leave table."));
    } finally {
      setLiveBusy(false);
    }
  };

  const handleSendRoomInvite = async (inviteeUserId: string) => {
    if (!canSendPrivateInvite || !roomId) return;

    setInviteBusy(true);
    try {
      await apiFetch("/social/room-invites", {
        method: "POST",
        body: JSON.stringify({
          roomId,
          inviteeUserId,
        }),
      });
      setInviteNotice(t("Invite sent."));
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : t("Failed to send invite."));
    } finally {
      setInviteBusy(false);
    }
  };

  const handleHeroAction = (action: "fold" | "call" | "raise", amount?: number) => {
    if (!isLiveMode && activeTurn !== "hero") return;

    if (isLiveMode) {
      if (action === "raise") {
        const previewAmount = Number.isFinite(amount ?? NaN)
          ? Number(amount)
          : Number(raiseAmount);
        if (!Number.isFinite(previewAmount) || previewAmount <= 0) {
          alert(t("Enter a valid raise amount."));
          return;
        }

        const state = liveGame?.gameState;
        const hero = players.find((player) => player.id === "hero");
        const effectiveStack = hero ? hero.chips + hero.bet : 0;
        const isAllInPreview = effectiveStack > 0 && previewAmount >= effectiveStack;
        if (!isAllInPreview && state) {
          const minRaiseTo = state.maxBetAmount > 0
            ? state.maxBetAmount + Math.max(state.minRaiseAmount, liveRoom?.blindBig ?? 0)
            : Math.max(state.minRaiseAmount, liveRoom?.blindBig ?? 1);
          if (previewAmount < minRaiseTo) {
            alert(t("Minimum raise amount is {amount}.", { amount: minRaiseTo }));
            return;
          }
        }
      }

      if (actionBusy || liveBusy) return;

      const sendLiveAction = async () => {
        setActionBusy(true);
        setPendingHeroAction(true);
        try {
          const latest = await apiFetch<LiveGameSnapshot>(`/game/rooms/${roomId}/state`);
          const state = latest.gameState;
          if (!state || heroSeatId === null) {
            setLog("Syncing game state...");
            await syncLiveTable();
            setPendingHeroAction(false);
            return;
          }
          if (state.currentTurnSeatId !== heroSeatId) {
            setLog("Turn already passed. Syncing state.");
            await syncLiveTable();
            setPendingHeroAction(false);
            return;
          }

          const payload: { action: LiveActionType; amount?: number } = {
            action: "check",
          };

          if (action === "fold") {
            payload.action = "fold";
          } else if (action === "call") {
            payload.action = state.minCallAmount > 0 ? "call" : "check";
          } else {
            const inputAmount = Number.isFinite(amount ?? NaN)
              ? Number(amount)
              : Number(raiseAmount);
            if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
              alert(t("Enter a valid raise amount."));
              setPendingHeroAction(false);
              return;
            }

            const hero = players.find((player) => player.id === "hero");
            const effectiveStack = hero ? hero.chips + hero.bet : 0;

            if (effectiveStack > 0 && inputAmount >= effectiveStack) {
              payload.action = "all-in";
            } else {
              payload.action = state.maxBetAmount > 0 ? "raise" : "bet";
              payload.amount = Math.floor(inputAmount);
            }
          }

          setLiveBusy(true);
          await apiFetch(`/game/rooms/${roomId}/act`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          setActiveTurn((prev) => (prev === "hero" ? null : prev));
          setIsRaising(false);
          setRaiseAmount("");
          await syncLiveTable();
          setPendingHeroAction(false);
          setTimeout(() => {
            void syncLiveTable();
          }, 180);
          setTimeout(() => {
            void syncLiveTable();
          }, 420);
        } catch (error) {
          setPendingHeroAction(false);
          alert(error instanceof Error ? error.message : t("Failed to process action."));
        } finally {
          setLiveBusy(false);
          setActionBusy(false);
        }
      };

      void sendLiveAction();
      return;
    }

    if (action === "raise") {
      const raiseVal = amount || pot;
      const isAllIn = raiseVal >= (players.find(p=>p.id==="hero")?.chips || 0);

      setLog(`YOU ${isAllIn ? 'go ALL-IN!' : `raise to ${raiseVal}`}`);
      setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, bet: p.bet + raiseVal, chips: Math.max(0, p.chips - raiseVal) } : p));
      setPot(p => p + raiseVal);
      setIsRaising(false);
      setActiveTurn("p2");
      
      setTimeout(() => {
        setLog("BB folds");
        setActiveTurn("p3");
        setTimeout(() => {
          if (isAllIn) {
             const win = Math.random() > 0.5; // 50% chance to win or lose the all-in mock
             setCommunityCards(FULL_COMMUNITY_CARDS.slice(0, 5)); // Show all cards
             setPhase("showdown");
             if (win) {
                setLog("BTN calls. Showdown! YOU WIN!");
                setWinner("hero");
                setWinningCards(["A♠", "K♠", "Q♠", "J♠", "10♠"]);
                setWinningHandRank("Royal Flush");
                setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, chips: p.chips + pot + raiseVal * 2 } : p));
             } else {
                setLog("BTN calls. Showdown! YOU LOST!");
                setWinner("p3");
                setWinningCards(["Q♠", "J♠", "10♠", "9♠", "8♠"]);
                setWinningHandRank("Straight Flush");
                setTimeout(() => setUserState("eliminated"), 4000);
             }
             const holdUntil = Date.now() + SHOWDOWN_RESULT_DISPLAY_MS;
             showdownHoldUntilRef.current = holdUntil;
             setShowdownHoldUntil(holdUntil);
             setTimeout(() => {
                setActiveTurn(null);
                resetHand();
               }, SHOWDOWN_RESULT_DISPLAY_MS);
          } else {
             setLog("BTN folds. YOU win!");
             setWinner("hero");
             setActiveTurn(null);
               setTimeout(() => resetHand(), QUICK_RESULT_DISPLAY_MS);
          }
        }, 1500);
      }, 1500);
      return;
    }

    if (phase === "preflop") {
      if (action === "fold") {
        setLog("YOU fold. BB's turn...");
        setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, status: "folded" } : p));
        setActiveTurn("p2");
        setTimeout(() => {
          setLog("BB checks");
          setActiveTurn("p3");
          setTimeout(() => {
             setLog("BTN checks");
             setActiveTurn(null);
             setPhase("flop_deal");
          }, 1500);
        }, 1500);
      } else if (action === "call") {
        setLog("YOU call 50");
        setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, bet: p.bet + 50, chips: p.chips - 50 } : p));
        setPot(p => p + 50);
        setActiveTurn("p2");
        
        setTimeout(() => {
          setLog("BB (AI Bot 2) checks");
          setActiveTurn(null);
          setTimeout(() => setPhase("flop_deal"), 1500);
        }, 1500);
      }
    } else if (phase === "flop") {
        if (action === "fold") {
            setLog("YOU fold. BB's turn...");
            setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, status: "folded" } : p));
            setActiveTurn("p2");
            setTimeout(() => {
                setLog("BB checks");
                setActiveTurn("p3");
                setTimeout(() => {
                   setLog("BTN checks");
                   setActiveTurn(null);
                   setPhase("turn_deal");
                }, 1500);
            }, 1500);
        } else if (action === "call") {
            setLog("YOU check");
            setActiveTurn("p2");
            setTimeout(() => {
                setLog("BB checks");
                setActiveTurn("p3");
                setTimeout(() => {
                   setLog("BTN checks");
                   setActiveTurn(null);
                   setPhase("turn_deal");
                }, 1500);
            }, 1500);
        }
    } else if (phase === "turn") {
        if (action === "fold") {
            setLog("YOU fold. BB's turn...");
            setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, status: "folded" } : p));
            setActiveTurn("p2");
            setTimeout(() => {
                setLog("BB checks");
                setActiveTurn("p3");
                setTimeout(() => {
                   setLog("BTN checks");
                   setActiveTurn(null);
                   setPhase("river_deal");
                }, 1500);
            }, 1500);
        } else if (action === "call") {
            setLog("YOU check");
            setActiveTurn("p2");
            setTimeout(() => {
                setLog("BB checks");
                setActiveTurn("p3");
                setTimeout(() => {
                   setLog("BTN checks");
                   setActiveTurn(null);
                   setPhase("river_deal");
                }, 1500);
            }, 1500);
        }
    } else if (phase === "river") {
        if (action === "fold") {
            setLog("YOU fold. BB's turn...");
            setPlayers(prev => prev.map(p => p.id === "hero" ? { ...p, status: "folded" } : p));
            setActiveTurn("p2");
            setTimeout(() => {
                setLog("BB checks");
                setActiveTurn("p3");
                setTimeout(() => {
                   setLog("BTN checks");
                   setActiveTurn(null);
                   setPhase("showdown");
                }, 1500);
            }, 1500);
        } else if (action === "call") {
            setLog("YOU check");
            setActiveTurn("p2");
            setTimeout(() => {
                setLog("BB checks");
                setActiveTurn("p3");
                setTimeout(() => {
                   setLog("BTN checks");
                   setActiveTurn(null);
                   setPhase("showdown");
                }, 1500);
            }, 1500);
        }
    }
  };

  const getPlayerPosStyle = (pos: number, total: number): React.CSSProperties => {
    if (total === 4) {
      if (pos === 0) return { bottom: '5%', left: '50%', transform: 'translateX(-50%)' };
      if (pos === 1) return { left: '5%', top: '45%', transform: 'translateY(-50%)' };
      if (pos === 2) return { top: '5%', left: '50%', transform: 'translateX(-50%)' };
      if (pos === 3) return { right: '5%', top: '45%', transform: 'translateY(-50%)' };
    }
    const angle = Math.PI / 2 + (pos * 2 * Math.PI / total);
    const x = 50 + 40 * Math.cos(angle);
    const y = 50 + 35 * Math.sin(angle);
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' };
  };

  const getBetPosStyle = (pos: number, total: number): React.CSSProperties => {
    if (total === 4) {
      if (pos === 0) return { top: '-110px', left: '50%', transform: 'translateX(-50%)' };
      if (pos === 1) return { right: '-100px', top: '50%', transform: 'translateY(-50%)' };
      if (pos === 2) return { bottom: '-80px', left: '50%', transform: 'translateX(-50%)' };
      if (pos === 3) return { left: '-100px', top: '50%', transform: 'translateY(-50%)' };
    }
    const angle = Math.PI / 2 + (pos * 2 * Math.PI / total);
    const bx = -100 * Math.cos(angle);
    const by = -100 * Math.sin(angle);
    return { left: '50%', top: '50%', transform: `translate(calc(-50% + ${bx}px), calc(-50% + ${by}px))` };
  };

  return (
    <div className="relative w-full h-full bg-[#1A1A4A] flex flex-col items-center justify-center font-sans select-none overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none" />

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-50 pointer-events-none">
        <button 
          onClick={() => {
            void handleLeaveTable();
          }}
          disabled={liveBusy}
          className="flex items-center gap-2 text-white bg-black/40 hover:bg-black/60 disabled:opacity-50 px-4 py-2 rounded-full font-bold backdrop-blur-md transition border border-white/10 pointer-events-auto"
        >
          <ArrowLeft className="w-5 h-5" />
          {t("Leave")}
        </button>

        <div className="bg-black/60 px-6 py-2 rounded-full border border-cyan-500/30 text-cyan-400 font-mono text-sm tracking-widest backdrop-blur-sm animate-pulse flex items-center gap-2 shadow-lg">
           <Info className="w-4 h-4"/>
           {t(log)}
        </div>

        <div className="flex gap-4 pointer-events-auto">
          {isLiveMode && canManageLiveRoom && (
            <button
              onClick={() => {
                void handleUpdateBlinds();
              }}
              disabled={liveBusy}
              className="px-4 py-2 bg-slate-700/80 hover:bg-slate-600/80 rounded-full text-white font-bold text-sm backdrop-blur-md border border-slate-300/30 transition shadow-lg"
            >
              {t("Edit Blinds")}
            </button>
          )}
          {canConvertToPublic && (
            <button
              onClick={() => {
                void handleConvertPublic();
              }}
              disabled={liveBusy}
              className="px-4 py-2 bg-cyan-700/80 hover:bg-cyan-600/80 rounded-full text-white font-bold text-sm backdrop-blur-md border border-cyan-300/40 transition shadow-lg"
            >
              {t("Make Public")}
            </button>
          )}
          {!isTournament && userState === "playing" && (
            <button 
              onClick={() => {
                void handleSitOut();
              }}
              disabled={liveBusy}
              className="px-4 py-2 bg-orange-600/80 hover:bg-orange-500/80 rounded-full text-white font-bold text-sm backdrop-blur-md border border-orange-400/30 transition shadow-lg"
            >
              {t("Sit Out")}
            </button>
          )}
          {!isTournament && userState === "spectating" && heroSeatId !== null && (
            <button
              onClick={() => {
                void handleSitIn();
              }}
              disabled={liveBusy}
              className="px-4 py-2 bg-emerald-600/80 hover:bg-emerald-500/80 rounded-full text-white font-bold text-sm backdrop-blur-md border border-emerald-300/30 transition shadow-lg"
            >
              {t("Sit In")}
            </button>
          )}
          {!isTournament && userState === "waiting" && (
            <button
              onClick={() => {
                void handleCancelWaiting();
              }}
              disabled={liveBusy}
              className="px-4 py-2 bg-slate-700/80 hover:bg-slate-600/80 rounded-full text-white font-bold text-sm backdrop-blur-md border border-slate-300/30 transition shadow-lg"
            >
              {t("Cancel Wait")}
            </button>
          )}
          <button
            onClick={() => {
              if (!canSendPrivateInvite) {
                alert(t("Invites are available only in private rooms."));
                return;
              }
              setShowInviteModal(true);
            }}
            className="p-2 bg-black/40 hover:bg-black/60 rounded-full text-white backdrop-blur-md border border-white/10 transition"
          >
            <Users className="w-5 h-5" />
          </button>
          <button className="p-2 bg-black/40 hover:bg-black/60 rounded-full text-white backdrop-blur-md border border-white/10 transition">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Game Mode HUD (Tournament vs Cash) */}
      <div className="absolute top-20 left-4 md:left-8 bg-black/60 p-3 rounded-2xl border border-white/10 backdrop-blur-sm z-40 flex flex-col gap-1 min-w-[160px]">
        {isTournament ? (
          <>
            <div className="flex items-center gap-2 text-yellow-400 font-black text-sm uppercase tracking-wider">
              <Trophy className="w-4 h-4"/>
              {tourneyStage}
            </div>
            <div className="text-white font-bold text-xs mt-1 border-b border-white/10 pb-1 mb-1">
              {t("Players Left")}: <span className="text-cyan-400">{tourneyPlayersLeft}</span> / 100
            </div>
            <div className="text-white font-bold text-sm">{t("Level 4")} <span className="text-slate-400 mx-2">•</span> 100 / 200</div>
            <div className="flex items-center gap-1.5 text-cyan-400 font-semibold text-xs mt-1">
              <Clock className="w-3 h-3"/>
              {t("Blinds up in 04:59")}
            </div>
            <div className="text-slate-400 font-semibold text-[10px] mt-1 border-t border-white/10 pt-1">
              {t("Rebuys")}: 1/2 <span className="opacity-60">({t("Closes at Lvl 8")})</span>
            </div>
          </>
        ) : (
          <>
            <div className={`flex items-center gap-2 font-black text-sm uppercase tracking-wider ${roomMode === "cash" ? "text-green-400" : "text-cyan-300"}`}>
              {roomMode === "cash" ? <Coins className="w-4 h-4"/> : roomMode === "ai_bot" ? <Target className="w-4 h-4"/> : <Info className="w-4 h-4"/>}
              {tableModeLabel}
            </div>
            <div className="text-white font-bold text-sm mt-1">
              {t("Blinds")}: <span className="text-slate-300">{liveRoom ? `${liveRoom.blindSmall} / ${liveRoom.blindBig}` : "-"}</span>
            </div>
            <div className="text-slate-400 font-semibold text-[10px] mt-1 border-t border-white/10 pt-1">
              {isLiveMode ? t("Live room data") : t("No limit on rebuys")}
            </div>
          </>
        )}
      </div>

      {/* Wide Poker Table */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[110vw] md:w-[85vw] max-w-[1200px] h-[55vh] md:h-[60vh] max-h-[600px] bg-[#2E3C98] rounded-[300px] shadow-[inset_0_-10px_40px_rgba(0,0,0,0.6),0_20px_50px_rgba(0,0,0,0.5)] border-[16px] md:border-[20px] border-[#1D2660] flex items-center justify-center">
        <div className="absolute inset-1 md:inset-2 rounded-[300px] border-2 md:border-4 border-cyan-400/20 shadow-[inset_0_0_30px_rgba(0,255,255,0.1)] pointer-events-none" />
        
        {/* Center Pot & Logo */}
        <div className="absolute top-[40%] md:top-[42%] left-1/2 -translate-x-1/2 -translate-y-[65%] flex flex-col items-center gap-4 z-10 pointer-events-none">
          <div className="text-cyan-200/20 font-black text-2xl md:text-4xl tracking-widest drop-shadow-md italic opacity-50 relative flex justify-center">
            AIPOT
            {/* Showdown Rank Badge */}
            <AnimatePresence>
              {isShowdownDisplayActive && winningHandRank && (!isLiveMode || isLiveResultStreet) && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/90 px-6 py-2 rounded-full border-2 border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.5)] z-50 whitespace-nowrap flex items-center gap-2 not-italic"
                >
                   <Trophy className="w-5 h-5 text-yellow-400" />
                   <span className="text-yellow-400 font-black text-sm md:text-base uppercase tracking-widest">{winningHandRank}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <AnimatePresence>
            {pot > 0 && (
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-black/80 px-4 md:px-6 py-1 md:py-1.5 rounded-full border border-cyan-500/50 flex items-center gap-3 shadow-[0_0_20px_rgba(0,255,255,0.2)]"
              >
                <span className="text-cyan-400 font-bold text-xs md:text-sm">{t("Pot")}</span>
                <span className="text-white font-black text-lg md:text-xl">${pot}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Community Cards */}
          <div className="flex gap-1.5 md:gap-3 mt-1 h-[60px] md:h-[80px] items-center">
            {communityCards.map((card, i) => {
              const isWinningCard = isCardRevealPhase && winningCards.includes(card);
              return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: -20, rotateY: 180, scale: 0.8 }}
                animate={{ opacity: 1, y: isWinningCard ? -10 : 0, rotateY: 0, scale: isWinningCard ? 1.1 : 1 }}
                transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
                className={`w-10 h-14 md:w-14 md:h-20 bg-white rounded-md md:rounded-lg shadow-2xl flex items-center justify-center font-black text-slate-800 text-lg md:text-xl border-2 transition-all duration-300 ${isWinningCard ? 'border-yellow-400 ring-4 ring-yellow-400/50 drop-shadow-[0_0_15px_rgba(250,204,21,0.8)] z-20' : 'border-slate-300 opacity-90'}`}
              >
                {isWinningCard && <div className="absolute inset-0 bg-yellow-400/10 pointer-events-none rounded-md md:rounded-lg" />}
                <span className={card.includes('♥') || card.includes('♦') ? 'text-red-600' : 'text-black'}>
                  {card}
                </span>
              </motion.div>
            )})}
          </div>
        </div>

        {/* START GAME / DEAL HAND Button */}
        {((!isLiveMode && phase === "init" && userState === "playing") ||
          (isLiveMode &&
            canManageLiveRoom &&
            liveRoom &&
            (liveRoom.status === "WAITING_SETUP" ||
              liveRoom.status === "READY" ||
              (liveRoom.status === "HAND_ENDED" && !autoContinueBotRoom)))) && (
          <button 
            onClick={() => {
              if (isLiveMode) {
                void handleLiveStartOrNext();
                return;
              }
              if (!gameStarted) setGameStarted(true);
              setPhase("dealing");
            }}
            disabled={liveBusy || (isLiveMode && liveRoom?.status === "WAITING_SETUP" && liveActivePlayers < 2)}
            className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 px-6 py-3 md:px-8 md:py-4 bg-gradient-to-r from-green-500 to-emerald-400 text-white font-black text-xl md:text-2xl rounded-full shadow-[0_0_20px_rgba(34,197,94,0.5)] hover:scale-105 transition-transform z-50 uppercase tracking-widest border border-white/20"
          >
            {isLiveMode
              ? liveRoom?.status === "HAND_ENDED"
                ? t("Next Hand")
                : liveRoom?.status === "WAITING_SETUP" && liveActivePlayers < 2
                  ? t("Need 2 Players")
                  : t("Start Game")
              : gameStarted
                ? t("Deal Hand")
                : t("Start Game")}
          </button>
        )}

        {/* Central Deck for dealing animation */}
        <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          {players.map(p => (
             !p.cardsDealt && (
               <motion.div 
                  key={`deck-card-${p.id}`} 
                  layoutId={`card-${p.id}`} 
                  className="absolute w-10 h-14 md:w-12 md:h-16 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-800 to-indigo-950 border-2 border-white/20 rounded-md shadow-md"
                  style={{ top: -28, left: -20 }}
               />
             )
          ))}
        </div>

        {/* Showdown Display (Removed redundant center card box) */}
      </div>

      {/* Render Empty Seats */}
      {!isTournament && (!isLiveMode || canManageLiveRoom) && Array.from({ length: tableSeatCount }).map((_, i) => {
        if (players.find(p => p.pos === i)) return null;
        if (phase !== "init" && phase !== "showdown") return null; // Only allow adding between hands
        const canAddBotHere = canAddBotToRoom && (!isLiveMode || canManageLiveRoom);
        if (!canAddBotHere) return null;

        return (
          <div key={`empty-${i}`} className="absolute flex flex-col items-center z-20" style={getPlayerPosStyle(i, tableSeatCount)}>
             <button 
               onClick={() => {
                 if (canAddBotHere) {
                   setSelectedSeat(i);
                 }
               }}
               className="w-20 h-20 md:w-24 md:h-24 rounded-full border-2 border-dashed border-white/20 bg-black/20 hover:bg-white/10 hover:border-white/50 flex flex-col items-center justify-center transition group shadow-inner"
             >
               <Plus className="w-8 h-8 text-white/30 group-hover:text-white/70 mb-1 transition-colors" />
               <span className="text-[10px] text-white/40 group-hover:text-white/80 font-bold uppercase tracking-wider transition-colors">{t("Add Bot")}</span>
             </button>
          </div>
        );
      })}

      {/* Render Players */}
      {players.map((p) => {
        const isPlayerTurn = isLiveMode
          ? Boolean(
            p.seatId !== undefined &&
            liveGame?.gameState?.currentTurnSeatId === p.seatId &&
            !(pendingHeroAction && p.id === "hero"),
          )
          : activeTurn === p.id;
        const isTimerActive = isPlayerTurn;
        const actionFx = actionFxByPlayer[p.id];
        const persistentAggroType = persistentAggroFx?.playerId === p.id ? persistentAggroFx.type : null;
        const hasCheckFx = actionFx?.type === "check";
        const hasCallFx = actionFx?.type === "call";
        const hasBetFx = actionFx?.type === "bet" || persistentAggroType === "bet";
        const hasRaiseFx = actionFx?.type === "raise" || persistentAggroType === "raise";
        const hasFoldFx = actionFx?.type === "fold";
        const hasAllInFx = Boolean(p.allIn) || actionFx?.type === "all-in";
        const roleBadgeClass =
          p.role === "BTN" || p.role === "BTN/SB"
            ? "bg-amber-400 text-slate-900"
            : p.role === "SB"
              ? "bg-blue-500 text-white"
              : p.role === "BB"
                ? "bg-purple-600 text-white"
                : "bg-slate-600 text-white";
        const avatarStateClass = hasAllInFx
          ? "border-violet-400 shadow-[0_0_30px_rgba(139,92,246,0.6)]"
          : hasBetFx || hasRaiseFx
            ? "border-red-400 shadow-[0_0_24px_rgba(248,113,113,0.55)]"
            : hasCheckFx || hasCallFx
            ? "border-yellow-300 shadow-[0_0_24px_rgba(250,204,21,0.55)]"
            : isTimerActive
              ? "border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.6)] scale-105 transition-transform"
              : "border-slate-700";
        const actionOverlayLabel = hasAllInFx
          ? "ALL-IN"
          : hasRaiseFx
            ? "RAISE"
            : hasBetFx
              ? "BET"
              : hasCallFx
                ? "CALL"
                : hasCheckFx
                  ? "CHECK"
                  : null;
        const actionOverlayTone = hasAllInFx
          ? "border-violet-300 bg-violet-600/90 text-white"
          : hasBetFx || hasRaiseFx
            ? "border-red-300 bg-red-600/90 text-white"
            : "border-yellow-300 bg-yellow-400/90 text-slate-900";

        return (
        <div key={p.id} className={`absolute flex flex-col items-center z-30 transition-all ${p.id === 'hero' && userState !== 'playing' ? 'opacity-40 grayscale sepia' : ''}`} style={getPlayerPosStyle(p.pos, tableSeatCount)}>
          
          <div className={`absolute z-20 ${p.id === 'hero' ? 'translate-x-14 -translate-y-8 md:translate-x-20 md:-translate-y-12' : ''}`} style={getBetPosStyle(p.pos, tableSeatCount)}>
            <ChipStack amount={p.bet} />
          </div>

          <div className={`relative w-full flex justify-center h-0 ${isCardRevealPhase && p.status !== 'folded' ? 'z-50' : 'z-10'}`}>
             {/* AI Win Probability HUD for Hero */}
             {p.id === 'hero' && userState === 'playing' && p.cardsDealt && heroEquity !== null && (
               <motion.div 
                 initial={{ opacity: 0, x: -20 }}
                 animate={{ opacity: 1, x: 0 }}
                 className="absolute -left-[120px] md:-left-[150px] top-[10px] md:top-[20px] flex flex-col items-center bg-black/80 px-4 py-1.5 md:py-2 rounded-xl border border-orange-500/30 backdrop-blur-md shadow-[0_0_15px_rgba(249,115,22,0.15)] z-50 w-[110px] md:w-[130px]"
               >
                 <div className="flex justify-between w-full items-center mb-1 text-[9px] md:text-[10px] uppercase tracking-widest font-black">
                   <span className="flex items-center gap-1 text-orange-400">
                     <Target className="w-3 h-3 md:w-3.5 md:h-3.5" /> Prob
                   </span>
                   <span className="text-white">{heroEquity}%</span>
                 </div>
                 <div className="w-full h-1.5 md:h-2 bg-slate-800 rounded-full overflow-hidden">
                   <motion.div 
                     className={`h-full ${heroEquity > 50 ? 'bg-gradient-to-r from-cyan-600 to-cyan-400' : 'bg-gradient-to-r from-orange-600 to-orange-400'}`} 
                     initial={{ width: 0 }}
                     animate={{ width: `${heroEquity}%` }}
                     transition={{ duration: 0.8, type: "spring" }}
                   />
                 </div>
               </motion.div>
             )}

             <div className={`absolute flex gap-1 ${
                p.id === 'hero' 
                  ? (isCardRevealPhase ? '-top-[70px] md:-top-[90px] scale-110 z-50' : '-top-[50px] md:-top-[70px] scale-100 md:scale-110 z-40') 
                  : (isCardRevealPhase && p.status !== 'folded' ? 'top-10 md:top-14 scale-110 z-50' : 'top-[70%] left-1/2 -translate-x-1/2 md:top-[80%] scale-90 md:scale-100 z-10')
                } pointer-events-none transition-all duration-500`}>
                {p.cardsDealt && p.id === 'hero' && userState !== 'playing' ? null : p.cardsDealt && (() => {
                  const fallbackCards: Record<string, [string, string]> = {
                    p1: ["7♥", "7♦"],
                    p2: ["2♠", "2♦"],
                    p3: ["9♠", "8♠"],
                    p4: ["3♣", "4♣"],
                    p5: ["J♦", "Q♦"],
                    p6: ["A♥", "10♥"],
                    p7: ["5♠", "6♠"],
                  };
                  const liveCards = p.holeCards.map(toUiCard);
                  const pCards = isLiveMode
                    ? ([liveCards[0] ?? "", liveCards[1] ?? ""] as [string, string])
                    : (p.id === 'hero' ? HERO_CARDS : fallbackCards[p.id] ?? ["", ""]);
                  const showCards = isLiveMode
                    ? (p.id === 'hero' ? liveCards.length === 2 : (isCardRevealPhase && p.status !== 'folded' && liveCards.length === 2))
                    : (p.id === 'hero' || (isCardRevealPhase && p.status !== 'folded'));
                  const c1Winner = isCardRevealPhase && winner === p.id && winningCards.includes(pCards?.[0] || "");
                  const c2Winner = isCardRevealPhase && winner === p.id && winningCards.includes(pCards?.[1] || "");
                  const isHeroShowdown = p.id === 'hero' && isCardRevealPhase;
                  
                  return (
                  <>
                    <motion.div 
                      layoutId={`card-${p.id}-0`} 
                      animate={{ opacity: p.status === 'folded' ? 0.4 : 1 }}
                      className={`w-10 h-14 md:w-14 md:h-20 bg-white rounded-md shadow-xl border flex items-center justify-center font-bold md:text-lg transition-all duration-300 ${p.id === 'hero' && !isHeroShowdown ? 'rotate-[-8deg] translate-y-2 translate-x-2' : ''} ${p.status === 'folded' ? 'grayscale' : ''} ${c1Winner ? 'border-yellow-400 ring-4 ring-yellow-400/50 -translate-y-6 scale-110 z-[100] drop-shadow-[0_0_15px_rgba(250,204,21,0.8)]' : 'border-slate-300 z-40'}`}
                    >
                      {c1Winner && <div className="absolute inset-0 bg-yellow-400/10 pointer-events-none rounded-md" />}
                      {showCards ? <span className={pCards[0].includes('♥') || pCards[0].includes('♦') ? 'text-red-600 font-black text-lg md:text-xl' : 'text-black font-black text-lg md:text-xl'}>{pCards[0]}</span> : <div className="w-full h-full bg-indigo-900 rounded-[4px] m-1 border border-white/20"></div>}
                    </motion.div>
                    <motion.div 
                       initial={{ opacity: 0, x: -20 }}
                       animate={{ opacity: p.status === 'folded' ? 0.4 : 1, x: 0 }}
                       transition={{ delay: 0.2 }}
                       className={`w-10 h-14 md:w-14 md:h-20 bg-white rounded-md shadow-xl border flex items-center justify-center font-bold md:text-lg transition-all duration-300 ${p.id === 'hero' && !isHeroShowdown ? 'rotate-[8deg] -translate-x-2' : ''} ${p.status === 'folded' ? 'grayscale' : ''} ${c2Winner ? 'border-yellow-400 ring-4 ring-yellow-400/50 -translate-y-6 scale-110 z-[100] drop-shadow-[0_0_15px_rgba(250,204,21,0.8)]' : 'border-slate-300 z-40'}`}
                    >
                       {c2Winner && <div className="absolute inset-0 bg-yellow-400/10 pointer-events-none rounded-md" />}
                       {showCards ? <span className={pCards[1].includes('♥') || pCards[1].includes('♦') ? 'text-red-600 font-black text-lg md:text-xl' : 'text-black font-black text-lg md:text-xl'}>{pCards[1]}</span> : <div className="w-full h-full bg-indigo-900 rounded-[4px] m-1 border border-white/20"></div>}
                    </motion.div>
                  </>
                )})()}
             </div>
          </div>

          <div className={`relative w-20 h-20 md:w-24 md:h-24 rounded-full border-4 shadow-2xl z-30 bg-slate-800 ${avatarStateClass} ${hasFoldFx ? 'ring-4 ring-red-500/50' : ''} ${p.status === 'folded' ? 'opacity-50 grayscale' : ''}`}>
            <TimerRing isActive={isTimerActive} duration={TURN_TIMER_SECONDS} resetToken={turnTimerResetToken} />
            
            <div className={`absolute -right-2 -top-2 md:-right-3 md:-top-3 w-8 h-8 md:w-10 md:h-10 rounded-full border-2 border-slate-900 flex items-center justify-center text-[10px] md:text-xs font-black shadow-lg z-30 ${roleBadgeClass}`}>
              {p.role}
            </div>

            <img src={p.avatarUrl ?? toAvatarUrl(p.avatarSeed)} alt={p.name} className="w-full h-full object-cover rounded-full" />

            {actionOverlayLabel && p.status !== "folded" && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.9 }}
                className="absolute inset-0 z-20 bg-black/55 rounded-full flex items-center justify-center"
              >
                <span className={`px-2.5 py-1 rounded-full border text-[10px] md:text-xs font-black tracking-wider shadow-lg flex items-center gap-1 ${actionOverlayTone}`}>
                  {hasCheckFx ? <Check className="w-3 h-3" /> : null}
                  {actionOverlayLabel}
                </span>
              </motion.div>
            )}
            
            {p.status === 'folded' && !(p.id === 'hero' && userState !== 'playing') && (
              <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center text-sm font-black text-white">
                {t("Fold")}
              </div>
            )}
            
            {p.id === 'hero' && userState !== 'playing' && (
              <div className="absolute inset-0 bg-black/60 rounded-full flex flex-col items-center justify-center text-center">
                <span className="text-xs font-black text-white">
                  {userState === "waiting" ? t("WAITING ENTRY") : t("SITTING OUT")}
                </span>
              </div>
            )}
            
            {winner === p.id && (!isLiveMode || (isLiveResultStreet && !isShowdownRevealBlocked)) && (
              <motion.div 
                initial={{ scale: 0, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                className="absolute -top-10 left-1/2 -translate-x-1/2 z-50 drop-shadow-[0_0_15px_rgba(250,204,21,0.8)]"
              >
                <Trophy className="w-10 h-10 md:w-12 md:h-12 text-yellow-400 fill-yellow-400" />
              </motion.div>
            )}
          </div>

          <div className={`mt-3 px-4 py-1 md:py-1.5 rounded-full text-xs md:text-sm font-black border-2 shadow-lg whitespace-nowrap z-30 ${p.id === 'hero' ? 'bg-gradient-to-r from-slate-900 to-slate-800 border-cyan-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
            {p.name} • <span className={p.id === 'hero' ? 'text-cyan-400' : 'text-green-400'}>${p.chips}</span>
          </div>
        </div>
      )})}

      <AnimatePresence mode="wait">
        {isHeroActionTurn && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-4 md:bottom-8 right-4 md:right-8 flex gap-2 md:gap-4 z-50 pointer-events-auto"
          >
            {isRaising ? (
              <motion.div 
                key="raise-menu"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col gap-2 bg-black/80 p-3 md:p-4 rounded-2xl backdrop-blur-md border border-white/10 shadow-2xl"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-white font-bold text-sm uppercase tracking-widest">{t("Raise Amount")}</span>
                  <button onClick={() => setIsRaising(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5"/></button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setRaiseAmount(String(Math.floor(pot / 2)))} className="flex-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded-lg text-xs font-bold text-white transition">{t("1/2 Pot")}</button>
                  <button onClick={() => setRaiseAmount(String(pot))} className="flex-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded-lg text-xs font-bold text-white transition">{t("Pot")}</button>
                  {phase === "preflop" && (
                    <button onClick={() => setRaiseAmount(String(pot * 3))} className="flex-1 bg-slate-700 hover:bg-slate-600 py-1.5 rounded-lg text-xs font-bold text-white transition">{t("3-Bet")}</button>
                  )}
                  <button onClick={() => setRaiseAmount(String((heroPlayer?.chips ?? 0) + (heroPlayer?.bet ?? 0)))} className="flex-1 bg-red-900/80 hover:bg-red-800 py-1.5 rounded-lg text-xs font-bold text-red-200 transition border border-red-500/50">{t("All-In")}</button>
                </div>
                <div className="flex gap-2 mt-1">
                  <input 
                    type="number" 
                    value={raiseAmount}
                    onChange={(e) => setRaiseAmount(e.target.value)}
                    className="flex-1 w-24 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white font-black text-lg focus:outline-none focus:border-cyan-500"
                    placeholder="$0"
                  />
                  <button 
                    onClick={() => handleHeroAction("raise", Number(raiseAmount))}
                    disabled={!canConfirmRaise}
                    className="bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:bg-slate-700 text-white font-black px-6 py-2 rounded-xl shadow-[0_4px_0_#991B1B] active:translate-y-1 active:shadow-none transition uppercase"
                  >
                    {t("Confirm")}
                  </button>
                </div>
                {isLiveMode && (
                  <div className="text-[11px] text-slate-300 mt-1">
                    Min raise to: <span className="text-cyan-300 font-bold">{liveMinRaiseTo}</span>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="action-buttons" className="flex gap-2 md:gap-4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <button 
                  onClick={() => handleHeroAction("fold")}
                  disabled={actionBusy}
                  className="bg-slate-700 hover:bg-slate-600 text-white font-bold px-6 py-4 md:px-10 md:py-5 rounded-xl md:rounded-2xl shadow-[0_6px_0_#334155] active:translate-y-2 active:shadow-none transition uppercase tracking-wider text-sm md:text-lg"
                >
                  {t("Fold")}
                </button>
                <button 
                  onClick={() => handleHeroAction("call")}
                  disabled={actionBusy}
                  className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-black px-6 py-4 md:px-10 md:py-5 rounded-xl md:rounded-2xl shadow-[0_6px_0_#A16207] active:translate-y-2 active:shadow-none transition uppercase tracking-wider text-sm md:text-lg"
                >
                  {isLiveMode
                    ? ((liveGame?.gameState?.minCallAmount ?? 0) > 0
                      ? `${t("Call")} ${liveGame?.gameState?.minCallAmount ?? 0}`
                      : t("Check"))
                    : (phase === "preflop" ? `${t("Call")} 50` : t("Check"))}
                </button>
                <button 
                  onClick={() => {
                    if (isLiveMode && liveMinRaiseTo > 0) {
                      setRaiseAmount(String(liveMinRaiseTo));
                    }
                    setIsRaising(true);
                  }}
                  disabled={actionBusy}
                  className="bg-red-500 hover:bg-red-400 text-white font-black px-6 py-4 md:px-10 md:py-5 rounded-xl md:rounded-2xl shadow-[0_6px_0_#991B1B] active:translate-y-2 active:shadow-none transition uppercase tracking-wider text-sm md:text-lg"
                >
                  {t("Raise")}
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spectator & Waitlist Controls */}
      {!isLiveMode && (
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center pointer-events-none">
         <AnimatePresence>
           {userState === "spectating" && (
             <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="flex flex-col items-center gap-3">
                <div className="bg-black/60 px-4 py-1.5 rounded-full border border-purple-500/50 text-purple-300 font-bold text-sm tracking-widest uppercase shadow-lg backdrop-blur-sm">
                  👁️ {t("Spectating Mode")}
                </div>
                {!isTournament ? (
                  <button 
                    onClick={() => { setUserState("waiting"); setLog("Added to waitlist. Waiting for next hand..."); }}
                    className="pointer-events-auto bg-gradient-to-b from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 px-8 py-3 rounded-xl font-black text-white shadow-[0_4px_0_#1D4ED8] active:translate-y-1 active:shadow-none transition-all uppercase tracking-wider"
                  >
                    {t("Sit In (Wait for next hand)")}
                  </button>
                ) : (
                  <div className="bg-black/60 px-6 py-2 rounded-xl font-bold text-white shadow-lg backdrop-blur-sm border border-white/10">
                    {t("Spectating Tournament")}
                  </div>
                )}
             </motion.div>
           )}
           {userState === "waiting" && (
             <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="flex flex-col items-center gap-3">
                <div className="bg-cyan-900/60 px-4 py-1.5 rounded-full border border-cyan-500/50 text-cyan-300 font-bold text-sm tracking-widest uppercase shadow-lg backdrop-blur-sm animate-pulse">
                  🕒 Waiting for next hand...
                </div>
                <button 
                  onClick={() => { setUserState("spectating"); setLog("Waitlist cancelled. Spectating."); }}
                  className="pointer-events-auto bg-slate-800 hover:bg-slate-700 px-8 py-3 rounded-xl font-black text-slate-300 border border-slate-600 shadow-lg transition-all uppercase tracking-wider"
                >
                  {t("Cancel (Spectate Only)")}
                </button>
             </motion.div>
           )}
           {userState === "eliminated" && (
             <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="flex flex-col items-center gap-3">
                <div className="bg-red-900/80 px-4 py-1.5 rounded-full border border-red-500/50 text-red-300 font-bold text-sm tracking-widest uppercase shadow-lg backdrop-blur-md flex items-center gap-2">
                  <span>💀</span> {t("Eliminated")}
                </div>
                <div className="bg-black/80 px-6 py-3 rounded-xl font-black text-white shadow-xl backdrop-blur-md border border-white/10 text-center">
                  {t("You busted out!")} <br/>
                  <span className="text-slate-400 font-bold text-xs uppercase tracking-wider">{t("Now Spectating Tournament")}</span>
                </div>
             </motion.div>
           )}
         </AnimatePresence>
      </div>
      )}

      <button className="absolute bottom-4 md:bottom-8 left-4 md:left-8 p-3 md:p-5 bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-xl border-2 border-indigo-400/30 text-white transition z-40">
        <MessageCircle className="w-6 h-6 md:w-8 md:h-8" />
      </button>

      {/* Table Breaking Overlay */}
      <AnimatePresence>
        {isTableBreaking && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[#1A1A4A]/95 backdrop-blur-xl"
          >
            <Trophy className="w-20 h-20 md:w-28 md:h-28 text-yellow-400 mb-6 md:mb-8 animate-bounce drop-shadow-[0_0_30px_rgba(250,204,21,0.6)]" />
            <h2 className="text-4xl md:text-6xl font-black text-white uppercase tracking-widest text-center mb-3 md:mb-4 drop-shadow-xl">
              {t("Table Breaking")}
            </h2>
            <p className="text-lg md:text-2xl text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2 md:gap-3 drop-shadow-md">
              <Users className="w-5 h-5 md:w-6 md:h-6"/>
              {t("Moving to")} <span className="text-yellow-400 border-b-2 border-yellow-400 pb-0.5 md:pb-1">{nextStageName}</span>...
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bot Addition Modal */}
      <AnimatePresence>
        {selectedSeat !== null && canAddBotToRoom && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl p-6"
            >
               <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
                 <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                   <Users className="text-cyan-400 w-6 h-6"/> {t("Add Bot")}
                 </h3>
                 <button onClick={() => setSelectedSeat(null)} className="text-slate-400 hover:text-white transition">
                   <X className="w-6 h-6" />
                 </button>
               </div>
               
                 <div className="flex flex-col gap-4">
                 <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{t("AI Model")}</label>
                   <select
                     value={botModelId}
                     onChange={(event) => setBotModelId(event.target.value)}
                     className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition"
                   >
                     {BOT_MODEL_OPTIONS.map((option) => (
                       <option key={option.id} value={option.id} disabled={Boolean(option.proOnly && !isPro)}>
                         {option.proOnly && !isPro ? `🔒 ${option.label} (PRO)` : option.label}
                       </option>
                     ))}
                   </select>
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase mb-2">{t("Play Style")}</label>
                   <select
                     value={botStyle}
                     onChange={(event) => setBotStyle(event.target.value as BotStyle)}
                     className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition"
                   >
                     <option value="balanced">{t("Balanced")}</option>
                     <option value="aggressive">{t("Aggressive")}</option>
                     <option value="tight">{t("Tight")}</option>
                   </select>
                 </div>
                 <button 
                   onClick={() => {
                     const addBot = async () => {
                       const selectedModel = BOT_MODEL_OPTIONS.find((option) => option.id === botModelId) ?? BOT_MODEL_OPTIONS[0];
                       if (selectedModel.proOnly && !isPro) {
                         alert(t("This AI model is available for PRO only."));
                         return;
                       }
                       if (selectedSeat === null) return;

                       if (isLiveMode) {
                         setLiveBusy(true);
                         try {
                           await apiFetch(`/rooms/${roomId}/seats/${selectedSeat + 1}/bot`, {
                             method: "POST",
                             body: JSON.stringify({
                               modelTier: selectedModel.modelTier,
                               provider: selectedModel.provider,
                               style: botStyle,
                               model: selectedModel.model,
                             }),
                           });
                           setSelectedSeat(null);
                           await syncLiveTable();
                         } catch (error) {
                           alert(error instanceof Error ? error.message : t("Failed to add bot."));
                         } finally {
                           setLiveBusy(false);
                         }
                         return;
                       }

                       const newId = `p${selectedSeat}`;
                       const avatarInfo = createRandomAvatarInfo();
                       const avatarSeed = `bot-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
                       const newBot: Player = {
                         id: newId,
                         name: `${selectedModel.label} (${botStyle})`,
                         pos: selectedSeat,
                         role: "BTN",
                         avatarSeed,
                         avatarUrl: toAvatarUrl(avatarSeed, avatarInfo),
                         chips: 10000,
                         bet: 0,
                         status: "active",
                         cardsDealt: false,
                         holeCards: [],
                       };
                       setPlayers(prev => [...prev, newBot]);
                       setSelectedSeat(null);
                     };

                     void addBot();
                   }}
                   className="mt-4 w-full bg-cyan-600 hover:bg-cyan-500 text-white font-black py-4 rounded-xl transition shadow-lg flex items-center justify-center gap-2 uppercase tracking-wider"
                 >
                   <Plus className="w-5 h-5"/> {t("Add Bot")}
                 </button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 20 }}
              className="bg-[#242754] w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-lg font-black uppercase tracking-wider flex items-center gap-2">
                  <Users className="text-cyan-400 w-5 h-5" /> {t("Invite Friends")}
                </h3>
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="text-slate-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 flex flex-col gap-3 max-h-[65vh] overflow-y-auto">
                <p className="text-sm text-slate-300 font-semibold">
                  {t("Only private room invites are supported.")}
                </p>

                {inviteNotice ? (
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200">
                    {inviteNotice}
                  </div>
                ) : null}

                {inviteBusy ? (
                  <div className="rounded-lg border border-white/10 bg-[#11122D] px-3 py-3 text-sm font-semibold text-slate-300">
                    {t("Loading...")}
                  </div>
                ) : inviteFriends.length === 0 ? (
                  <div className="rounded-lg border border-white/10 bg-[#11122D] px-3 py-3 text-sm font-semibold text-slate-300">
                    {t("No friends added yet.")}
                  </div>
                ) : (
                  inviteFriends.map((friend) => (
                    <div
                      key={friend.id}
                      className="bg-[#11122D] border border-white/10 rounded-lg px-3 py-3 flex items-center justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="text-white font-bold">{friend.nickname}</span>
                        <span className="text-[11px] uppercase tracking-wider text-slate-400">{friend.role}</span>
                      </div>
                      <button
                        onClick={() => {
                          void handleSendRoomInvite(friend.id);
                        }}
                        disabled={inviteBusy}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-black uppercase tracking-wider"
                      >
                        {t("Invite")}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
