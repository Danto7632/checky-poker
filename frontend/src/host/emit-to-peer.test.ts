// AC-10 participant exit (D29, T-001, T2-007, T2-012): emitToPeer called directly on a friend-room TableState
// built by a test helper (3 humans + 2 bots; the friend reducer is 2-1).
import { describe, expect, it, vi } from 'vitest';
import { projectView, type PlayerView } from '@checky/engine/projection';
import { decodeEnvelope, envelope, validateEnvelope, type WorkerOutbound } from '@checky/engine/protocol';
import { createTable, type TableState, type Viewer } from '@checky/engine/table';
import { act, newHand, rig } from '../../../packages/engine/test/helpers/hand';
import { HOST, ruleBot, tableConfig } from '../../../packages/engine/test/helpers/table';
import { collectCardLeaks } from '../../../packages/engine/test/helpers/card-leak';
import { createPeerExit, type Post } from './shell';

function friendTable(): TableState {
  const base = createTable(tableConfig('friend', { seatCount: 5 }), HOST);
  const human = (seat: number, nick: string) => ({
    seat, kind: 'human' as const, rpk: `rpk-${seat}`.padEnd(22, '0'), nick, avatarSeed: seat, isHost: false, status: 'ACTIVE' as const,
    stack: 10000, strikes: 0, sitOutReason: null, connected: true, bot: null,
  });
  const bot = (seat: number, label: string) => ({ ...human(seat, label), kind: 'bot' as const, rpk: null, bot: ruleBot(label) });
  let hand = rig(newHand({ 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 10000 }, 0), { 0: ['As', 'Ad'], 1: ['Ks', 'Kd'], 2: ['Qs', 'Qd'], 3: ['Js', 'Jd'], 4: ['Ts', 'Td'] }, ['2c', '7h', '8c', '3d', '4h']);
  hand = act(hand, 3, 'call');
  hand = act(hand, 4, 'call');
  hand = act(hand, 0, 'call');
  hand = act(hand, 1, 'call');
  hand = act(hand, 2, 'check');
  return { ...base, phase: 'IN_HAND', seats: [base.seats[0]!, human(1, 'Kenji'), human(2, 'Sora'), bot(3, 'Ada'), bot(4, 'Rex')], hand, handNo: 1 };
}

const VIEWERS: Record<string, Viewer> = { c1: { kind: 'seat', seat: 1 }, c2: { kind: 'seat', seat: 2 } };

function setup(project = projectView, table = friendTable()) {
  const posted: { msg: WorkerOutbound; transfer: Transferable[] }[] = [];
  const errors: string[] = [];
  const post: Post = (msg, transfer = []) => posted.push({ msg, transfer });
  const exit = createPeerExit({ post, project, table: () => table, viewerOf: (c) => VIEWERS[c] ?? null, onError: (code) => errors.push(code) });
  return { exit, posted, errors, table };
}

