// The PlayerView brand (ADR-0002, D7). A PlayerView can only be created by code in this folder: projectView
// (the single exit) and the receive-side helper that validateEnvelope uses for H.VIEW (D-P1).
//
// The brand symbol is a `declare const` that is never exported, so no other module can spell the brand
// property. `x as PlayerView` would still compile anywhere; the lead's lint rule bans that assertion outside
// projection/**, session/fake.ts and tests (D-L10).
import type { PlayerViewShape } from '../protocol/view-types';

declare const playerViewBrand: unique symbol;

export type PlayerView = PlayerViewShape & { readonly [playerViewBrand]: true };

/** Internal to projection/**. Not re-exported by any index. */
export function brandView(shape: PlayerViewShape): PlayerView {
  return shape as PlayerView;
}
