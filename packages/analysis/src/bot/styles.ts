// Rule-bot style parameters (SS14 rule 3: a style is a parameter bundle). Design values, not measured results;
// the only hard constraint is VPIP aggressive > balanced > tight over 1,000 simulated hands (SS14-AC2), which
// packages/analysis/test/sim/vpip.test.ts checks.
//
// Preflop ranges are "top x of all 1,326 combos" (preflop.ts). Postflop strength is equity vs N random hands
// scaled by N + 1, so 1.0 means "as good as an average random hand" whatever the number of opponents.
import type { BotStyle } from '@checky/engine/protocol';

export interface StyleParams {
  /** Unopened or limped pot: raise with the top fraction. */
  openTop: number;
  /** Facing a raise: call with the top fraction (and only when equity covers the price, see callSlack). */
  callTop: number;
  /** Facing a raise: re-raise with the top fraction. */
  threeBetTop: number;
  /** Open raise in big blinds, plus one big blind per limper. */
  openSizeBb: number;
  /** Chance to bet when checked to with a weak hand postflop, and to open a hand just outside openTop. */
  bluffFreq: number;
  /** Postflop: bet when strength >= this. */
  valueStrength: number;
  /** Postflop facing a bet: raise when strength >= this. */
  raiseStrength: number;
  /** Call when equity >= required equity - callSlack (positive = looser than pot odds). */
  callSlack: number;
  /** Bet and raise sizes as pot fractions; one is picked with the Rng. */
  sizes: readonly number[];
}

export const STYLES: Readonly<Record<BotStyle, StyleParams>> = {
  aggressive: {
    openTop: 0.42,
    callTop: 0.3,
    threeBetTop: 0.12,
    openSizeBb: 3,
    bluffFreq: 0.3,
    valueStrength: 1.15,
    raiseStrength: 1.5,
    callSlack: 0.04,
    sizes: [0.5, 0.75, 1],
  },
  balanced: {
    openTop: 0.26,
    callTop: 0.18,
    threeBetTop: 0.06,
    openSizeBb: 2.5,
    bluffFreq: 0.12,
    valueStrength: 1.3,
    raiseStrength: 1.7,
    callSlack: 0,
    sizes: [0.5, 0.66],
  },
  tight: {
    openTop: 0.14,
    callTop: 0.09,
    threeBetTop: 0.03,
    openSizeBb: 2.5,
    bluffFreq: 0.04,
    valueStrength: 1.45,
    raiseStrength: 1.85,
    callSlack: -0.03,
    sizes: [0.5, 0.66],
  },
};
