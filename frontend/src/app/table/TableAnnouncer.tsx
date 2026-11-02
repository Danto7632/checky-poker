// TableAnnouncer (components.md 3.13): one visually hidden polite region and one assertive region.
// polite: my turn starting ("Your turn. To call 2,400."), other seats' actions, each new street's board, the result,
//   pause pending / pause cancelled / paused.
//   Other seats' actions are throttled to one per second, leading + trailing: the first is read at once; actions
//   that arrive inside the second are collapsed and the LAST of them is read when the second ends (review m6), so a
//   quick run of bot actions ends on the most recent one. Any other announcement (turn, board, result, pause) is newer
//   state and cancels a pending action, so nothing is read out of order.
//   One snapshot can carry several of these at once: the engine applies a bot's action, deals the next street and
//   hands me the turn in a single view. When my turn starts, everything that led to it is read first, in the order
//   it happened — the action ("Rex: Raised to 2,400"), then a new board — and the turn line last (R0-L21, review N-1:
//   the turn branch used to return before the action was looked at, so a raise to me was never read). The lines go
//   into the polite region as one update of separate paragraphs, so they are read in DOM order, each as a sentence.
// assertive: "5 seconds left" on my turn, only when the turn has a clock (never in No limit). Every new turn empties
//   the region (lead review 3 R0-L26), so the warning of the next timed turn is new text again.
// Repeats (MS-R0-3 run 2 D-R2-2 and the audit after it): a screen reader announces what CHANGES in a live region's DOM,
//   so a sentence equal to the one already shown is silent — the second turn's "5 seconds left", "Paused" after
//   Resume -> Pause, the same "Your turn. To call N." twice, and in a multi-line update a line that sits at the same
//   place as before ("Your turn." after a check-check street). Both regions therefore go through useLiveRegion:
//   lines that repeat anything shown are put in after the region was empty for a moment. ("Pausing before the next
//   hand" after Keep playing -> Pause is no repeat any more: "Pause cancelled" is shown in between.)
// Focus never moves on my turn (a half-typed chat message must not be stolen).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@checky/engine/protocol';
import { useCardLabel } from '../cards/PlayingCard';
import { useI18n, type MessageKey } from '../i18n/useT';
import { formatChips, pauseState, type TurnClock } from './format';
import { secondsOf, useCountdown } from './useCountdown';

// ui-spec T-02 action.* (past tense): call announces the chips added, bet/raise/all-in the street total.
const ACTION_KEY: Readonly<Record<string, MessageKey>> = {
  fold: 'action.fold',
  check: 'action.check',
  call: 'action.call',
  bet: 'action.bet',
  raise: 'action.raise',
  allin: 'action.allIn',
};
const THROTTLE_MS = 1000;
/**
 * How long a region stays empty before lines it already showed go back in. Clearing and refilling in the same frame
 * is not enough for every browser + screen reader pair (Angular CDK's LiveAnnouncer clears and waits 100 ms for the
 * same reason: NVDA and JAWS on Chrome skip an identical message otherwise).
 * ponytail: fixed 100 ms from that precedent, not measured here with a screen reader; raise it if NVDA, JAWS or
 * VoiceOver testing (W6 a11y pass) finds a refill that is still skipped.
 */
const REFILL_MS = 100;
const NONE: readonly string[] = [];

/**
 * One live region's lines. announce(lines) shows them at once when none of them is on screen; when any is, the region
 * is emptied now and filled REFILL_MS later, so the repeat is a real removal + insertion. A newer announce() replaces
 * a refill still waiting (newest wins, like the action throttle). announce([]) empties the region.
 */
function useLiveRegion(): [readonly string[], (lines: readonly string[]) => void] {
  const [lines, setLines] = useState(NONE);
  // What the DOM holds: updated after commit, so two announce() calls in one effect pass compare with the screen.
  const shown = useRef(NONE);
  const refill = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    shown.current = lines;
  }, [lines]);
  const announce = useCallback((next: readonly string[]) => {
    if (refill.current !== null) clearTimeout(refill.current);
    refill.current = null;
    if (next.some((line) => shown.current.includes(line))) {
      setLines(NONE);
      refill.current = setTimeout(() => {
        refill.current = null;
        setLines(next);
      }, REFILL_MS);
    } else {
      setLines(next.length === 0 ? NONE : next);
    }
  }, []);
  useEffect(
    () => () => {
      if (refill.current !== null) clearTimeout(refill.current);
    },
    [],
  );
  return [lines, announce];
}

