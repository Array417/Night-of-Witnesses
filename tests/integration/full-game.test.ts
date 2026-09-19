import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { createServerInstance } from '../../src/server/http.ts';
import { attachWebSocketServer } from '../../src/server/socket.ts';
import { RoomManager } from '../../src/server/rooms.ts';
import type { ServerMessage, ClientMessage } from '../../src/shared/protocol.ts';
import type { PlayerProjection } from '../../src/shared/state.ts';

describe('authoritative wire journeys and recovery contracts', () => {
  let server: http.Server;
  let port: number;
  let wsUrl: string;
  let manager: RoomManager;
  let closeWs: () => Promise<void>;
  let simulatedTime = 1_000_000;
  const capturedFrames: { seat: string; frame: ServerMessage }[] = [];

  before(async () => {
    manager = new RoomManager({
      getTime: () => simulatedTime,
      getSeed: (roomCode, type) => `deterministic-test-seed-${roomCode}-${type}`,
    });

    const serverInstance = createServerInstance({
      clientDistDir: path.resolve('dist/client'),
      allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
    });
    server = serverInstance.server;

    const wsHandler = attachWebSocketServer(server, manager, {
      allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
      pingIntervalMs: 500,
      handshakeTimeoutMs: 5000,
    });
    closeWs = wsHandler.close;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        port = addr.port;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    await closeWs();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const lines = capturedFrames.map((f) => JSON.stringify(f)).join('\n') + '\n';
    fs.writeFileSync(path.join(evidenceDir, 'task-12-frames.jsonl'), lines, 'utf8');
  });

  interface TestClient {
    ws: WebSocket;
    name: string;
    seatToken?: string;
    playerId?: string;
    lastProjection?: PlayerProjection;
    messages: ServerMessage[];
    send: (msg: ClientMessage) => void;
    waitFor: (predicate: (msg: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
    close: () => void;
  }

  function createTestClient(name: string): Promise<TestClient> {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3000' } });
      const messages: ServerMessage[] = [];
      let cursor = 0;

      const client: TestClient = {
        ws,
        name,
        messages,
        send: (msg) => ws.send(JSON.stringify(msg)),
        waitFor: (predicate, timeoutMs = 4000) => {
          for (let i = cursor; i < messages.length; i++) {
            if (predicate(messages[i])) {
              cursor = i + 1;
              return Promise.resolve(messages[i]);
            }
          }

          return new Promise<ServerMessage>((res, rej) => {
            const timer = setTimeout(() => {
              ws.off('message', onMsg);
              const unread = messages.slice(cursor).map((m) => m.type);
              rej(new Error(`Timeout waiting for message matching predicate for ${name}. Unread messages: ${JSON.stringify(unread)}`));
            }, timeoutMs);

            const onMsg = (data: Buffer | string) => {
              try {
                const parsed = JSON.parse(data.toString()) as ServerMessage;
                if (predicate(parsed)) {
                  clearTimeout(timer);
                  ws.off('message', onMsg);
                  cursor = messages.length;
                  res(parsed);
                }
              } catch {
                // ignore
              }
            };
            ws.on('message', onMsg);
          });
        },
        close: () => ws.close(),
      };

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as ServerMessage;
          messages.push(parsed);
          capturedFrames.push({ seat: name, frame: parsed });
          if (parsed.type === 'welcome') {
            client.seatToken = parsed.seatToken;
            client.playerId = parsed.playerId;
          } else if (parsed.type === 'projection') {
            client.lastProjection = parsed.projection;
          }
        } catch {
          // ignore
        }
      });

      ws.on('open', () => resolve(client));
    });
  }

  test('three-client L1 complete round: create, draft, vote, result, canary check, and rematch', async () => {
    const c1 = await createTestClient('Alice');
    const c2 = await createTestClient('Bob');
    const c3 = await createTestClient('Charlie');

    // 1. Alice creates room
    c1.send({
      type: 'create_room',
      actionId: '10000000-0000-4000-8000-000000000001',
      playerName: 'Alice',
    });

    const welcome1 = (await c1.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;
    const roomCode = welcome1.roomCode;
    assert.ok(roomCode);
    assert.equal(roomCode.length, 6);
    await c1.waitFor((m) => m.type === 'projection');

    // 2. Bob joins
    c2.send({
      type: 'join_room',
      actionId: '10000000-0000-4000-8000-000000000002',
      roomCode,
      playerName: 'Bob',
    });
    await c2.waitFor((m) => m.type === 'welcome');
    await c2.waitFor((m) => m.type === 'projection');

    // 3. Charlie joins
    c3.send({
      type: 'join_room',
      actionId: '10000000-0000-4000-8000-000000000003',
      roomCode,
      playerName: 'Charlie',
    });
    await c3.waitFor((m) => m.type === 'welcome');

    // Wait for all three to see 3 players in lobby
    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.players.length === 3),
      c2.waitFor((m) => m.type === 'projection' && m.projection.players.length === 3),
      c3.waitFor((m) => m.type === 'projection' && m.projection.players.length === 3),
    ]);

    // 4. Ready up sequentially, waiting for projection sync
    c1.send({
      type: 'set_ready',
      actionId: '10000000-0000-4000-8000-000000000004',
      baseVersion: c1.lastProjection!.version,
      ready: true,
    });
    await c2.waitFor((m) => m.type === 'projection' && m.projection.players[0].ready);

    c2.send({
      type: 'set_ready',
      actionId: '10000000-0000-4000-8000-000000000005',
      baseVersion: c2.lastProjection!.version,
      ready: true,
    });
    await c3.waitFor((m) => m.type === 'projection' && m.projection.players[1].ready);

    c3.send({
      type: 'set_ready',
      actionId: '10000000-0000-4000-8000-000000000006',
      baseVersion: c3.lastProjection!.version,
      ready: true,
    });
    await c1.waitFor((m) => m.type === 'projection' && m.projection.players.every((p) => p.ready));

    // 5. Host starts game
    c1.send({
      type: 'start_game',
      actionId: '10000000-0000-4000-8000-000000000007',
      baseVersion: c1.lastProjection!.version,
    });

    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
    ]);

    // CANARY CHECK 1: Only active actor (Alice) gets ownCards. Bob and Charlie must have undefined ownCards.
    assert.ok(c1.lastProjection!.ownCards);
    assert.equal(c1.lastProjection!.ownCards!.length, 2);
    assert.equal(c2.lastProjection?.ownCards === undefined, true);
    assert.equal(c3.lastProjection?.ownCards === undefined, true);

    const aliceCards = c1.lastProjection!.ownCards!;
    const aliceKeeps = aliceCards[0];
    const alicePasses = aliceCards[1];

    // Alice passes to Bob
    c1.send({
      type: 'choose_and_pass',
      actionId: '10000000-0000-4000-8000-000000000008',
      baseVersion: c1.lastProjection!.version,
      keepCardId: aliceKeeps.id,
      passToPlayerId: c2.playerId!,
      testimonyRole: 'guest',
    });

    await c2.waitFor((m) => m.type === 'projection' && m.projection.currentActorId === c2.playerId);

    // Bob has 2 cards
    const bobCards = c2.lastProjection?.ownCards;
    assert.ok(bobCards);
    assert.equal(bobCards.length, 2);
    assert.ok(bobCards.some((c) => c.id === alicePasses.id));
    assert.equal(c2.lastProjection?.ownRole === undefined, true);
    assert.equal(c3.lastProjection?.ownRole === undefined, true);

    const bobKeeps = bobCards[0];

    // Bob passes to Charlie
    c2.send({
      type: 'choose_and_pass',
      actionId: '10000000-0000-4000-8000-000000000009',
      baseVersion: c2.lastProjection!.version,
      keepCardId: bobKeeps.id,
      passToPlayerId: c3.playerId!,
    });

    await c3.waitFor((m) => m.type === 'projection' && m.projection.currentActorId === c3.playerId);

    // Charlie is final player
    const charlieCards = c3.lastProjection?.ownCards;
    assert.ok(charlieCards);
    assert.equal(charlieCards.length, 2);
    const charlieKeeps = charlieCards[0];

    // Charlie chooses and finishes draft
    c3.send({
      type: 'choose_and_pass',
      actionId: '10000000-0000-4000-8000-000000000010',
      baseVersion: c3.lastProjection!.version,
      keepCardId: charlieKeeps.id,
    });

    // All transition to discussion phase
    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
    ]);

    // Alice advances to voting
    c1.send({
      type: 'advance_to_vote',
      actionId: '10000000-0000-4000-8000-000000000011',
      baseVersion: c1.lastProjection!.version,
    });

    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'voting'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'voting'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'voting'),
    ]);

    // All cast votes towards Bob's location
    const bobLoc = c1.lastProjection!.players.find((p) => p.playerId === c2.playerId)!.locationId!;
    assert.ok(bobLoc);

    c1.send({
      type: 'cast_vote',
      actionId: '10000000-0000-4000-8000-000000000012',
      baseVersion: c1.lastProjection!.version,
      targetLocation: bobLoc,
    });
    await c2.waitFor((m) => m.type === 'projection' && Boolean(m.projection.players[0].hasVoted));

    c2.send({
      type: 'cast_vote',
      actionId: '10000000-0000-4000-8000-000000000013',
      baseVersion: c2.lastProjection!.version,
      targetLocation: bobLoc,
    });
    await c3.waitFor((m) => m.type === 'projection' && Boolean(m.projection.players[1].hasVoted));

    c3.send({
      type: 'cast_vote',
      actionId: '10000000-0000-4000-8000-000000000014',
      baseVersion: c3.lastProjection!.version,
      targetLocation: bobLoc,
    });

    // All transition to resolution
    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'resolution'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'resolution'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'resolution'),
    ]);

    // Check that all 3 viewers have matching public results
    const r1 = c1.lastProjection!.result!;
    const r2 = c2.lastProjection!.result!;
    const r3 = c3.lastProjection!.result!;
    assert.ok(r1 && r2 && r3);
    assert.deepEqual(r1, r2);
    assert.deepEqual(r2, r3);
    assert.equal(c1.lastProjection!.version, c2.lastProjection!.version);
    assert.equal(c2.lastProjection!.version, c3.lastProjection!.version);

    // Host triggers rematch
    c1.send({
      type: 'rematch',
      actionId: '10000000-0000-4000-8000-000000000015',
      baseVersion: c1.lastProjection!.version,
    });

    // All return to lobby with reset ready flags and location IDs
    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'lobby'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'lobby'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'lobby'),
    ]);

    assert.ok(c1.lastProjection!.players.every((p) => !p.ready && p.locationId === null));
    assert.equal(c1.lastProjection!.result, undefined);

    c1.close();
    c2.close();
    c3.close();
  });

  test('advanced L7 game with 4 players and abilities (Butler peek or Detective send)', async () => {
    const c1 = await createTestClient('HostDet');
    const c2 = await createTestClient('P2');
    const c3 = await createTestClient('P3');
    const c4 = await createTestClient('P4');

    c1.send({
      type: 'create_room',
      actionId: '20000000-0000-4000-8000-000000000001',
      playerName: 'HostDet',
    });
    const welcome = (await c1.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;
    const roomCode = welcome.roomCode;
    await c1.waitFor((m) => m.type === 'projection');

    c2.send({
      type: 'join_room',
      actionId: '20000000-0000-4000-8000-000000000002',
      roomCode,
      playerName: 'P2',
    });
    await c2.waitFor((m) => m.type === 'welcome');
    await c2.waitFor((m) => m.type === 'projection');

    c3.send({
      type: 'join_room',
      actionId: '20000000-0000-4000-8000-000000000003',
      roomCode,
      playerName: 'P3',
    });
    await c3.waitFor((m) => m.type === 'welcome');
    await c3.waitFor((m) => m.type === 'projection');

    c4.send({
      type: 'join_room',
      actionId: '20000000-0000-4000-8000-000000000004',
      roomCode,
      playerName: 'P4',
    });
    await c4.waitFor((m) => m.type === 'welcome');

    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.players.length === 4),
      c2.waitFor((m) => m.type === 'projection' && m.projection.players.length === 4),
      c3.waitFor((m) => m.type === 'projection' && m.projection.players.length === 4),
      c4.waitFor((m) => m.type === 'projection' && m.projection.players.length === 4),
    ]);

    // Select level L7
    c1.send({
      type: 'select_level',
      actionId: '20000000-0000-4000-8000-000000000005',
      baseVersion: c1.lastProjection!.version,
      level: 'L7',
    });
    await c2.waitFor((m) => m.type === 'projection' && m.projection.level === 'L7');
    await c3.waitFor((m) => m.type === 'projection' && m.projection.level === 'L7');
    await c4.waitFor((m) => m.type === 'projection' && m.projection.level === 'L7');

    // Ready all sequentially
    c1.send({
      type: 'set_ready',
      actionId: '20000000-0000-4000-8000-000000000006',
      baseVersion: c1.lastProjection!.version,
      ready: true,
    });
    await c2.waitFor((m) => m.type === 'projection' && m.projection.players[0].ready);

    c2.send({
      type: 'set_ready',
      actionId: '20000000-0000-4000-8000-000000000007',
      baseVersion: c2.lastProjection!.version,
      ready: true,
    });
    await c3.waitFor((m) => m.type === 'projection' && m.projection.players[1].ready);

    c3.send({
      type: 'set_ready',
      actionId: '20000000-0000-4000-8000-000000000008',
      baseVersion: c3.lastProjection!.version,
      ready: true,
    });
    await c4.waitFor((m) => m.type === 'projection' && m.projection.players[2].ready);

    c4.send({
      type: 'set_ready',
      actionId: '20000000-0000-4000-8000-000000000009',
      baseVersion: c4.lastProjection!.version,
      ready: true,
    });
    await c1.waitFor((m) => m.type === 'projection' && m.projection.players.every((p) => p.ready));

    // Start
    c1.send({
      type: 'start_game',
      actionId: '20000000-0000-4000-8000-000000000010',
      baseVersion: c1.lastProjection!.version,
    });
    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
      c4.waitFor((m) => m.type === 'projection' && m.projection.phase === 'draft'),
    ]);

    // Run 4-player draft
    const c1Cards = c1.lastProjection!.ownCards!;
    c1.send({
      type: 'choose_and_pass',
      actionId: '20000000-0000-4000-8000-000000000011',
      baseVersion: c1.lastProjection!.version,
      keepCardId: c1Cards[0].id,
      passToPlayerId: c2.playerId!,
    });
    await c2.waitFor((m) => m.type === 'projection' && m.projection.currentActorId === c2.playerId);

    const c2Cards = c2.lastProjection!.ownCards!;
    c2.send({
      type: 'choose_and_pass',
      actionId: '20000000-0000-4000-8000-000000000012',
      baseVersion: c2.lastProjection!.version,
      keepCardId: c2Cards[0].id,
      passToPlayerId: c3.playerId!,
    });
    await c3.waitFor((m) => m.type === 'projection' && m.projection.currentActorId === c3.playerId);

    const c3Cards = c3.lastProjection!.ownCards!;
    c3.send({
      type: 'choose_and_pass',
      actionId: '20000000-0000-4000-8000-000000000013',
      baseVersion: c3.lastProjection!.version,
      keepCardId: c3Cards[0].id,
      passToPlayerId: c4.playerId!,
    });
    await c4.waitFor((m) => m.type === 'projection' && m.projection.currentActorId === c4.playerId);

    const c4Cards = c4.lastProjection!.ownCards!;
    c4.send({
      type: 'choose_and_pass',
      actionId: '20000000-0000-4000-8000-000000000014',
      baseVersion: c4.lastProjection!.version,
      keepCardId: c4Cards[0].id,
    });

    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
      c2.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
      c3.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
      c4.waitFor((m) => m.type === 'projection' && m.projection.phase === 'discussion'),
    ]);

    // Check roles
    const clients = [c1, c2, c3, c4];
    const detectiveClient = clients.find((c) => c.lastProjection?.ownRole?.role === 'detective');
    const butlerClient = clients.find((c) => c.lastProjection?.ownRole?.role === 'butler');

    if (butlerClient) {
      // Butler peeks
      butlerClient.send({
        type: 'butler_peek',
        actionId: '20000000-0000-4000-8000-000000000015',
        baseVersion: butlerClient.lastProjection!.version,
      });
      await butlerClient.waitFor((m) => m.type === 'projection' && Boolean(m.projection.butlerPeek));
      assert.ok(butlerClient.lastProjection!.butlerPeek!.length > 0);

      // Other clients must NOT see butlerPeek cards
      const otherClients = clients.filter((c) => c !== butlerClient);
      for (const other of otherClients) {
        assert.equal(other.lastProjection!.butlerPeek, undefined);
      }
    }

    if (detectiveClient) {
      // Detective sends occupied location
      const targetLoc = c1.lastProjection!.players.find((p) => p.playerId !== detectiveClient.playerId)!.locationId!;
      detectiveClient.send({
        type: 'detective_send',
        actionId: '20000000-0000-4000-8000-000000000016',
        baseVersion: detectiveClient.lastProjection!.version,
        targetLocation: targetLoc,
      });

      // Directly resolves to resolution without voting!
      await Promise.all(
        clients.map((c) => c.waitFor((m) => m.type === 'projection' && m.projection.phase === 'resolution'))
      );
      assert.ok(c1.lastProjection!.result);
    } else {
      // Advance to vote normally
      c1.send({
        type: 'advance_to_vote',
        actionId: '20000000-0000-4000-8000-000000000017',
        baseVersion: c1.lastProjection!.version,
      });
      await Promise.all(clients.map((c) => c.waitFor((m) => m.type === 'projection' && m.projection.phase === 'voting')));
    }

    c1.close();
    c2.close();
    c3.close();
    c4.close();
  });

  test('hardened failure & recovery contracts: stale, duplicate, forged token, disconnect grace & host transfer', async () => {
    const c1 = await createTestClient('HostRecover');
    const c2 = await createTestClient('P2Recover');

    c1.send({
      type: 'create_room',
      actionId: '30000000-0000-4000-8000-000000000001',
      playerName: 'HostRecover',
    });
    const welcome = (await c1.waitFor((m) => m.type === 'welcome')) as Extract<ServerMessage, { type: 'welcome' }>;
    const roomCode = welcome.roomCode;
    await c1.waitFor((m) => m.type === 'projection');

    c2.send({
      type: 'join_room',
      actionId: '30000000-0000-4000-8000-000000000002',
      roomCode,
      playerName: 'P2Recover',
    });
    await c2.waitFor((m) => m.type === 'welcome');

    await Promise.all([
      c1.waitFor((m) => m.type === 'projection' && m.projection.players.length === 2),
      c2.waitFor((m) => m.type === 'projection' && m.projection.players.length === 2),
    ]);

    // 1. Concurrent Stale Action: Send invalid baseVersion
    c1.send({
      type: 'set_ready',
      actionId: '30000000-0000-4000-8000-000000000003',
      baseVersion: 9999, // Stale version!
      ready: true,
    });
    const err = await c1.waitFor((m) => m.type === 'error');
    assert.equal(err.type, 'error');
    if (err.type === 'error') {
      assert.equal(err.code, 'STALE_VERSION');
    }

    // 2. Duplicate Action: Resending same actionId yields current projection without mutation
    const currentVer = c1.lastProjection!.version;
    c1.send({
      type: 'set_ready',
      actionId: '30000000-0000-4000-8000-000000000004',
      baseVersion: currentVer,
      ready: true,
    });
    const updatedProj = await c1.waitFor((m) => m.type === 'projection' && m.projection.version === currentVer + 1);
    assert.equal(updatedProj.type, 'projection');

    // Re-send identical actionId
    c1.send({
      type: 'set_ready',
      actionId: '30000000-0000-4000-8000-000000000004',
      baseVersion: currentVer + 1,
      ready: true,
    });
    // Should ack with projection and NOT increment version again
    const ack = await c1.waitFor((m) => m.type === 'projection');
    if (ack.type === 'projection') {
      assert.equal(ack.projection.version, currentVer + 1);
    }

    // 3. Forged Seat Token on Rejoin
    const cFake = await createTestClient('Imposter');
    cFake.send({
      type: 'rejoin',
      actionId: '30000000-0000-4000-8000-000000000005',
      roomCode,
      seatToken: 'FORGED_INVALID_SEAT_TOKEN_XYZ',
    });
    const fakeErr = await cFake.waitFor((m) => m.type === 'error');
    if (fakeErr.type === 'error') {
      assert.equal(fakeErr.code, 'INVALID_TOKEN');
    }
    cFake.close();

    // 4. Host Disconnect and Reconnect Grace / Host Transfer
    // Host c1 disconnects
    c1.close();
    await c2.waitFor((m) => m.type === 'projection' && !m.projection.players[0].connected);

    // Advance simulated time past 90s grace period (e.g. +95s)
    simulatedTime += 95_000;
    manager.checkExpiry(roomCode);

    // Host should have transferred to c2!
    const roomRec = manager.getRoom(roomCode)!;
    assert.equal(roomRec.state.hostPlayerId, c2.playerId);

    c2.close();
  });
});
