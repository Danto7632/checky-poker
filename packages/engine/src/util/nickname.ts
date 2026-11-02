// The one Nickname rule (types.core.v1 Nickname, DV16, M3A-11): trim, then count CODE POINTS, not UTF-16
// units, so one emoji counts as 1. storage profile.save, the host G.HELLO check (2-1) and the app P-01 form
// must agree, so they all call this function (app reaches it through @checky/engine/protocol).
//
// The limits come from config defaults.DV16 at the call site: the engine does not hard-code DV numbers.
//
//   normalizeNickname('  Kai  ', {min: 1, max: 16})  -> 'Kai'
//   normalizeNickname('   ', {min: 1, max: 16})      -> null
//   normalizeNickname('😀'.repeat(16), {min:1,max:16}) -> 16 emoji (valid)
export function normalizeNickname(raw: string, limits: { readonly min: number; readonly max: number }): string | null {
  const trimmed = raw.trim();
  const codePoints = [...trimmed].length;
  return codePoints >= limits.min && codePoints <= limits.max ? trimmed : null;
}
