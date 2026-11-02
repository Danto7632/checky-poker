// device store (A-STO-DEVICE, ADR-0016): one 32-byte secret per browser, created once, never exported, and the
// per-room player key rpk = base64url(SHA-256('checky/rpk/v1' || secret || roomCode)) cut to 22 characters.
// A room only ever sees its rpk, so two rooms cannot link the same player. This file is one of the four allowed
// to call crypto.getRandomValues directly (code-structure section 5).
import { base64urlEncode, utf8Encode } from '@checky/engine/util';
import type { Backend } from './db';
import type { DeviceStore } from './types';

const RPK_DOMAIN = utf8Encode('checky/rpk/v1');

function newSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function createDeviceStore(backend: () => Promise<Backend>): DeviceStore {
  // One in-flight read per store so concurrent first calls share the same secret.
  let pending: Promise<Uint8Array> | null = null;
  const getSecret = (): Promise<Uint8Array> => {
    pending ??= (async () => {
      const row = await (await backend()).getOrCreate('device', 'secret', () => ({ key: 'secret', secret: newSecret() }));
      const secret = row.secret;
      if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new TypeError('stored device secret is invalid');
      return secret;
    })();
    pending.catch(() => {
      pending = null;
    });
    return pending;
  };
  return {
    getSecret: async () => new Uint8Array(await getSecret()),
    async roomPlayerKey(code) {
      const secret = await getSecret();
      const room = utf8Encode(code);
      const input = new Uint8Array(RPK_DOMAIN.length + secret.length + room.length);
      input.set(RPK_DOMAIN, 0);
      input.set(secret, RPK_DOMAIN.length);
      input.set(room, RPK_DOMAIN.length + secret.length);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
      return base64urlEncode(digest).slice(0, 22);
    },
    async regenerate() {
      const secret = newSecret();
      await (await backend()).put('device', { key: 'secret', secret });
      pending = Promise.resolve(secret);
    },
  };
}
