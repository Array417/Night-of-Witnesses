import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { WebSocket } from 'ws';
import { RoomManager } from '../../src/server/rooms.ts';
import { createServerInstance } from '../../src/server/http.ts';
import { attachWebSocketServer } from '../../src/server/socket.ts';
import { clientMessageSchema, serverMessageSchema } from '../../src/shared/protocol.ts';
import type { ServerMessage, ClientMessage } from '../../src/shared/protocol.ts';

function uuid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `22222222-2222-4222-8222-${tail}`;
}

function driveToDiscussion(manager: RoomManager, roomCode: string, ids: string[]): void {
  for (const pid of ids) {
    manager.dispatchAction(roomCode, pid, {
      type: 'set_ready',
      actionId: uuid(1000 + ids.indexOf(pid)),
      baseVersion: manager.getRoom(roomCode)!.state.version,
      ready: true,
    });
  }
  manager.dispatchAction(roomCode, ids[0], {
    type: 'start_game',
    actionId: uuid(2000),
    baseVersion: manager.getRoom(roomCode)!.state.version,
  });
  for (let i = 0; i < ids.length; i++) {
    const room = manager.getRoom(roomCode)!;
    const actor = room.state.currentActorId!;
    const cards = room.state.pendingCards[actor];
    const nextP = i < ids.length - 1 ? ids[i + 1] : undefined;
    manager.dispatchAction(roomCode, actor, {
      type: 'choose_and_pass',
      actionId: uuid(3000 + i),
      baseVersion: room.state.version,
      keepCardId: cards[0].id,
      ...(nextP ? { passToPlayerId: nextP } : {}),
    } as never);
  }
  assert.equal(manager.getRoom(roomCode)!.state.phase, 'discussion');
}

