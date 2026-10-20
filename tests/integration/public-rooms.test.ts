import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RoomManager } from '../../src/server/rooms.ts';
import { authenticatedPlayerSchema } from '../../src/shared/accounts.ts';

test('public directory excludes private, offline and full rooms without leaking identities', () => {
  const manager = new RoomManager();
  const identity = randomUUID();
  manager.createRoom('私人房主', randomUUID(), { userId: identity, isPublic: false });
  const room = manager.createRoom('公開房主', randomUUID(), { userId: randomUUID(), isPublic: true });
  let listing = manager.listPublicRooms();
  assert.equal(listing.length, 1);
  assert.equal(listing[0].roomCode, room.roomCode);
  assert.ok(!JSON.stringify(listing).includes('seatToken'));
  assert.ok(!JSON.stringify(listing).includes(identity));
  assert.throws(() => manager.joinRoom(room.roomCode, '第二座位', randomUUID(), identity), /房間/);
  for (let index = 0; index < 5; index++) manager.joinRoom(room.roomCode, `玩家${index}`, randomUUID(), randomUUID());
  assert.equal(manager.listPublicRooms().length, 0);
});

test('seat reconnect additionally requires its original account identity', () => {
  const manager = new RoomManager();
  const identity = randomUUID();
  const room = manager.createRoom('房主', randomUUID(), { userId: identity, isPublic: true });
  assert.throws(() => manager.rejoinRoom(room.roomCode, room.seatToken, randomUUID()), /憑證/);
  assert.equal(manager.rejoinRoom(room.roomCode, room.seatToken, identity).playerId, room.playerId);
});

test('24 Unicode codepoints remain usable across account and room validation', () => {
  const name = '🕯'.repeat(24);
  const identity = authenticatedPlayerSchema.parse({userId:randomUUID(),displayName:name,expiresAt:new Date().toISOString()});
  const manager = new RoomManager();
  const room = manager.createRoom(identity.displayName,randomUUID(),{userId:identity.userId});
  assert.equal(room.projection.players[0].playerName,name);
  assert.throws(() => manager.createRoom('🕯'.repeat(25)), /長度/);
});
