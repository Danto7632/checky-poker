// W2-R1 early signal (story 1-1 AC-1): both Trystero strategies must share ONE selfId, because the transport
// treats "the same peer reached over Nostr and MQTT" as one peer (ADR-0005). selfId is a module constant of
// @trystero-p2p/core (genId(20)) that nostr and mqtt re-export, so it is shared exactly when core is installed
// once. This runs under Vitest/Node resolution; the production-bundle check is 2-1 AC-16. Kept as a 2-1
// regression guard: if a Trystero upgrade duplicates core, this fails before the transport misbehaves.
import { describe, expect, it } from 'vitest';
import { selfId as mqttSelfId } from '@trystero-p2p/mqtt';
import { selfId as nostrSelfId } from '@trystero-p2p/nostr';

describe('Trystero selfId (W2-R1)', () => {
  it('nostr and mqtt expose the same 20-character selfId', () => {
    expect(typeof nostrSelfId).toBe('string');
    expect(nostrSelfId).toHaveLength(20);
    expect(mqttSelfId).toBe(nostrSelfId);
  });
});
