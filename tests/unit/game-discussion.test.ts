import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/shared/game.ts';
import { reducePreparedGame as reduceGame } from '../helpers/draft.ts';
import { RulesError } from '../../src/shared/rules.ts';
import type { CanonicalGameState } from '../../src/shared/state.ts';

function uuid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `11111111-1111-4111-8111-${tail}`;
}

function setupDiscussion(): CanonicalGameState {
  let state = createGame({
    roomCode: 'DISC01',
    hostPlayerId: 'p1',
    hostPlayerName: 'Alice',
    seed: 'seed-discussion-red',
  });
  state = reduceGame(state, { type: 'add_player', actionId: uuid(1), playerId: 'p2', playerName: 'Bob' });
  state = reduceGame(state, { type: 'add_player', actionId: uuid(2), playerId: 'p3', playerName: 'Cara' });
  for (const [i, p] of ['p1', 'p2', 'p3'].entries()) {
    state = reduceGame(state, {
      type: 'set_ready',
      actionId: uuid(10 + i),
      baseVersion: state.version,
      playerId: p,
      ready: true,
    });
  }
  state = reduceGame(state, {
    type: 'start_game',
    actionId: uuid(20),
    baseVersion: state.version,
    playerId: 'p1',
  });
  // Drive draft to discussion: p1 -> p2 -> p3(final)
  let n = 30;
  const order = ['p1', 'p2', 'p3'];
  for (let i = 0; i < order.length; i++) {
    const actor = state.currentActorId!;
    const cards = state.pendingCards[actor];
    const nextP = i < order.length - 1 ? order[i + 1] : undefined;
    state = reduceGame(state, {
      type: 'choose_and_pass',
      actionId: uuid(n++),
      baseVersion: state.version,
      playerId: actor,
      keepCardId: cards[0].id,
      passToPlayerId: nextP,
    });
  }
  assert.equal(state.phase, 'discussion');
  return state;
}

describe('discussion consensus', () => {
  test('createGame initializes discussionConsents=[] and discussionDeadlineAt=null', () => {
    const s = createGame({ roomCode: 'X', hostPlayerId: 'p1', hostPlayerName: 'A' });
    assert.deepEqual((s as CanonicalGameState).discussionConsents, []);
    assert.equal((s as CanonicalGameState).discussionDeadlineAt, null);
  });

  test('non-host connected player consent is recorded, stays in discussion', () => {
    let s = setupDiscussion();
    const v = s.version;
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(100), baseVersion: v, playerId: 'p2' });
    assert.equal(s.phase, 'discussion');
    assert.deepEqual(s.discussionConsents, ['p2']);
    assert.equal(s.version, v + 1);
  });

  test('host single consent does NOT bypass to voting', () => {
    let s = setupDiscussion();
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(101), baseVersion: s.version, playerId: 'p1' });
    assert.equal(s.phase, 'discussion');
    assert.deepEqual(s.discussionConsents, ['p1']);
  });

  test('unanimous consent from all connected transitions to voting and clears', () => {
    let s = setupDiscussion();
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(102), baseVersion: s.version, playerId: 'p1' });
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(103), baseVersion: s.version, playerId: 'p2' });
    assert.equal(s.phase, 'discussion');
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(104), baseVersion: s.version, playerId: 'p3' });
    assert.equal(s.phase, 'voting');
    assert.deepEqual(s.discussionConsents, []);
    assert.equal(s.discussionDeadlineAt, null);
  });

  test('duplicate consent is idempotent without version bump', () => {
    let s = setupDiscussion();
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(105), baseVersion: s.version, playerId: 'p2' });
    const v = s.version;
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(106), baseVersion: v, playerId: 'p2' });
    assert.deepEqual(s.discussionConsents, ['p2']);
    assert.equal(s.version, v);
    assert.equal(s.phase, 'discussion');
  });

  test('disconnected player cannot consent', () => {
    const s = setupDiscussion();
    const disc = { ...s, players: s.players.map((p) => (p.playerId === 'p2' ? { ...p, connected: false } : p)) };
    assert.throws(
      () => reduceGame(disc, { type: 'advance_to_vote', actionId: uuid(107), baseVersion: disc.version, playerId: 'p2' }),
      (e: unknown) => e instanceof RulesError,
    );
  });

  test('reducer never arms deadline (server time only)', () => {
    let s = setupDiscussion();
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(108), baseVersion: s.version, playerId: 'p1' });
    s = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(109), baseVersion: s.version, playerId: 'p2' });
    assert.equal(s.discussionDeadlineAt, null);
  });

  test('stale baseVersion on simultaneous consent throws', () => {
    const s = setupDiscussion();
    const v = s.version;
    const s1 = reduceGame(s, { type: 'advance_to_vote', actionId: uuid(110), baseVersion: v, playerId: 'p1' });
    // Same baseVersion applied to the advanced state is stale and must throw.
    assert.throws(
      () => reduceGame(s1, { type: 'advance_to_vote', actionId: uuid(111), baseVersion: v, playerId: 'p2' }),
      (e: unknown) => e instanceof RulesError,
    );
    assert.deepEqual(s1.discussionConsents, ['p1']);
  });
});
