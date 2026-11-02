// frontend/src/ai public API (api.ai.v1). This story (1-2) provides the metrics Worker client and the mock
// decider; keys, providers, the LLM decider and coaching arrive in 2-2 / 3-2.
export { computeMetricsAsync, prewarmMetrics } from './metrics/client';
export { createMockDecider } from './testing/mock-provider';
export type { MockDeciderOpts } from './testing/mock-provider';
