import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/server/rooms.ts';
import { projectForViewer } from '../../src/server/project.ts';
import { randomUUID } from 'node:crypto';

function setup() {
  let now = 1000;
  const manager = new RoomManager({ getTime: () => now });
  const host = manager.createRoom('甲');
  const ids = [host.playerId, manager.joinRoom(host.roomCode, '乙').playerId, manager.joinRoom(host.roomCode, '丙').playerId];
  const room = manager.getRoom(host.roomCode)!;
  const act = (playerId: string, action: Record<string, unknown>) => manager.dispatchAction(host.roomCode, playerId, {
    ...action, actionId: randomUUID(), baseVersion: room.state.version,
  } as Parameters<RoomManager['dispatchAction']>[2]);
  for (const id of ids) act(id, { type: 'set_ready', ready: true });
  act(ids[0], { type: 'start_game' });
  const finish = () => { now += 2000; manager.checkAllCardMotions(); };
  return { manager, ids, room, act, finish };
}

test('first actor draws each card explicitly; spectators get counts without private cards', () => {
  const { ids, room, act, finish } = setup();
  assert.deepEqual(room.state.pendingCards[ids[0]], []);
  assert.equal(projectForViewer(room.state, ids[1]).players[0].handCount, 0);
  assert.throws(() => act(ids[1], { type: 'draw_card' }), /Not your turn/);
  act(ids[0], { type: 'draw_card' });
  assert.equal(room.state.pendingCards[ids[0]].length, 1);
  const observer = projectForViewer(room.state, ids[1]);
  assert.equal(observer.players[0].handCount, 1);
  assert.equal(observer.cardMotion?.kind, 'draw');
  assert.equal(observer.cardMotion?.card, undefined);
  assert.equal(observer.ownCards, undefined);
  assert.throws(() => act(ids[0], { type: 'draw_card' }), /moving/);
  finish();
  assert.throws(() => act(ids[0], { type: 'choose_and_pass', keepCardId: room.state.pendingCards[ids[0]][0].id, passToPlayerId: ids[1] }), /pending cards/);
  act(ids[0], { type: 'draw_card' });
  finish();
  assert.equal(room.state.pendingCards[ids[0]].length, 2);
  assert.throws(() => act(ids[0], { type: 'draw_card' }), /two cards/);
});

test('pass shows its face only to sender and recipient, then unlocks recipient drawing', () => {
  const { ids, room, act, finish } = setup();
  for (let i = 0; i < 2; i++) { act(ids[0], { type: 'draw_card' }); finish(); }
  const [kept, passed] = room.state.pendingCards[ids[0]];
  act(ids[0], { type: 'choose_and_pass', keepCardId: kept.id, passToPlayerId: ids[1], testimonyRole: 'guest' });
  assert.equal(room.state.currentActorId, ids[0]);
  assert.equal(room.state.pendingCards[ids[1]].length, 1);
  for (const id of ids.slice(0, 2)) assert.deepEqual(projectForViewer(room.state, id).cardMotion?.card, passed);
  const spectator = projectForViewer(room.state, ids[2]);
  assert.equal(spectator.cardMotion?.card, undefined);
  assert.ok(!JSON.stringify(spectator).includes(`"id":"${passed.id}"`));
  assert.throws(() => act(ids[1], { type: 'draw_card' }), /moving/);
  finish();
  assert.equal(room.state.currentActorId, ids[1]);
  act(ids[1], { type: 'draw_card' });
  finish();
  assert.equal(room.state.pendingCards[ids[1]].length, 2);
  assert.equal(new Set([...Object.values(room.state.keptRoles), ...room.state.pendingCards[ids[1]]].map(card => card.id)).size, 3);
});

test('guest room transfer finishes before discussion and rematch clears the draft', () => {
  const { ids, room, act, finish } = setup();
  for (let i = 0; i < ids.length; i++) {
    while (room.state.pendingCards[ids[i]].length < 2) { act(ids[i], { type: 'draw_card' }); finish(); }
    act(ids[i], { type: 'choose_and_pass', keepCardId: room.state.pendingCards[ids[i]][0].id, passToPlayerId: ids[i + 1] });
    assert.equal(room.state.phase, 'draft');
    finish();
  }
  assert.equal(room.state.phase, 'discussion');
  assert.equal(room.state.drawPileIndex, 4);
  assert.equal(room.state.cardMotion, null);
  assert.ok(room.state.guestRoomCard);
  for (const id of ids) act(id, { type: 'advance_to_vote' });
  for (const id of ids) act(id, { type: 'cast_vote', targetLocation: room.state.players[0].locationId });
  act(ids[0], { type: 'rematch' });
  assert.equal(room.state.drawPileIndex, 0);
  assert.equal(room.state.cardMotion, null);
  assert.deepEqual(room.state.pendingCards, {});
});