export function TableAnnouncer({ view, myTurn }: { view: PlayerView; myTurn: TurnClock | null }) {
  const { t, lang } = useI18n();
  const cardLabel = useCardLabel();
  const [polite, announcePolite] = useLiveRegion();
  const [assertive, announceAssertive] = useLiveRegion();
  const prev = useRef<PlayerView | null>(null);
  const lastSpoken = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTrailing = () => {
    if (trailing.current !== null) clearTimeout(trailing.current);
    trailing.current = null;
  };
  const hand = view.hand;
  const turnKey = hand ? `${hand.handId}:${hand.turnSeq}` : 'none';
  const left = useCountdown(myTurn?.remainingMs ?? null, turnKey, view.room.phase === 'PAUSED');

  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (before === null) return;
    const nameOf = (seat: number) => view.seats.find((s) => s.seat === seat)?.occupant?.name ?? '';
    const say = (...lines: string[]) => {
      cancelTrailing();
      lastSpoken.current = Date.now();
      announcePolite(lines);
    };
    const h = view.hand;
    const bh = before.hand;
    const state = pauseState(view.room.paused, view.room.phase);
    const beforeState = pauseState(before.room.paused, before.room.phase);
    if (state !== beforeState && state !== 'running') return say(t(state === 'pending' ? 'table.pausing' : 'table.paused.self'));
    // Keep playing (HUD, menu or P) cancelled the pause booked for the end of this hand (ui-spec T-01 pause table).
    // The menu sheet closes on it (D-R3-2), so this line is the confirmation; Resume from PAUSED reads nothing (the
    // deal and the turn line follow at once).
    if (beforeState === 'pending' && state === 'running') return say(t('table.pauseCancelled'));
    if (view.result !== null && before.result === null) {
      const pot = view.result.pots[0];
      const winner = pot?.winners[0];
      if (pot && winner !== undefined) return say(t('result.wins', { name: nameOf(winner), n: formatChips(pot.shares[0] ?? pot.amount, lang) }));
    }
    const sameHand = h !== null && bh !== null && h.handId === bh.handId;
    // The newest action of another seat in this snapshot (blinds and my own actions are never read).
    const a = sameHand && h.actions.length > bh.actions.length ? h.actions[h.actions.length - 1] : undefined;
    const key = a && a.seat !== view.me.seat && a.type !== 'post_sb' && a.type !== 'post_bb' ? ACTION_KEY[a.type] : undefined;
    const actionLine = a && key ? t('table.sr.action', { name: nameOf(a.seat), action: t(key, { n: formatChips(a.type === 'call' ? a.added : a.to, lang) }) }) : null;
    const boardLine = sameHand && h.board.length > bh.board.length ? t('board.label', { cards: h.board.map(cardLabel).join(t('common.listSep')) }) : null;
    const mine = view.me.legal !== null && h !== null && h.toAct === view.me.seat;
    if (mine && (bh === null || h.turnSeq !== bh.turnSeq || h.handId !== bh.handId)) {
      const toCall = view.me.legal?.call?.amount ?? 0;
      const turnLine = toCall > 0 ? t('table.sr.turn', { n: formatChips(toCall, lang) }) : t('table.yourTurn');
      // R0-L21: what handed me the turn comes first, the turn line last — all in this one polite update.
      return say(...[actionLine, boardLine, turnLine].filter((line): line is string => line !== null));
    }
    if (boardLine !== null) return say(boardLine);
    if (actionLine !== null) {
      const wait = THROTTLE_MS - (Date.now() - lastSpoken.current);
      if (wait <= 0) return say(actionLine);
      cancelTrailing(); // a newer action replaces the one waiting
      trailing.current = setTimeout(() => say(actionLine), wait);
    }
  }, [view, t, lang, cardLabel, announcePolite]);
  useEffect(() => cancelTrailing, []);

  // Each turn starts with an empty assertive region (R0-L26). Declared before the warning so that, in the one pass
  // where a turn starts with 5 s or less already, the clear runs first and the warning still counts as a repeat.
  useEffect(() => announceAssertive(NONE), [turnKey, announceAssertive]);
  // The 5-second warning fires once per turn, only with a clock.
  const warned = useRef<string | null>(null);
  useEffect(() => {
    if (myTurn === null || left === null || secondsOf(left) > 5 || warned.current === turnKey) return;
    warned.current = turnKey;
    announceAssertive([t('table.sr.secondsLeft', { s: '5' })]);
  }, [myTurn, left, turnKey, t, announceAssertive]);

  return (
    <>
      <div aria-live="polite" className="sr-only" data-testid="T-01.announcePolite">
        {polite.map((line, i) => (
          // Index keys on purpose: a line that changes text in place is a change the screen reader reads.
          <p key={i}>{line}</p>
        ))}
      </div>
      <div aria-live="assertive" className="sr-only" data-testid="T-01.announceAssertive">
        {assertive.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </>
  );
}
