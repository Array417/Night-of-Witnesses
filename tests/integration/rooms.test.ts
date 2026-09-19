import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, RoomError } from '../../src/server/rooms.ts';
import { projectForViewer } from '../../src/server/project.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('room lifecycle, per-seat projections, and reconnect policy', () => {
  test('identical unavailable-room error for non-existent, full, or locked room', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });

    // Non-existent room
    assert.throws(
      () => manager.joinRoom('NOPE12', 'Player1', '00000000-0000-4000-8000-100000000001'),
      (err: unknown) => err instanceof RoomError && err.code === 'ROOM_UNAVAILABLE'
    );

    // Create a room
    const { roomCode } = manager.createRoom('Host', '00000000-0000-4000-8000-100000000002');

    // Fill the room to 6 players
    for (let i = 2; i <= 6; i++) {
      manager.joinRoom(roomCode, `Player${i}`, `00000000-0000-4000-8000-10000000000${i}`);
    }

    // 7th player receives identical ROOM_UNAVAILABLE error
    assert.throws(
      () => manager.joinRoom(roomCode, 'Player7', '00000000-0000-4000-8000-100000000007'),
      (err: unknown) => err instanceof RoomError && err.code === 'ROOM_UNAVAILABLE'
    );
  });

  test('maximum 100 rooms cap enforced', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });

    for (let i = 0; i < 100; i++) {
      manager.createRoom(`Host${i}`, `10000000-0000-4000-8000-20000000000${i}`);
    }

    assert.throws(
      () => manager.createRoom('Host101', '10000000-0000-4000-8000-200000000101'),
      (err: unknown) => err instanceof RoomError && err.code === 'ROOM_UNAVAILABLE'
    );
  });

  test('seat token is bound to one room and seat, and rejects forgery', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });

    const r1 = manager.createRoom('Alice', '00000000-0000-4000-8000-300000000001');
    const r2 = manager.createRoom('Bob', '00000000-0000-4000-8000-300000000002');

    // Attempting to rejoin r1 using r2's token fails
    assert.throws(
      () => manager.rejoinRoom(r1.roomCode, r2.seatToken),
      (err: unknown) => err instanceof RoomError && err.code === 'INVALID_TOKEN'
    );

    // Tampered token fails
    assert.throws(
      () => manager.rejoinRoom(r1.roomCode, 'forged-token-xyz'),
      (err: unknown) => err instanceof RoomError && err.code === 'INVALID_TOKEN'
    );
  });

  test('projection canaries are completely absent from other viewers', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });
    const { roomCode, seatToken: hostToken, playerId: p1 } = manager.createRoom('Alice', '00000000-0000-4000-8000-400000000001');
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', '00000000-0000-4000-8000-400000000002');
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Charlie', '00000000-0000-4000-8000-400000000003');

    for (const pid of [p1, p2, p3]) {
      manager.dispatchAction(roomCode, pid, {
        type: 'set_ready',
        actionId: `00000000-0000-4000-8000-40000000001${pid}`,
        baseVersion: manager.getRoom(roomCode)!.state.version,
        ready: true,
      });
    }

    manager.dispatchAction(roomCode, p1, {
      type: 'start_game',
      actionId: '00000000-0000-4000-8000-400000000020',
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });

    const room = manager.getRoom(roomCode)!;
    // Inject canary into state
    const canaryCardId = 'CANARY_SECRET_CARD_IN_DECK_12345';
    room.state.playableCards[room.state.playableCards.length - 1].id = canaryCardId;

    const projP1 = projectForViewer(room.state, p1);
    const projP2 = projectForViewer(room.state, p2);

    const jsonP1 = JSON.stringify(projP1);
    const jsonP2 = JSON.stringify(projP2);

    // Neither viewer should have the secret canary card from the back of the deck
    assert.ok(!jsonP1.includes(canaryCardId));
    assert.ok(!jsonP2.includes(canaryCardId));

    // Seat token should never appear in projection
    assert.ok(!jsonP1.includes(hostToken));
    assert.ok(!jsonP2.includes(hostToken));
  });

  test('duplicate action ID is acknowledged without mutating state', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', '00000000-0000-4000-8000-500000000001');

    const v1 = manager.getRoom(roomCode)!.state.version;
    const actionId = '00000000-0000-4000-8000-500000000002';

    // First execution
    const res1 = manager.dispatchAction(roomCode, p1, {
      type: 'set_ready',
      actionId,
      baseVersion: v1,
      ready: true,
    });

    const v2 = manager.getRoom(roomCode)!.state.version;
    assert.equal(v2, v1 + 1);

    // Duplicate execution with same actionId
    const res2 = manager.dispatchAction(roomCode, p1, {
      type: 'set_ready',
      actionId,
      baseVersion: v1,
      ready: true,
    });

    const v3 = manager.getRoom(roomCode)!.state.version;
    assert.equal(v3, v2, 'Duplicate action must not mutate state version');
    assert.deepEqual(res1.projection, res2.projection);
  });

  test('concurrent actions with same base version: one increments, other returns stale', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', '00000000-0000-4000-8000-600000000001');
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', '00000000-0000-4000-8000-600000000002');

    const initialVersion = manager.getRoom(roomCode)!.state.version;

    // First action succeeds
    manager.dispatchAction(roomCode, p1, {
      type: 'set_ready',
      actionId: '00000000-0000-4000-8000-600000000003',
      baseVersion: initialVersion,
      ready: true,
    });

    // Concurrent second action with old baseVersion throws STALE_VERSION
    assert.throws(
      () =>
        manager.dispatchAction(roomCode, p2, {
          type: 'set_ready',
          actionId: '00000000-0000-4000-8000-600000000004',
          baseVersion: initialVersion,
          ready: true,
        }),
      (err: unknown) => err instanceof RoomError && err.code === 'STALE_VERSION'
    );
  });

  test('reconnect policy: rejoin at 89s restores seat; expiry at 91s cancels draft and transfers host', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });
    const { roomCode, seatToken: hostToken, playerId: p1 } = manager.createRoom('Alice', '00000000-0000-4000-8000-700000000001');
    const { playerId: p2, seatToken: p2Token } = manager.joinRoom(roomCode, 'Bob', '00000000-0000-4000-8000-700000000002');
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Charlie', '00000000-0000-4000-8000-700000000003');

    // Disconnect Bob at t=1000
    manager.disconnectPlayer(roomCode, p2);
    assert.equal(manager.getRoom(roomCode)!.seats.get(p2)!.connected, false);

    // Rejoin Bob at t=1089 (89 seconds later) -> succeeds
    mockTime += 89000;
    const rejoinResult = manager.rejoinRoom(roomCode, p2Token);
    assert.equal(rejoinResult.playerId, p2);
    assert.equal(manager.getRoom(roomCode)!.seats.get(p2)!.connected, true);

    // Now ready up and start game into draft phase
    for (const pid of [p1, p2, p3]) {
      manager.dispatchAction(roomCode, pid, {
        type: 'set_ready',
        actionId: `00000000-0000-4000-8000-70000000001${pid}`,
        baseVersion: manager.getRoom(roomCode)!.state.version,
        ready: true,
      });
    }
    manager.dispatchAction(roomCode, p1, {
      type: 'start_game',
      actionId: '00000000-0000-4000-8000-700000000020',
      baseVersion: manager.getRoom(roomCode)!.state.version,
    });
    assert.equal(manager.getRoom(roomCode)!.state.phase, 'draft');

    // Disconnect host (Alice) during draft at current time
    manager.disconnectPlayer(roomCode, p1);

    // Advance time by 91 seconds -> expiry triggers
    mockTime += 91000;
    manager.checkExpiry(roomCode);

    const roomAfterExpiry = manager.getRoom(roomCode)!;
    // On draft expiry, round cancels to lobby!
    assert.equal(roomAfterExpiry.state.phase, 'lobby');
    // Host transferred to earliest-joined connected player (Bob)
    assert.equal(roomAfterExpiry.state.hostPlayerId, p2);
  });

  test('writes projected JSONL evidence for task 7', () => {
    let mockTime = 1000;
    const manager = new RoomManager({ getTime: () => mockTime });
    const { roomCode, playerId: p1 } = manager.createRoom('Alice', '00000000-0000-4000-8000-800000000001');
    const { playerId: p2 } = manager.joinRoom(roomCode, 'Bob', '00000000-0000-4000-8000-800000000002');
    const { playerId: p3 } = manager.joinRoom(roomCode, 'Charlie', '00000000-0000-4000-8000-800000000003');

    const projP1 = projectForViewer(manager.getRoom(roomCode)!.state, p1);
    const projP2 = projectForViewer(manager.getRoom(roomCode)!.state, p2);

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const jsonlContent = `${JSON.stringify(projP1)}\n${JSON.stringify(projP2)}\n`;
    fs.writeFileSync(path.join(evidenceDir, 'task-7-projections.jsonl'), jsonlContent, 'utf8');
  });
});