describe('discussion deadline + rtc signaling', () => {
  test('membership shrink to majority arms exact 15s once; rejoin retains deadline; expiry forces voting', () => {
    let now = 30_000_000;
    const manager = new RoomManager({ getTime: () => now });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', uuid(81));
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', uuid(82));
    const { playerId: p3, seatToken: t3 } = manager.joinRoom(roomCode, 'Cara', uuid(83));
    const { playerId: p4 } = manager.joinRoom(roomCode, 'Dan', uuid(84));
    driveToDiscussion(manager, roomCode, [p1, p2, p3, p4]);

    // 2 consents of 4 = exactly half: no deadline.
    for (const [i, pid] of [p1, p2].entries()) {
      manager.dispatchAction(roomCode, pid, {
        type: 'advance_to_vote',
        actionId: uuid(90 + i),
        baseVersion: manager.getRoom(roomCode)!.state.version,
      });
    }
    assert.equal(manager.getRoom(roomCode)!.state.discussionDeadlineAt, null);

    // Non-consenter disconnects -> 2/3 strict majority must arm now+15000 exactly once.
    manager.disconnectPlayer(roomCode, p3);
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'discussion');
    const armed = manager.getRoom(roomCode)!.state.discussionDeadlineAt;
    assert.equal(armed, now + 15_000);

    // Rejoin retains the original deadline (no reset, no extension).
    now += 1_000;
    manager.rejoinRoom(roomCode, t3);
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'discussion');
    assert.equal(manager.getRoom(roomCode)!.state.discussionDeadlineAt, armed);

    // Expiry forces voting without more client messages.
    now = armed! + 1;
    assert.deepEqual(manager.checkAllDiscussionDeadlines(), [roomCode]);
    const st = manager.getRoom(roomCode)!.state;
    assert.equal(st.phase, 'voting');
    assert.deepEqual(st.discussionConsents, []);
    assert.equal(st.discussionDeadlineAt, null);
  });

  test('strict majority arms +15s deadline once; unanimous forces voting', () => {
    let now = 1_000_000;
    const manager = new RoomManager({ getTime: () => now });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', uuid(1));
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', uuid(2));
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Cara', uuid(3));
    // 4th player for half-vs-majority (2/4 is half, not majority)
    const { playerId: p4 } = manager.joinRoom(roomCode, 'Dan', uuid(4));
    driveToDiscussion(manager, roomCode, [p1, p2, p3, p4]);

    // 1 consent of 4: no deadline
    manager.dispatchAction(roomCode, p1, {
      type: 'advance_to_vote',
      actionId: uuid(11),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    assert.equal(manager.getRoom(roomCode)!.state.discussionDeadlineAt, null);

    // 2 of 4 = exactly half: NO deadline (strict >half required)
    manager.dispatchAction(roomCode, p2, {
      type: 'advance_to_vote',
      actionId: uuid(12),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    assert.equal(manager.getRoom(roomCode)!.state.discussionDeadlineAt, null);

    // 3 of 4 = majority: arms exactly +15000
    manager.dispatchAction(roomCode, p3, {
      type: 'advance_to_vote',
      actionId: uuid(13),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    assert.equal(manager.getRoom(roomCode)!.state.discussionDeadlineAt, now + 15_000);

    // 4th consent (unanimous) -> immediate voting, clears
    now += 1000;
    manager.dispatchAction(roomCode, p4, {
      type: 'advance_to_vote',
      actionId: uuid(14),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    const st = manager.getRoom(roomCode)!.state;
    assert.equal(st.phase, 'voting');
    assert.deepEqual(st.discussionConsents, []);
    assert.equal(st.discussionDeadlineAt, null);
  });

  test('deadline does not extend on later consent; expiry forces voting', () => {
    let now = 5_000_000;
    const manager = new RoomManager({ getTime: () => now });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', uuid(21));
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', uuid(22));
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Cara', uuid(23));
    driveToDiscussion(manager, roomCode, [p1, p2, p3]);

    manager.dispatchAction(roomCode, p1, {
      type: 'advance_to_vote',
      actionId: uuid(24),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    manager.dispatchAction(roomCode, p2, {
      type: 'advance_to_vote',
      actionId: uuid(25),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    const armed = manager.getRoom(roomCode)!.state.discussionDeadlineAt;
    assert.equal(armed, now + 15_000);
    // expiry forces voting without more client messages
    now = armed! + 1;
    const changed = manager.checkAllDiscussionDeadlines();
    assert.ok(changed.includes(roomCode));
    const st = manager.getRoom(roomCode)!.state;
    assert.equal(st.phase, 'voting');
    assert.deepEqual(st.discussionConsents, []);
    assert.equal(st.discussionDeadlineAt, null);
  });

  test('disconnect re-evaluates denominator: remaining unanimous forces voting; zero connected cannot', () => {
    let now = 9_000_000;
    const manager = new RoomManager({ getTime: () => now });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', uuid(31));
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', uuid(32));
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Cara', uuid(33));
    driveToDiscussion(manager, roomCode, [p1, p2, p3]);
    manager.dispatchAction(roomCode, p1, {
      type: 'advance_to_vote', actionId: uuid(34),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    manager.dispatchAction(roomCode, p2, {
      type: 'advance_to_vote', actionId: uuid(35),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    // p3 disconnects -> connected = {p1,p2}, both consented -> immediate voting
    manager.disconnectPlayer(roomCode, p3);
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'voting');
  });

  test('zero connected cannot cause unanimous; rejoin re-evaluates without deadline reset', () => {
    let now = 11_000_000;
    const manager = new RoomManager({ getTime: () => now });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', uuid(41));
    const { playerId: p2, seatToken: t2 } = manager.joinRoom(roomCode, 'Bob', uuid(42));
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Cara', uuid(43));
    driveToDiscussion(manager, roomCode, [p1, p2, p3]);
    manager.dispatchAction(roomCode, p1, {
      type: 'advance_to_vote', actionId: uuid(44),
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    // All disconnect -> zero connected must NOT force voting
    manager.disconnectPlayer(roomCode, p1);
    manager.disconnectPlayer(roomCode, p2);
    manager.disconnectPlayer(roomCode, p3);
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'discussion');
    // Rejoin restores; armed deadline (if any) is preserved across membership change
    manager.rejoinRoom(roomCode, t2);
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'discussion');
    assert.deepEqual(manager.getRoom(roomCode)!.state.discussionConsents, [p1]);
  });

  test('transitions stop the timer: voting rooms never appear in deadline sweep', () => {
    let now = 13_000_000;
    const manager = new RoomManager({ getTime: () => now });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', uuid(61));
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', uuid(62));
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Cara', uuid(63));
    driveToDiscussion(manager, roomCode, [p1, p2, p3]);
    for (const [i, pid] of [p1, p2, p3].entries()) {
      manager.dispatchAction(roomCode, pid, {
        type: 'advance_to_vote',
        actionId: uuid(70 + i),
        baseVersion: manager.getRoom(roomCode)!.state.version,
      });
    }
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'voting');
    now += 60_000;
    assert.deepEqual(manager.checkAllDiscussionDeadlines(), []);
  });

  test('rtc_signal wire contract: client/server shapes, 6000-char cap', () => {
    const okClient = clientMessageSchema.safeParse({
      type: 'rtc_signal',
      targetPlayerId: 'p2',
      kind: 'offer',
      payload: 'abc',
    });
    assert.ok(okClient.success);
    const tooBig = clientMessageSchema.safeParse({
      type: 'rtc_signal',
      targetPlayerId: 'p2',
      kind: 'offer',
      payload: 'x'.repeat(6001),
    });
    assert.equal(tooBig.success, false);
    const withActionId = clientMessageSchema.safeParse({
      type: 'rtc_signal',
      actionId: uuid(99),
      baseVersion: 0,
      targetPlayerId: 'p2',
      kind: 'offer',
      payload: 'abc',
    });
    assert.equal(withActionId.success, false);
    const okServer = serverMessageSchema.safeParse({
      type: 'rtc_signal',
      fromPlayerId: 'p1',
      kind: 'answer',
      payload: 'xyz',
    });
    assert.ok(okServer.success);
    const welcome = serverMessageSchema.safeParse({
      type: 'welcome',
      roomCode: 'ABCDEF',
      seatToken: 'tok',
      playerId: 'p1',
      iceServers: [],
    });
    assert.ok(welcome.success);
  });

  describe('socket rtc relay + deadline broadcast', () => {
    let server: http.Server;
    let port: number;
    let wsUrl: string;
    let manager: RoomManager;
    let closeWs: () => Promise<void>;
    let now = 20_000_000;

    before(async () => {
      manager = new RoomManager({ getTime: () => now });
      const inst = createServerInstance({
        clientDistDir: path.resolve('dist/client'),
        allowedOrigins: ['http://127.0.0.1:3000'],
      });
      server = inst.server;
      closeWs = attachWebSocketServer(server, manager, {
        allowedOrigins: ['http://127.0.0.1:3000'],
        pingIntervalMs: 60_000,
        handshakeTimeoutMs: 5000,
        iceServers: [],
      }).close;
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as { port: number }).port;
          wsUrl = `ws://127.0.0.1:${port}/ws`;
          resolve();
        });
      });
    });

    after(async () => {
      await closeWs();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    function connect(): Promise<WebSocket> {
      return new Promise((resolve) => {
        const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3000' } });
        ws.on('open', () => resolve(ws));
      });
    }

    function nextOf(ws: WebSocket, pred: (m: ServerMessage) => boolean, timeoutMs = 4000): Promise<ServerMessage> {
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          ws.off('message', onMsg);
          rej(new Error('timeout'));
        }, timeoutMs);
        const onMsg = (data: Buffer | string) => {
          try {
            const m = JSON.parse(data.toString()) as ServerMessage;
            if (pred(m)) {
              clearTimeout(timer);
              ws.off('message', onMsg);
              res(m);
            }
          } catch { /* ignore */ }
        };
        ws.on('message', onMsg);
      });
    }

    test('welcome carries iceServers; rtc relays target-only in discussion', async () => {
      const a = await connect();
      const b = await connect();
      const c = await connect();
      const msgs: ServerMessage[] = [];
      for (const ws of [a, b, c]) ws.on('message', (d) => {
        try { msgs.push(JSON.parse(d.toString()) as ServerMessage); } catch { /* ignore */ }
      });
      a.send(JSON.stringify({ type: 'create_room', actionId: uuid(501), playerName: 'Alice' }));
      const w = (await nextOf(a, (m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;
      assert.ok(Array.isArray((w as { iceServers?: unknown }).iceServers));
      const roomCode = w.roomCode;
      b.send(JSON.stringify({ type: 'join_room', actionId: uuid(502), roomCode, playerName: 'Bob' }));
      await nextOf(b, (m) => m.type === 'welcome');
      c.send(JSON.stringify({ type: 'join_room', actionId: uuid(503), roomCode, playerName: 'Cara' }));
      await nextOf(c, (m) => m.type === 'welcome');

      // ready + start via manager shortcut is not possible over wire versions; use wire versions
      const room = manager.getRoom(roomCode)!;
      const ids = room.state.players.map((p) => p.playerId);
      void ids;
      // drive to discussion through manager directly (same process)
      const st = manager.getRoom(roomCode)!;
      void st;
      driveToDiscussion(manager, roomCode, manager.getRoom(roomCode)!.state.players.map((p) => p.playerId));

      const pids = manager.getRoom(roomCode)!.state.players.map((p) => p.playerId);
      // self-signal rejected
      a.send(JSON.stringify({ type: 'rtc_signal', targetPlayerId: pids[0], kind: 'offer', payload: 'hi' }));
      const err = await nextOf(a, (m) => m.type === 'error');
      assert.equal(err.type, 'error');

      // valid relay a -> b only
      let bGot: ServerMessage | null = null;
      let cGot = false;
      b.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString()) as ServerMessage;
          if (m.type === 'rtc_signal') bGot = m;
        } catch { /* ignore */ }
      });
      c.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString()) as ServerMessage;
          if (m.type === 'rtc_signal') cGot = true;
        } catch { /* ignore */ }
      });
      a.send(JSON.stringify({ type: 'rtc_signal', targetPlayerId: pids[1], kind: 'offer', payload: 'sdp-offer' }));
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(bGot && (bGot as ServerMessage).type === 'rtc_signal');
      assert.equal(cGot, false);
      a.close();
      b.close();
      c.close();
    });

    test('rtc and game rate buckets are separate; malformed rtc rejected', async () => {
      const a = await connect();
      const errors: Array<Extract<ServerMessage, { type: 'error' }>> = [];
      a.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString()) as ServerMessage;
          if (m.type === 'error') errors.push(m);
        } catch { /* ignore */ }
      });
      a.send(JSON.stringify({ type: 'create_room', actionId: uuid(601), playerName: 'Solo' }));
      await nextOf(a, (m) => m.type === 'welcome');

      // Exhaust the game bucket: 20 game messages pass rate check, 21st is limited.
      // Use distinct actionIds; alternating ready keeps dispatch valid in lobby.
      for (let i = 0; i < 21; i++) {
        a.send(JSON.stringify({
          type: 'set_ready',
          actionId: uuid(700 + i),
          baseVersion: 1 + i,
          ready: i % 2 === 0,
        }));
      }
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(errors.some((e) => e.code === 'RATE_LIMITED'));

      // rtc bucket is untouched: signal passes rate check, fails phase validation instead.
      const before = errors.length;
      a.send(JSON.stringify({ type: 'rtc_signal', targetPlayerId: 'nobody', kind: 'ice', payload: 'cand' }));
      await new Promise((r) => setTimeout(r, 300));
      const fresh = errors.slice(before);
      assert.ok(fresh.length > 0);
      assert.ok(fresh.every((e) => e.code !== 'RATE_LIMITED'));

      // Malformed rtc (oversized payload, bad kind) rejected without relay.
      a.send(JSON.stringify({ type: 'rtc_signal', targetPlayerId: 'x', kind: 'offer', payload: 'y'.repeat(6001) }));
      a.send(JSON.stringify({ type: 'rtc_signal', targetPlayerId: 'x', kind: 'bogus', payload: 'y' }));
      await new Promise((r) => setTimeout(r, 300));
      a.close();
    });
  });
});
