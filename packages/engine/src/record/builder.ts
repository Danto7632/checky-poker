// A-REC-BUILD: a self-view hand record built ONLY from PlayerViews this device received (D12, SS23). There is no
// function that takes TableState or HandState here, so a record cannot contain anything the viewer never saw:
// other humans' unshown cards, the deck, future board, rpk, keys or room codes are structurally absent.
//
// onView(v) returns exactly one record per hand, when that hand's view first reaches street COMPLETE with its
// result; a VOIDED hand never produces one. onChat keeps BOT lines of the current hand only (human and system
// chat is never stored, SS23 rule 4). playedAt is '' — session record-sink stamps the device time (S11-F09).
import type { PlayerView } from '../projection/brand';
import type { ChatLine, RecordMode } from '../protocol/view-types';
import type { HandRecordV1 } from './types';

export interface RecordBuilder {
  onView(v: PlayerView): HandRecordV1 | null;
  onChat(line: ChatLine): void;
}

export function createRecordBuilder(ctx: { mode: RecordMode; appVersion: string }): RecordBuilder {
  let currentHand: string | null = null;
  const done = new Set<string>();
  let botChat: HandRecordV1['botChat'] = [];
  let lastView: PlayerView | null = null;

  const startHand = (handId: string): void => {
    if (currentHand === handId) return;
    currentHand = handId;
    botChat = [];
  };

  return {
    onView(v) {
      lastView = v;
      const hand = v.hand;
      if (hand === null) return null;
      startHand(hand.handId);
      if (done.has(hand.handId)) return null;
      if (hand.street === 'VOIDED') {
        done.add(hand.handId);
        return null;
      }
      const result = v.result;
      if (hand.street !== 'COMPLETE' || result === null || result.handId !== hand.handId) return null;
      done.add(hand.handId);
      const meSeat = v.me.seat;
      const dealt = new Set(hand.startStacks.map((x) => x.seat));
      const record: HandRecordV1 = {
        v: 1,
        id: hand.handId,
        handId: hand.handId,
        no: hand.no,
        playedAt: '',
        mode: ctx.mode,
        lang: v.room.lang,
        appVersion: ctx.appVersion,
        table: {
          seatCount: v.room.settings.seatCount,
          sb: v.room.settings.sb,
          bb: v.room.settings.bb,
          buttonSeat: hand.buttonSeat,
          sbSeat: hand.sbSeat,
          bbSeat: hand.bbSeat,
        },
        seats: hand.startStacks.map((x) => {
          const o = v.seats[x.seat]?.occupant ?? null;
          const kind = x.seat === meSeat ? ('me' as const) : o?.kind === 'bot' ? ('bot' as const) : ('human' as const);
          return { seat: x.seat, kind, name: o?.name ?? '', bot: o?.bot ? { ...o.bot } : null, startStack: x.stack };
        }),
        me: { seat: meSeat !== null && dealt.has(meSeat) ? meSeat : null, holeCards: meSeat !== null && dealt.has(meSeat) ? v.me.holeCards : null },
        actions: hand.actions.map((a) => ({ ...a })),
        board: [...hand.board],
        showdown: result.showdown.map((x) => ({ seat: x.seat, cards: [...x.cards], rank: x.rank })),
        pots: result.pots.map((p) => ({ ...p, eligible: [...p.eligible], winners: [...p.winners], shares: [...p.shares] })),
        returned: result.returned.map((x) => ({ ...x })),
        endStacks: result.endStacks.map((x) => ({ ...x })),
        botReveals: structuredCopy(result.botReveals),
        botChat,
        coaching: null,
        shared: null,
      };
      return record;
    },
    onChat(line) {
      if (line.kind !== 'bot' || line.seat === null || line.handId === null) return;
      startHand(line.handId);
      // Tie the line to the bot's latest action this device saw (null before its first action).
      const actionIndex = lastView?.hand?.handId === line.handId ? (lastView.seats[line.seat]?.occupant?.inHand?.lastActionIndex ?? null) : null;
      botChat.push({ seat: line.seat, actionIndex, text: [...line.text].slice(0, 120).join('') });
    },
  };
}

/** Plain-data deep copy (records must not alias view objects the UI may still hold). */
function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
