// Nickname form rule shared by P-01 and S-01 (US2 AC2, M3A-11). Validity itself is the engine's normalizeNickname
// (trim + code points 1..DV16), the same function storage and the host use, so screen and storage never disagree.
//   ''        -> 'empty', shown only after the field lost focus (the form does not start red)
//   '   '     -> 'spaces', immediately
//   17+ cps   -> 'long', immediately
import { normalizeNickname } from '@checky/engine/protocol';

export type NicknameProblem = 'empty' | 'spaces' | 'long';

export function nicknameProblem(raw: string, limits: { readonly min: number; readonly max: number }): NicknameProblem | null {
  if (raw === '') return 'empty';
  if (raw.trim() === '') return 'spaces';
  if (normalizeNickname(raw, limits) === null) return 'long';
  return null;
}

/** The problem to show right now: 'empty' waits for blur, the others show at once. */
export function visibleProblem(problem: NicknameProblem | null, blurred: boolean): NicknameProblem | null {
  return problem === 'empty' && !blurred ? null : problem;
}

export function errorCode(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}
