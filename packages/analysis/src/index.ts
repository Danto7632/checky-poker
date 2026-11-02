// @checky/analysis public API (api.analysis.v1 + bot.io.v1 types). DOM, network, clock and global randomness: 0.
export { computeMetrics } from './metrics/metrics';
export { decideRuleBot } from './bot/rule-bot';
/** The display exact-enumeration budget: the metrics Worker starts from it and lowers it after E-ANL-SLOW (D-S7). */
export { DISPLAY_EXACT_LIMIT } from './metrics/equity';
export type {
  AbortSignalLike,
  BotDecider,
  BotDecision,
  BotInput,
  DeciderEvent,
  DecisionMetrics,
  MetricsPrecision,
  MetricsView,
  Usage,
} from './bot/contract';
