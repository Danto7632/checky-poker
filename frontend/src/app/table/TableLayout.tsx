// TableLayout (components.md 3.1): HUD on top, felt + my area in the middle (the only part that scrolls), the bottom
// slot (`actionBar`: action bar, Check/Fold, or the next step — BottomSlot) pinned under it, so the slot is always in
// view. Seats are placed by SeatRing inside the felt; the felt area keeps padding so seats drawn outside the felt box
// (my seat at y = 104%, the top seats at y < 0) are not clipped. Layout C (landscape phone) reuses this frame with the
// smaller tokens; the side panel (>= 1024) arrives with chat in 2-3.
//
// Vertical fit (lead review 3 R0-L28, MS-R0-3 run 2 D-R2-3: at 1280x757 the top seat sat under the HUD, and its
// revealed cards were never visible):
// - Safe centring. A scroll box can only scroll to what overflows at its END; what a centred column pushes out at the
//   top cannot be reached. So the column is centred with auto margins (mt-auto / mb-auto) instead of
//   justify-content: center — centred while it fits, starting at the top once it overflows, the extra below where it
//   scrolls into view. Auto margins behave like `safe center` in every engine without relying on that keyword.
// - Room above and below the felt = how far the seat blocks reach out of it. A block is centred on its seat point, so
//   it reaches half its height past the felt edge, and a block grows when the seat shows its cards (showdown). Chrome,
//   4 seats: the top seat reaches 71-85 px above the felt during a hand and 100-112 px with its cards shown (A:
//   1280x757, 1024x768, 1366x657, 768x1024, 1920x1080), the top rail seats of B about 56 / 83 px (360x640, 375x667);
//   my seat reaches 66-75 / 93-113 px below. The old fixed 56 px above / 96 px below hid the top seat in both states.
//   So `seatCards` (a seat shows its cards) picks the room: during a hand A takes 80 above and 72 below — the same
//   152 px as before, so my area moves no further down — and with cards shown 112 / 96 (B: 60 / 96, then 88 / 96).
//   The felt moves 32 px at showdown in A (the centred column moved 47 px before, as the result panel came in).
// ponytail: room from those measurements with --felt-chrome unchanged, so a short screen still overflows: at 1280x757
// the lower LiveOdds lines (my turn) and the result panel (between hands) are below the fold and scroll into view;
// re-measure when the seat block or the --felt-chrome budget changes (F-JN-B1 at the start of 2-3 re-estimates both).
//
// Horizontal fit (lead review 4 D-R3-1, MS-R0-3 run 3: at 768x1024 the side seats of a 4-seat table were cut 25 px
// on both sides — the left part out of scroll reach — under a horizontal scrollbar; Chrome over every width and seat
// count found the same at 360x640 / 375x667 for 5-6 seats, 5.8 / 4.6 px). A side block (112 px wide in A, 96 in B)
// is centred on its seat point, so it reaches half its width minus the point's inset out of the felt. Two point sets
// sit close enough to the felt's sides to pass the column's own 16 px: layout A's 4-seat x = 2 / 98 % and layout
// B's 5-6-seat rail x = 8 / 92 %. Where the felt fills the column width (A from 768 until the height caps it, B on
// phones) they need 56 - 0.02 W and 48 - 0.08 W px, so for those tables only the felt row adds 28 px a side in A
// (44 in all; at 768 the felt is 680 and needs 42.4) and 8 px in B (24 in all; at 360 the felt is 312 and needs
// 23.0). The felt keeps its width rule and --felt-chrome; it just has a narrower row to fill (768x1024, 4 seats:
// 736 -> 680; 360x640 / 375x667, 5-6 seats: 328 -> 312 / 343 -> 327). Where the height caps the felt (1024x768 and
// wider) the row is wider than the felt anyway, and every other table keeps its felt as it was.
// ponytail: room from those two point sets and block widths at the narrowest width-bound viewport (A 768, B 360 —
// the lead's widths), not computed from the live geometry; TableScreen.test.tsx recomputes it from layout.ts, so
// change the room with the seat points, the block width or the column padding. Below 348 px wide a 5-6-seat B table
// still cuts its side seats (2.2 px at 320), and B's narrower felt brings its side seats ~7 px further over the
// board (overlap F-JN-B1 owns); re-estimate both at F-JN-B1 or when 320-347 px phones join the MS widths.
import type { ReactNode } from 'react';

/** Extra felt-row padding a side, by seat count (D-R3-1); the counts not listed fit in the column padding. */
const SIDE_ROOM: Readonly<Record<number, string>> = { 4: 'md:px-7', 5: 'px-2 md:px-0', 6: 'px-2 md:px-0' };

export interface TableLayoutProps {
  hud: ReactNode;
  felt: ReactNode;
  hero: ReactNode;
  actionBar: ReactNode;
  /** A seat block shows its cards (OccupantInHand.cards, showdown): the blocks are taller, the felt needs more room. */
  seatCards: boolean;
  /** Seats on the table (PlayerView.seats.length): picks the side room the side seat blocks need. */
  seatCount: number;
}

export function TableLayout({ hud, felt, hero, actionBar, seatCards, seatCount }: TableLayoutProps) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {hud}
      {/* One <main> landmark for the felt, my area and the action bar (axe "region"). */}
      <main className="flex min-h-0 flex-1 flex-col">
        <div
          className={`flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-4 pb-2 ${seatCards ? 'pt-22 md:pt-28' : 'pt-15 md:pt-20'}`}
          data-testid="T-01.scroll"
          data-seat-cards={seatCards}
        >
          <div className={`mt-auto flex w-full justify-center ${seatCards ? 'pb-24' : 'pb-24 md:pb-18'} ${SIDE_ROOM[seatCount] ?? ''}`} data-testid="T-01.feltRow">
            {felt}
          </div>
          <div className="mb-auto flex w-full max-w-table flex-wrap items-start justify-center gap-4">{hero}</div>
        </div>
        {actionBar}
      </main>
    </div>
  );
}
