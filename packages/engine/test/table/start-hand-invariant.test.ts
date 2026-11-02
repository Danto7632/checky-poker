// R0 m4: startHand runs under guardInvariant, so an E-ENG-INVARIANT thrown while DEALING (createHand closes the
// action through the same `finish` R11 check as every other transition) pauses the room with the alert instead of
// escaping reduceTable — which the shell would turn into W.FATAL E-WORKER-CRASH and end the room.
// A correct engine never throws there, so the failure is injected by mocking createHandWithEvents (own file:
// vi.mock applies to the whole module graph of this test file).
import { describe, expect, it, vi } from 'vitest';
import { CheckyError } from '../../src/util/checky-error';
import { practice } from '../helpers/table';

const fail = vi.hoisted(() => ({ next: 0 }));
vi.mock('../../src/hand/create', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/hand/create')>();
  return {
    ...real,
    createHandWithEvents: (...args: Parameters<typeof real.createHandWithEvents>) => {
      if (fail.next > 0) {
        fail.next -= 1;
        throw new CheckyError('E-ENG-INVARIANT');
      }
      return real.createHandWithEvents(...args);
    },
  };
});

describe('E-ENG-INVARIANT while dealing (every startHand caller)', () => {
  it('START: no throw; PAUSED + N-PAUSED + E-ENG-INVARIANT; RESUME deals once the engine works again', () => {
    const h = practice(2, { seatCount: 3 }, 'm4');
    fail.next = 1;
    expect(() => h.cmd({ t: 'START' })).not.toThrow();
    expect(h.table.phase).toBe('PAUSED');
    expect(h.table.hand).toBeNull();
    expect(h.errors()).toEqual(['E-ENG-INVARIANT']);
    expect(h.notices()).toEqual(['N-PAUSED']);
    h.cmd({ t: 'RESUME' });
    expect(h.table.phase).toBe('IN_HAND');
  });

  it('countdown end: the next deal fails -> PAUSED, the finished hand and its result stay', () => {
    const h = practice(2, { seatCount: 3 }, 'm4-countdown');
    h.cmd({ t: 'START' });
    h.playUntil((t) => t.phase === 'BETWEEN_HANDS');
    const last = h.table.hand!.handId;
    fail.next = 1;
    expect(() => h.advance(5000)).not.toThrow();
    expect(h.table.phase).toBe('PAUSED');
    expect(h.errors()).toEqual(['E-ENG-INVARIANT']);
    expect(h.table.hand).toMatchObject({ handId: last, street: 'COMPLETE' });
  });

  it('RESUME: the deal fails -> stays PAUSED with the alert, a later RESUME deals', () => {
    const h = practice(2, { seatCount: 3 }, 'm4-resume');
    h.cmd({ t: 'START' });
    h.playUntil((t) => t.phase === 'BETWEEN_HANDS');
    h.cmd({ t: 'PAUSE' });
    fail.next = 1;
    expect(() => h.cmd({ t: 'RESUME' })).not.toThrow();
    expect(h.table.phase).toBe('PAUSED');
    expect(h.errors()).toEqual(['E-ENG-INVARIANT']);
    expect(h.notices()).toEqual(['N-PAUSED']); // no N-RESUMED for a resume that did not happen
    h.cmd({ t: 'RESUME' });
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.notices()).toEqual(['N-RESUMED']);
  });
});
