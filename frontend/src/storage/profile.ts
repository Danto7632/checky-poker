// profile store (A-STO-PROFILE): {key:'me', nickname, avatarSeed, lang, updatedAt}. Saving also writes the
// language to cp.lang.v1 so boot picks the same language next time (S11-F07). The nickname rule is the shared
// one (normalizeNickname, DV16 from config) so P-01, storage and the host G.HELLO check cannot disagree.
import { CheckyError, normalizeNickname } from '@checky/engine/util';
import { defaults } from '@/config';
import type { Backend } from './db';
import { isLang } from './consent';
import type { LangStore, LocalProfile, ProfileStore } from './types';

export function createProfileStore(backend: () => Promise<Backend>, lang: LangStore): ProfileStore {
  return {
    async get() {
      const row = await (await backend()).get('profile', 'me');
      if (row === undefined) return null;
      const { nickname, avatarSeed, lang: l, updatedAt } = row;
      if (typeof nickname !== 'string' || !Number.isInteger(avatarSeed) || !isLang(l) || typeof updatedAt !== 'string') return null;
      return { nickname, avatarSeed: avatarSeed as number, lang: l, updatedAt };
    },
    async save(p) {
      const nickname = typeof p.nickname === 'string' ? normalizeNickname(p.nickname, defaults.DV16) : null;
      if (nickname === null) throw new CheckyError('E-PROFILE-NICK-INVALID');
      if (!Number.isInteger(p.avatarSeed)) throw new TypeError('avatarSeed must be an integer');
      if (!isLang(p.lang)) throw new TypeError('unknown language');
      const profile: LocalProfile = { nickname, avatarSeed: p.avatarSeed, lang: p.lang, updatedAt: new Date().toISOString() };
      await (await backend()).put('profile', { key: 'me', ...profile });
      lang.set(p.lang);
    },
  };
}
