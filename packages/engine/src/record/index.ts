// @checky/engine/record — self-view hand records, replay and rank labels (api.engine.record.v1).
// storage and share may import only record and util, so the shared domain types they persist are re-exported here.
export type { HandRecordV1, HandSummary, ReplayFrame } from './types';
export type {
  ActionLogEntry,
  BotReveal,
  BotSpec,
  Card,
  Lang,
  ProviderId,
  RankCode,
  RankDetail,
  RecordMode,
  RoomSettings,
} from '../protocol/view-types';
export { summarizeRecord } from './summary';
export { upgradeRecord } from './upgrade';
export { createRecordBuilder } from './builder';
export type { RecordBuilder } from './builder';
export { replayFrames, verifyReplay } from './replay';
export { rankCode, rankDetail } from './rank';
