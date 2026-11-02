// @checky/engine — hand rules (api.engine.v1 A-ENG-*): pure functions, no DOM, network, clock or global random.
// analysis reuses the evaluator from here (no second evaluator, WR7); 1-2's 10,000-hand simulation drives
// createHand/legalActions/applyAction (I-27, MS-R0-2).
export { evaluate7, compareRanks, rankLabel } from './cards/evaluator';
export type { HandRank } from './cards/evaluator';
export { positionLabels } from './cards/positions';
export { cardIndex, cardString, isCard } from './cards/card';
export { createHand } from './hand/create';
export type { HandInit } from './hand/create';
export { legalActions } from './hand/legal';
export { applyAction, forceFold } from './hand/apply';
export type { Applied } from './hand/apply';
export { advanceRunout } from './hand/runout';
export { voidHand } from './hand/void';
export type { EngineEvent } from './hand/events';
export type { HandState } from './hand/state';
