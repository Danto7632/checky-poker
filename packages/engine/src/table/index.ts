// @checky/engine/table — the room state machine run by the host Worker (api.engine.table.v1).
export { createTable, reduceTable } from './reduce';
export { RUNOUT_DELAYS_MS } from './timers';
export type {
  Clock,
  Effect,
  PendingBot,
  ReduceCtx,
  Reduced,
  SitOutReason,
  TableBotDecision,
  TableInput,
  TableSeat,
  TableState,
  Viewer,
} from './state';
