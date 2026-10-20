import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RoomManager } from '../../src/server/rooms.ts';
import { RoomPersistence } from '../../src/server/persistence.ts';
import type { GameAccounts } from '../../src/server/accounts.ts';
import { RoomQueue } from '../../src/server/room-queue.ts';

function readyRoom() {
  const manager = new RoomManager();
  const created = manager.createRoom('房主', randomUUID(), { userId: randomUUID() });
  manager.joinRoom(created.roomCode, '玩家二', randomUUID(), randomUUID());
  manager.joinRoom(created.roomCode, '玩家三', randomUUID(), randomUUID());
  const room = manager.getRoom(created.roomCode)!;
  for (const player of room.state.players) manager.dispatchAction(room.code, player.playerId, { type: 'set_ready', ready: true, actionId: randomUUID(), baseVersion: room.state.version });
  const accounts: GameAccounts = {
    resolveSession: async () => ({ userId: randomUUID(), displayName: '測試', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    registerInstance: async () => {}, recordRoom: async () => {}, closeRoom: async () => {}, completeMatch: async () => {}, abandonMatch: async () => {}, startMatch: async () => {},
  };
  return { manager, created, room, accounts };
}

test('replayed rematch and start cannot detach the next persisted match', async () => {
  const { manager, created, room, accounts } = readyRoom();
  const persistence = new RoomPersistence(accounts, randomUUID());
  const rematchId = randomUUID();
  room.seats.get(created.playerId)!.actionIds.push(rematchId);
  const start = { type: 'start_game' as const, actionId: randomUUID(), baseVersion: room.state.version };
  await persistence.dispatch(manager, room, created.playerId, start);
  const matchId = room.matchId;
  await persistence.dispatch(manager, room, created.playerId, { type: 'rematch', actionId: rematchId, baseVersion: 0 });
  assert.equal(room.matchId, matchId);
  await persistence.dispatch(manager, room, created.playerId, start);
  assert.equal(room.matchId, matchId);
  assert.equal(room.roundNumber, 1);
});

test('failed abandonment must resolve before a new durable start can be created', async () => {
  const { manager, created, room, accounts } = readyRoom();
  const previousMatch = randomUUID();
  room.matchId = previousMatch;
  let available = false;
  let starts = 0;
  accounts.abandonMatch = async id => { assert.equal(id, previousMatch); if (!available) throw new Error('offline'); };
  accounts.startMatch = async () => { starts++; };
  const persistence = new RoomPersistence(accounts, randomUUID());
  const start = { type: 'start_game' as const, actionId: randomUUID(), baseVersion: room.state.version };
  await assert.rejects(persistence.dispatch(manager, room, created.playerId, start), /offline/);
  assert.equal(room.pendingStart, undefined);
  assert.equal(starts, 0);
  available = true;
  await persistence.dispatch(manager, room, created.playerId, start);
  assert.equal(room.state.phase, 'draft');
  assert.notEqual(room.matchId, previousMatch);
  assert.equal(starts, 1);
});

test('queued abandonment response cannot clear the next match identity', async () => {
  const { manager, created, room, accounts } = readyRoom();
  room.matchId = randomUUID();
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  accounts.abandonMatch = async () => delayed;
  const persistence = new RoomPersistence(accounts, randomUUID());
  const queue = new RoomQueue();
  const cleanup = queue.run(room.code, () => persistence.retry(room));
  const start = queue.run(room.code, () => persistence.dispatch(manager, room, created.playerId, { type: 'start_game', actionId: randomUUID(), baseVersion: room.state.version }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(room.pendingStart, undefined);
  assert.equal(room.state.phase, 'lobby');
  release();
  await Promise.all([cleanup, start]);
  assert.equal(room.state.phase, 'draft');
  assert.ok(room.matchId);
});

test('capacity eviction never discards pending match results', () => {
  const manager = new RoomManager();
  for (let index = 0; index < 100; index++) {
    const created = manager.createRoom(`玩家${index}`);
    const room = manager.getRoom(created.roomCode)!;
    room.historyStatus = 'saving';
    room.pendingResult = { endedAt: new Date().toISOString(), winningFaction: 'witness_faction', winningPlayerIds: [], reason: 'test', assignments: [] };
    manager.disconnectPlayer(room.code, created.playerId);
  }
  assert.throws(() => manager.createRoom('新玩家'), /房間不存在/);
  assert.equal(manager.listRooms().length, 100);
});

test('failed durable start stays in lobby and retries the same match identity', async () => {
  const manager = new RoomManager();
  const created = manager.createRoom('房主', randomUUID(), { userId: randomUUID() });
  manager.joinRoom(created.roomCode, '玩家二', randomUUID(), randomUUID());
  manager.joinRoom(created.roomCode, '玩家三', randomUUID(), randomUUID());
  const room = manager.getRoom(created.roomCode)!;
  for (const player of room.state.players) manager.dispatchAction(room.code, player.playerId, { type: 'set_ready', ready: true, actionId: randomUUID(), baseVersion: room.state.version });
  const identities: string[] = [];
  let available = false;
  const accounts: GameAccounts = {
    resolveSession: async () => ({ userId: randomUUID(), displayName: '測試', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    registerInstance: async () => {}, recordRoom: async () => {}, closeRoom: async () => {}, completeMatch: async () => {}, abandonMatch: async () => {},
    startMatch: async (payload) => { identities.push(payload.matchId); if (!available) throw new Error('unavailable'); },
  };
  const persistence = new RoomPersistence(accounts, randomUUID());
  await assert.rejects(persistence.dispatch(manager, room, created.playerId, { type: 'start_game', actionId: randomUUID(), baseVersion: room.state.version }), /unavailable/);
  assert.equal(room.state.phase, 'lobby');
  assert.equal(room.historyStatus, 'saving');
  available = true;
  room.retryAt = 0;
  await persistence.retry(room);
  assert.equal(room.state.phase, 'draft');
  assert.equal(new Set(identities).size, 1);
});
