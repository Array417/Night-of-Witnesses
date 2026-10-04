import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/server/rooms.ts';

test('leaving removes seat and token and immediately hands host to earliest online player', () => {
  let now = 100;
  const manager = new RoomManager({ getTime: () => now++ });
  const host = manager.createRoom('Host', 'create');
  const offline = manager.joinRoom(host.roomCode, 'Offline', 'join1');
  const next = manager.joinRoom(host.roomCode, 'Next', 'join2');
  manager.disconnectPlayer(host.roomCode, offline.playerId);
  manager.leaveRoom(host.roomCode, host.playerId);
  const room = manager.getRoom(host.roomCode)!;
  assert.equal(room.state.hostPlayerId, next.playerId);
  assert.equal(room.seats.has(host.playerId), false);
  assert.equal(room.seatTokens.has(host.seatToken), false);
  assert.equal(room.state.players.some(p => p.playerId === host.playerId), false);
  assert.throws(() => manager.rejoinRoom(host.roomCode, host.seatToken));
  manager.leaveRoom(host.roomCode, offline.playerId);
  assert.equal(room.state.players.length, 1);
  manager.leaveRoom(host.roomCode, next.playerId);
  assert.equal(manager.getRoom(host.roomCode), undefined);
});

test('leaving a started game is rejected without removing the seat', () => {
  const manager = new RoomManager();
  const host = manager.createRoom('Host', 'create');
  const room = manager.getRoom(host.roomCode)!;
  room.state.phase = 'discussion';
  assert.throws(() => manager.leaveRoom(host.roomCode, host.playerId));
  assert.equal(room.seats.has(host.playerId), true);
});
