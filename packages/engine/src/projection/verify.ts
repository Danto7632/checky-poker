// A-PROJ-VERIFY: line of defence 2 (ADR-0002). Run on EVERY outgoing view, release builds included.
//
// It recomputes, independently of project.ts, the set of cards this viewer may see, then walks ONLY the
// card-typed fields of the view. A card outside the set throws E-PROJ-LEAK-BLOCKED and the caller drops the
// message. It deliberately does not search strings: a nickname 'Kd' or a random handId must never stop a game.
// The visibility rules are written out again here on purpose — a bug shared with projectView would otherwise
// pass both lines of defence.
import { cardString } from '../cards/card';
import type { TableState, Viewer } from '../table/state';
import { CheckyError } from '../util/checky-error';
import type { PlayerView } from './brand';

function allowedCards(t: TableState, viewer: Viewer): Set<string> {
  const allowed = new Set<string>();
  const hand = t.hand;
  if (hand === null) return allowed;
  const add = (cards: readonly number[]): void => {
    for (const c of cards) allowed.add(cardString(c));
  };
  // A dealt board is public; it stays public after a void (close now, E-ENG-INVARIANT) — R0 M3. Hole cards of a
  // voided hand are never shown to anyone, own ones included.
  add(hand.board);
  if (hand.street === 'VOIDED') return allowed;
  const meSeat = viewer.kind === 'seat' || viewer.kind === 'bot' ? viewer.seat : null;
  for (const p of hand.seats) {
    const isBot = t.seats[p.seat]?.kind === 'bot';
    const own = p.seat === meSeat;
    // R12: from SHOWDOWN on every live seat shows; at COMPLETE exactly the seats listed in the showdown.
    const shownAtShowdown =
      !p.folded &&
      (hand.street === 'SHOWDOWN' || (hand.street === 'COMPLETE' && (hand.result?.showdown.some((x) => x.seat === p.seat) ?? false)));
    const botAfterHand = hand.street === 'COMPLETE' && isBot;
    const arenaBot = viewer.kind === 'arena' && isBot;
    if (own || shownAtShowdown || botAfterHand || arenaBot) add(p.hole);
  }
  return allowed;
}

export function verifyView(view: PlayerView, t: TableState, viewer: Viewer): void {
  const allowed = allowedCards(t, viewer);
  const check = (cards: readonly string[] | null | undefined): void => {
    if (cards === null || cards === undefined) return;
    for (const c of cards) if (!allowed.has(c)) throw new CheckyError('E-PROJ-LEAK-BLOCKED');
  };
  check(view.me.holeCards);
  for (const s of view.seats) check(s.occupant?.inHand?.cards);
  check(view.hand?.board);
  for (const x of view.result?.showdown ?? []) {
    check(x.cards);
    check(x.best5);
  }
  for (const r of view.result?.botReveals ?? []) check(r.holeCards);
  for (const b of view.arena?.bots ?? []) check(b.holeCards);
}
