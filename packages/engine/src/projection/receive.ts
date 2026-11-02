// D-P1: the receive side's only way to obtain a PlayerView. validateEnvelope(raw, 'to_guest') checks the H.VIEW
// body structurally and then calls this helper. Internal to the engine — not exported by any index, so app or
// session code cannot brand an arbitrary object.
import type { PlayerViewShape } from '../protocol/view-types';
import { brandView, type PlayerView } from './brand';

export function acceptReceivedView(shape: PlayerViewShape): PlayerView {
  return brandView(shape);
}
