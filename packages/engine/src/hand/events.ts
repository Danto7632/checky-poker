// Engine events (api.engine.v1 EngineEvent). They tell the table reducer WHAT happened so it can schedule
// timers and update seats; they never carry cards (the table reads cards from the sealed state when it
// projects), so an event logged or forwarded by mistake cannot leak a hand.
import type { SeatIndex, Street } from '../protocol/view-types';

export type EngineEvent =
  | { t: 'BlindPosted'; seat: SeatIndex; amount: number }
  | { t: 'HoleDealt'; seats: SeatIndex[] }
  | { t: 'Acted'; seat: SeatIndex; index: number }
  | { t: 'StreetDealt'; street: Street; count: number }
  | { t: 'RunoutStarted' }
  | { t: 'UncalledReturned'; seat: SeatIndex; amount: number }
  | { t: 'Revealed'; seats: SeatIndex[] }
  | { t: 'PotAwarded'; index: number; winners: SeatIndex[]; shares: number[] }
  | { t: 'HandCompleted' };
