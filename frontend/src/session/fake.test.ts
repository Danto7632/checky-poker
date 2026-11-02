// AC-3 (I-04): the fake client's scenarios, method surface, reference stability and D7-clean fixtures.
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@checky/engine/protocol';
import { collectCardLeaks } from '../../../packages/engine/test/helpers/card-leak';
import { FAKE_SCENARIOS, createFakeClient } from './fake';

const REQUIRED = ['waiting', 'my-turn', 'showdown', 'bot-reveal', 'host-lost', 'closed'] as const;
const METHODS = [
  'getSnapshot', 'subscribe', 'act', 'sit', 'refill', 'leave', 'cancelWait', 'chat', 'inviteInfo', 'dispose',
  'start', 'pause', 'resume', 'close', 'lock', 'kick', 'setBlinds', 'setOption', 'addBot', 'updateBot', 'removeBot', 'invite',
] as const;

/** Cards this viewer may legitimately see: own hole cards, the dealt board, showdown and bot reveals. */
function visibleCards(v: PlayerView): Set<string> {
  const out = new Set<string>(v.me.holeCards ?? []);
  for (const c of v.hand?.board ?? []) out.add(c);
  for (const s of v.result?.showdown ?? []) for (const c of [...s.cards, ...s.best5]) out.add(c);
  for (const r of v.result?.botReveals ?? []) for (const c of r.holeCards) out.add(c);
  // Bots dealt into a finished hand show their cards to everyone (D16).
  if (v.hand && (v.hand.street === 'COMPLETE' || v.hand.street === 'SHOWDOWN')) {
    for (const s of v.seats) {
      if (s.occupant?.kind === 'bot') for (const c of s.occupant.inHand?.cards ?? []) out.add(c);
    }
  }
  return out;
}