describe('emitToPeer', () => {
  it('① posts {t:"W.OUT", to:[conn], bytes} — an ArrayBuffer, no env key, transfer list = [bytes]; ⑦ to has length 1', () => {
    const { exit, posted } = setup();
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    expect(posted).toHaveLength(1);
    const { msg, transfer } = posted[0]!;
    expect(Object.keys(msg).sort()).toEqual(['bytes', 't', 'to']);
    if (msg.t !== 'W.OUT' || msg.to === 'local') throw new Error('expected a peer W.OUT');
    expect(msg.to).toEqual(['c1']);
    expect('env' in msg).toBe(false);
    expect(msg.bytes).toBeInstanceOf(ArrayBuffer);
    expect(transfer).toEqual([msg.bytes]);
    expect(transfer[0]).toBe(msg.bytes);
  });

  it('② the decoded H.VIEW equals projectView for that connection; ⑤ the first byte is 0x7B; no other seat\'s cards', () => {
    const { exit, posted, table } = setup();
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    exit.emitToPeer('c2', { t: 'H.VIEW' });
    for (const [i, conn] of ['c1', 'c2'].entries()) {
      const msg = posted[i]!.msg as { bytes: ArrayBuffer };
      const u8 = new Uint8Array(msg.bytes);
      expect(u8[0]).toBe(0x7b);
      const env = validateEnvelope(decodeEnvelope(u8), 'to_guest');
      if (env.t !== 'H.VIEW') throw new Error('expected H.VIEW');
      expect(env.s).toBe(1);
      expect(env.b.view).toEqual(projectView(table, VIEWERS[conn]!));
      const own = env.b.view.me.holeCards!;
      expect(collectCardLeaks(env.b.view, new Set([...own, ...env.b.view.hand!.board]))).toEqual([]);
    }
  });

  it('③ after the transfer the Worker-side buffer is detached (byteLength 0) — the same buffer is never reused', () => {
    const { exit, posted } = setup();
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    const { msg, transfer } = posted[0]!;
    const bytes = (msg as { bytes: ArrayBuffer }).bytes;
    const length = bytes.byteLength;
    const received = structuredClone(msg, { transfer }) as { bytes: ArrayBuffer };
    expect(bytes.byteLength).toBe(0);
    expect(received.bytes.byteLength).toBe(length);
  });

  it('④ a view that verifyView blocks is not sent: W.OUT 0 for that conn + E-PROJ-LEAK-BLOCKED', () => {
    const leaky = (t: TableState, v: Viewer): PlayerView => {
      const view = projectView(t, v);
      return { ...view, seats: view.seats.map((s) => (s.seat === 0 && s.occupant?.inHand ? { ...s, occupant: { ...s.occupant, inHand: { ...s.occupant.inHand, cards: ['As', 'Ad'] } } } : s)) } as PlayerView;
    };
    const { exit, posted, errors } = setup(leaky);
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    expect(posted).toHaveLength(0);
    expect(errors).toEqual(['E-PROJ-LEAK-BLOCKED']);
    expect(exit.lastViewSeq('c1')).toBe(0);
  });

  it('T2-012: an envelope over 65,536 bytes is not sent, reports E-PROTO-TOO-LARGE and does not advance s / H.HB.vs', () => {
    const huge = (t: TableState, v: Viewer): PlayerView => {
      const view = projectView(t, v);
      return { ...view, seats: view.seats.map((s) => (s.occupant ? { ...s, occupant: { ...s.occupant, name: 'x'.repeat(14000) } } : s)) } as PlayerView;
    };
    const { exit, posted, errors } = setup(huge);
    exit.emitToPeer('c1', envelope('H.ACK', 0, { c: 1 }));
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    expect(errors).toEqual(['E-PROTO-TOO-LARGE']);
    expect(posted).toHaveLength(1);
    expect(exit.lastViewSeq('c1')).toBe(0);
    exit.emitToPeer('c1', envelope('H.ACK', 0, { c: 2 }));
    const env = decodeEnvelope(new Uint8Array((posted[1]!.msg as { bytes: ArrayBuffer }).bytes)) as { s: number };
    expect(env.s).toBe(2); // the dropped view did not consume a sequence number
  });

  it('sequence numbers are per connection; lastViewSeq follows the last H.VIEW; non-view envelopes are bytes too', () => {
    const { exit, posted } = setup();
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    exit.emitToPeer('c1', envelope('H.NOTICE', 0, { code: 'N-PAUSED', p: {} }));
    exit.emitToPeer('c2', { t: 'H.VIEW' });
    exit.emitToPeer('c1', { t: 'H.VIEW' });
    const s = posted.map((p) => (decodeEnvelope(new Uint8Array((p.msg as { bytes: ArrayBuffer }).bytes)) as { s: number }).s);
    expect(s).toEqual([1, 2, 1, 3]);
    expect(exit.lastViewSeq('c1')).toBe(3);
    expect(exit.lastViewSeq('c2')).toBe(1);
    for (const p of posted) expect('env' in p.msg).toBe(false);
  });

  it('an unknown connection gets nothing', () => {
    const { exit, posted } = setup();
    const spy = vi.fn();
    exit.emitToPeer('nobody', { t: 'H.VIEW' });
    expect(posted).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