describe('createFakeClient', () => {
  it.each([...FAKE_SCENARIOS, 'join-failed:E-NET-ICE-FAILED', 'join-failed:E-JOIN-FULL'])('%s: snapshot is stable and has alert', (scenario) => {
    const client = createFakeClient(scenario);
    const a = client.getSnapshot();
    expect(client.getSnapshot()).toBe(a);
    expect('alert' in a).toBe(true);
    for (const m of METHODS) expect(typeof client[m]).toBe('function');
  });

  it('covers the seven contract scenarios', () => {
    for (const s of REQUIRED) expect(FAKE_SCENARIOS).toContain(s);
    expect(createFakeClient('join-failed:E-NET-HOST-NOT-FOUND').getSnapshot().conn).toMatchObject({ stage: 'failed', error: 'E-NET-HOST-NOT-FOUND' });
  });

  // The two "busted" fixtures match what the real reducer produces after R0 M1 / R0-L3.
  it('refill / practice-busted: my stack 0, SITTING_OUT, canRefill; practice-busted is PAUSED with the result kept', () => {
    for (const sc of ['refill', 'practice-busted'] as const) {
      const v = createFakeClient(sc).getSnapshot().view!;
      expect(v.me).toMatchObject({ seat: 0, status: 'SITTING_OUT', canRefill: true });
      expect(v.seats[0]!.occupant).toMatchObject({ stack: 0, status: 'SITTING_OUT' });
      expect(v.result?.endStacks.find((e) => e.seat === 0)?.stack).toBe(0);
    }
    const busted = createFakeClient('practice-busted').getSnapshot().view!;
    expect(busted.room).toMatchObject({ kind: 'practice', phase: 'PAUSED', paused: true });
    expect(createFakeClient('refill').getSnapshot().view!.room.phase).toBe('BETWEEN_HANDS');
  });

  it('join-failed accepts only E-NET-* and E-JOIN-* codes', () => {
    expect(() => createFakeClient('join-failed:E-ACT-ILLEGAL')).toThrow();
    expect(() => createFakeClient('join-failed:E-NET-NOPE')).toThrow();
    expect(() => createFakeClient('nonsense')).toThrow();
  });

  it('records calls, resolves Ack methods with {ok:true} and never changes the snapshot', async () => {
    const client = createFakeClient('my-turn');
    const before = client.getSnapshot();
    await expect(client.act({ seat: 0, type: 'call' })).resolves.toEqual({ ok: true });
    await expect(client.chat('hi')).resolves.toEqual({ ok: true });
    await expect(client.start()).resolves.toEqual({ ok: true });
    await expect(client.addBot(null, { engine: 'rule', style: 'tight', provider: null, model: null, label: 'X' })).resolves.toEqual({ ok: true });
    expect(client.pause()).toBeUndefined();
    expect(client.resume()).toBeUndefined();
    expect(client.calls.map((c) => c.method)).toEqual(['act', 'chat', 'start', 'addBot', 'pause', 'resume']);
    expect(client.getSnapshot()).toBe(before);
  });

  it('waiting: friend room, 1 seated host, invite equal to inviteInfo()', () => {
    const c = createFakeClient('waiting');
    const s = c.getSnapshot();
    expect(s.view?.room).toMatchObject({ kind: 'friend', phase: 'WAITING' });
    expect(s.view?.hand).toBeNull();
    expect(s.view?.seats.filter((x) => x.occupant).length).toBe(1);
    expect(s.host?.invite.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    expect(s.host?.invite.display).toMatch(/^.{5}-.{5}$/);
    expect(c.inviteInfo()).toEqual(s.host?.invite);
  });

  it('my-turn: FLOP, 6 seats (me, 2 humans, 2 rule bots, 1 llm bot), call/raise/allIn, main + side pot, chat and notice', () => {
    const s = createFakeClient('my-turn').getSnapshot();
    const v = s.view!;
    expect(v.hand).toMatchObject({ street: 'FLOP', turnMs: 24000, toAct: v.me.seat });
    expect(v.hand?.pots).toHaveLength(2);
    expect(v.me.legal?.call).not.toBeNull();
    expect(v.me.legal?.raise).not.toBeNull();
    expect(v.me.legal?.allIn).toBeTruthy();
    const kinds = v.seats.map((x) => (x.occupant?.kind === 'bot' ? x.occupant.bot?.engine : x.occupant?.kind));
    expect(kinds.filter((k) => k === 'human')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'rule')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'llm')).toHaveLength(1);
    expect(s.chat.map((l) => l.kind).sort()).toEqual(['bot', 'human', 'system']);
    expect(s.notices.map((n) => n.code)).toEqual(['N-BLINDS-NEXT']);
  });

  it('exactly one XSS probe string sits in the chat/nickname fixtures', () => {
    const probe = '<img src=x onerror=alert(1)>';
    const all = FAKE_SCENARIOS.map((sc) => JSON.stringify(createFakeClient(sc).getSnapshot()));
    expect(all.some((t) => t.includes(probe))).toBe(true);
    expect(JSON.stringify(createFakeClient('my-turn').getSnapshot()).split(probe).length - 1).toBe(1);
  });

  it('showdown: BETWEEN_HANDS 5000, main + side, 1 returned, 2 at showdown, no reveals', () => {
    const v = createFakeClient('showdown').getSnapshot().view!;
    expect(v.room).toMatchObject({ phase: 'BETWEEN_HANDS', countdownMs: 5000 });
    expect(v.result?.pots.map((p) => p.kind)).toEqual(['main', 'side']);
    expect(v.result?.returned).toHaveLength(1);
    expect(v.result?.showdown).toHaveLength(2);
    expect(v.result?.botReveals).toEqual([]);
  });

  it('bot-reveal: 8000 countdown, 2 reveals incl. a preflop folder and a fallback, mc and exact metrics', () => {
    const s = createFakeClient('bot-reveal').getSnapshot();
    const r = s.view!.result!.botReveals;
    expect(s.view!.room.countdownMs).toBe(8000);
    expect(r).toHaveLength(2);
    expect(r.some((b) => b.decisions.length === 1 && b.decisions[0]!.street === 'PREFLOP' && b.decisions[0]!.action === 'fold')).toBe(true);
    const decisions = r.flatMap((b) => b.decisions);
    expect(decisions.some((d) => d.fallback && d.fallbackCode !== null)).toBe(true);
    expect(decisions.map((d) => d.metrics).filter((m) => m !== null)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'mc', samples: 1000, halfWidth95: 0.031, exact: false }),
        expect.objectContaining({ method: 'exact', samples: null, halfWidth95: null, exact: true }),
      ]),
    );
    expect(s.chat.filter((l) => l.kind === 'bot')).toHaveLength(1);
  });

  it('host-lost keeps the last IN_HAND view with a 30 s deadline; closed carries a RoomSummary', () => {
    const lost = createFakeClient('host-lost').getSnapshot();
    expect(lost.conn.stage).toBe('host_lost');
    expect(lost.view?.room.phase).toBe('IN_HAND');
    expect(lost.conn.hostLost!.deadlineMs - lost.conn.hostLost!.startedAtMs).toBe(30000);
    const closed = createFakeClient('closed').getSnapshot();
    expect(closed.conn.stage).toBe('closed');
    expect(closed.closed).toMatchObject({ reason: 'host_closed', voidedHandId: null });
  });

  it('practice scenarios: no-limit turnMs null, pausing only in a hand, paused keeps hand and result, alert', () => {
    const noLimit = createFakeClient('practice-no-limit');
    expect(noLimit.inviteInfo()).toBeNull();
    expect(noLimit.getSnapshot().view).toMatchObject({ room: { kind: 'practice', settings: { turnSeconds: null } }, hand: { turnMs: null } });
    expect(createFakeClient('practice-pausing').getSnapshot().view?.room).toMatchObject({ phase: 'IN_HAND', paused: true });
    const paused = createFakeClient('practice-paused').getSnapshot().view!;
    expect(paused.room.phase).toBe('PAUSED');
    expect(paused.hand?.street).toBe('COMPLETE');
    expect(paused.result).not.toBeNull();
    const alert = createFakeClient('alert').getSnapshot();
    expect(alert.alert?.code).toBe('E-ENG-INVARIANT');
    expect(alert.view?.room.phase).toBe('PAUSED');
    expect(createFakeClient('other-tab-host').getSnapshot().conn).toMatchObject({ hostTab: true, error: 'E-JOIN-OTHER-TAB' });
  });

  it.each(FAKE_SCENARIOS)('%s: fixtures hold no card the viewer may not see (D7)', (scenario) => {
    const s = createFakeClient(scenario).getSnapshot();
    if (s.view === null) return;
    const allowed = visibleCards(s.view);
    expect(collectCardLeaks(s, allowed)).toEqual([]);
    // Humans other than me never show cards before showdown, and folded humans never.
    for (const seat of s.view.seats) {
      const o = seat.occupant;
      if (o?.kind === 'human' && !o.isMe && o.inHand?.cards) {
        expect(o.inHand.folded).toBe(false);
        expect(s.view.result?.showdown.some((x) => x.seat === seat.seat)).toBe(true);
      }
    }
  });

  it('no currency symbols and no card-shaped names in any fixture', () => {
    for (const sc of FAKE_SCENARIOS) {
      const s = createFakeClient(sc).getSnapshot();
      expect(JSON.stringify(s)).not.toMatch(/[$€£¥₩]/);
      for (const seat of s.view?.seats ?? []) {
        if (seat.occupant) expect(seat.occupant.name).not.toMatch(/^[2-9TJQKA][shdc]$/);
      }
    }
  });
});

