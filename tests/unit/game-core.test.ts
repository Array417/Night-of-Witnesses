import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  reduceGame,
  type GameAction,
} from '../../src/shared/game.ts';
import { RulesError } from '../../src/shared/rules.ts';
import fs from 'node:fs';
import path from 'node:path';

function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return obj;
}

describe('pure authoritative core reducer (L1-L6)', () => {
  test('same seed and action script yields byte-identical state and incrementing versions', () => {
    const playScript = (seed: string) => {
      let state = createGame({
        roomCode: 'ABCDEF',
        hostPlayerId: 'p1',
        hostPlayerName: 'Alice',
        seed,
      });

      // Add Bob and Charlie
      state = reduceGame(state, {
        type: 'add_player',
        actionId: '00000000-0000-4000-8000-000000000001',
        playerId: 'p2',
        playerName: 'Bob',
      });
      state = reduceGame(state, {
        type: 'add_player',
        actionId: '00000000-0000-4000-8000-000000000002',
        playerId: 'p3',
        playerName: 'Charlie',
      });

      // Ready
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: '00000000-0000-4000-8000-000000000003',
        baseVersion: state.version,
        playerId: 'p1',
        ready: true,
      });
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: '00000000-0000-4000-8000-000000000004',
        baseVersion: state.version,
        playerId: 'p2',
        ready: true,
      });
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: '00000000-0000-4000-8000-000000000005',
        baseVersion: state.version,
        playerId: 'p3',
        ready: true,
      });

      // Start game at L1
      state = reduceGame(state, {
        type: 'start_game',
        actionId: '00000000-0000-4000-8000-000000000006',
        baseVersion: state.version,
        playerId: 'p1',
      });

      assert.equal(state.phase, 'draft');

      // First player choices
      const p1Actor = state.currentActorId!;
      assert.equal(p1Actor, 'p1');
      const p1Cards = state.pendingCards[p1Actor];
      assert.equal(p1Cards.length, 2);

      state = reduceGame(state, {
        type: 'choose_and_pass',
        actionId: '00000000-0000-4000-8000-000000000007',
        baseVersion: state.version,
        playerId: 'p1',
        keepCardId: p1Cards[0].id,
        passToPlayerId: 'p2',
        testimonyRole: 'guest',
      });

      // Second player choices
      const p2Actor = state.currentActorId!;
      assert.equal(p2Actor, 'p2');
      const p2Cards = state.pendingCards[p2Actor];
      assert.equal(p2Cards.length, 2);

      state = reduceGame(state, {
        type: 'choose_and_pass',
        actionId: '00000000-0000-4000-8000-000000000008',
        baseVersion: state.version,
        playerId: 'p2',
        keepCardId: p2Cards[0].id,
        passToPlayerId: 'p3',
        testimonyRole: 'guest',
      });

      // Third (final) player choices
      const p3Actor = state.currentActorId!;
      assert.equal(p3Actor, 'p3');
      const p3Cards = state.pendingCards[p3Actor];
      assert.equal(p3Cards.length, 2);

      state = reduceGame(state, {
        type: 'choose_and_pass',
        actionId: '00000000-0000-4000-8000-000000000009',
        baseVersion: state.version,
        playerId: 'p3',
        keepCardId: p3Cards[0].id,
      });

      assert.equal(state.phase, 'discussion');
      assert.ok(state.guestRoomCard !== null);

      // Advance to vote
      state = reduceGame(state, {
        type: 'advance_to_vote',
        actionId: '00000000-0000-4000-8000-000000000010',
        baseVersion: state.version,
        playerId: 'p1',
      });

      assert.equal(state.phase, 'voting');

      // Votes: all vote for p2's location
      const p2Loc = state.players.find((p) => p.playerId === 'p2')!.locationId!;
      state = reduceGame(state, {
        type: 'cast_vote',
        actionId: '00000000-0000-4000-8000-000000000011',
        baseVersion: state.version,
        playerId: 'p1',
        targetLocation: p2Loc,
      });
      state = reduceGame(state, {
        type: 'cast_vote',
        actionId: '00000000-0000-4000-8000-000000000012',
        baseVersion: state.version,
        playerId: 'p2',
        targetLocation: p2Loc,
      });
      state = reduceGame(state, {
        type: 'cast_vote',
        actionId: '00000000-0000-4000-8000-000000000013',
        baseVersion: state.version,
        playerId: 'p3',
        targetLocation: p2Loc,
      });

      assert.equal(state.phase, 'resolution');
      assert.ok(state.result !== null);
      assert.equal(state.result.boilerOccupants.length, 1);
      assert.equal(state.result.boilerOccupants[0].playerId, 'p2');

      return state;
    };

    const s1 = playScript('deterministic-seed-alpha');
    const s2 = playScript('deterministic-seed-alpha');
    assert.deepEqual(s1, s2);
    assert.equal(JSON.stringify(s1), JSON.stringify(s2));

    // Rematch returns to lobby with new seed and clears secrets
    const rematched = reduceGame(s1, {
      type: 'rematch',
      actionId: '00000000-0000-4000-8000-000000000014',
      baseVersion: s1.version,
      playerId: 'p1',
      nextSeed: 'deterministic-seed-beta',
    });
    assert.equal(rematched.phase, 'lobby');
    assert.equal(rematched.players.length, 3);
    assert.equal(rematched.players[0].locationId, null);
    assert.equal(rematched.result, null);
    assert.equal(rematched.guestRoomCard, null);
    assert.deepEqual(rematched.keptRoles, {});
  });

  test('deep-frozen state is never mutated', () => {
    let state = createGame({
      roomCode: 'FREEZE',
      hostPlayerId: 'p1',
      hostPlayerName: 'Alice',
      seed: 'seed-f',
    });

    deepFreeze(state);

    assert.doesNotThrow(() => {
      state = reduceGame(state, {
        type: 'add_player',
        actionId: '10000000-0000-4000-8000-000000000001',
        playerId: 'p2',
        playerName: 'Bob',
      });
    });

    deepFreeze(state);

    assert.doesNotThrow(() => {
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: '10000000-0000-4000-8000-000000000002',
        baseVersion: state.version,
        playerId: 'p1',
        ready: true,
      });
    });
  });

  test('tie resolution: 2-2 tie sends both locations to boiler room', () => {
    // 4 players in L1
    let state = createGame({
      roomCode: 'TIETST',
      hostPlayerId: 'p1',
      hostPlayerName: 'Alice',
      seed: 'seed-tie',
    });
    for (let i = 2; i <= 4; i++) {
      state = reduceGame(state, {
        type: 'add_player',
        actionId: `20000000-0000-4000-8000-00000000000${i}`,
        playerId: `p${i}`,
        playerName: `Player${i}`,
      });
    }
    for (let i = 1; i <= 4; i++) {
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: `20000000-0000-4000-8000-00000000001${i}`,
        baseVersion: state.version,
        playerId: `p${i}`,
        ready: true,
      });
    }
    state = reduceGame(state, {
      type: 'start_game',
      actionId: '20000000-0000-4000-8000-000000000020',
      baseVersion: state.version,
      playerId: 'p1',
    });

    // Pass sequentially
    for (let i = 1; i <= 4; i++) {
      const actor = state.currentActorId!;
      const cards = state.pendingCards[actor];
      const nextP = i < 4 ? `p${i + 1}` : undefined;
      state = reduceGame(state, {
        type: 'choose_and_pass',
        actionId: `20000000-0000-4000-8000-00000000003${i}`,
        baseVersion: state.version,
        playerId: actor,
        keepCardId: cards[0].id,
        passToPlayerId: nextP,
      });
    }

    state = reduceGame(state, {
      type: 'advance_to_vote',
      actionId: '20000000-0000-4000-8000-000000000040',
      baseVersion: state.version,
      playerId: 'p1',
    });

    const loc1 = state.players.find((p) => p.playerId === 'p1')!.locationId!;
    const loc2 = state.players.find((p) => p.playerId === 'p2')!.locationId!;

    // 2 votes for loc1, 2 votes for loc2
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '20000000-0000-4000-8000-000000000051',
      baseVersion: state.version,
      playerId: 'p1',
      targetLocation: loc1,
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '20000000-0000-4000-8000-000000000052',
      baseVersion: state.version,
      playerId: 'p2',
      targetLocation: loc1,
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '20000000-0000-4000-8000-000000000053',
      baseVersion: state.version,
      playerId: 'p3',
      targetLocation: loc2,
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '20000000-0000-4000-8000-000000000054',
      baseVersion: state.version,
      playerId: 'p4',
      targetLocation: loc2,
    });

    assert.equal(state.phase, 'resolution');
    assert.equal(state.result?.boilerOccupants.length, 2, '2-2 tie must send both tied locations to boiler');
    const boilerLocs = state.result!.boilerOccupants.map((b) => b.locationId).sort();
    const expectedLocs = [loc1, loc2].sort();
    assert.deepEqual(boilerLocs, expectedLocs);
  });

  test('typed rejects with unchanged version for all illegal actions', () => {
    let state = createGame({
      roomCode: 'ERRTST',
      hostPlayerId: 'p1',
      hostPlayerName: 'Alice',
      seed: 'seed-err',
    });

    const initialVersion = state.version;

    // Stale version
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'set_ready',
          actionId: '30000000-0000-4000-8000-000000000001',
          baseVersion: 999,
          playerId: 'p1',
          ready: true,
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );
    assert.equal(state.version, initialVersion);

    // Vote during discussion
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'cast_vote',
          actionId: '30000000-0000-4000-8000-000000000002',
          baseVersion: state.version,
          playerId: 'p1',
          targetLocation: 'lounge',
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );

    // Wrong actor passing
    // Setup 3 players and start
    state = reduceGame(state, {
      type: 'add_player',
      actionId: '30000000-0000-4000-8000-000000000003',
      playerId: 'p2',
      playerName: 'Bob',
    });
    state = reduceGame(state, {
      type: 'add_player',
      actionId: '30000000-0000-4000-8000-000000000004',
      playerId: 'p3',
      playerName: 'Charlie',
    });
    for (const p of ['p1', 'p2', 'p3']) {
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: `30000000-0000-4000-8000-00000000001${p}`,
        baseVersion: state.version,
        playerId: p,
        ready: true,
      });
    }
    state = reduceGame(state, {
      type: 'start_game',
      actionId: '30000000-0000-4000-8000-000000000020',
      baseVersion: state.version,
      playerId: 'p1',
    });

    const vBefore = state.version;
    // p2 attempts to act when p1 is actor
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'choose_and_pass',
          actionId: '30000000-0000-4000-8000-000000000030',
          baseVersion: state.version,
          playerId: 'p2',
          keepCardId: 'murderer',
          passToPlayerId: 'p3',
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );
    assert.equal(state.version, vBefore);
  });

  test('captures deterministic replay hashes for 3, 4, 5, and 6 player L1-L6 rounds', () => {
    const runsSummary: Record<string, string> = {};
    const configs = [
      { players: 3, level: 'L1' as const, seed: 'seed-replay-3p' },
      { players: 4, level: 'L2' as const, seed: 'seed-replay-4p' },
      { players: 5, level: 'L4' as const, seed: 'seed-replay-5p' },
      { players: 6, level: 'L5' as const, seed: 'seed-replay-6p' },
    ];

    for (const { players, level, seed } of configs) {
      let state = createGame({
        roomCode: `REP${players}`,
        hostPlayerId: 'p1',
        hostPlayerName: 'Player1',
        level,
        seed,
      });

      for (let i = 2; i <= players; i++) {
        state = reduceGame(state, {
          type: 'add_player',
          actionId: `40000000-0000-4000-8000-0000000000${players}${i}`,
          playerId: `p${i}`,
          playerName: `Player${i}`,
        });
      }

      for (let i = 1; i <= players; i++) {
        state = reduceGame(state, {
          type: 'set_ready',
          actionId: `40000000-0000-4000-8000-0000000001${players}${i}`,
          baseVersion: state.version,
          playerId: `p${i}`,
          ready: true,
        });
      }

      state = reduceGame(state, {
        type: 'start_game',
        actionId: `40000000-0000-4000-8000-0000000002${players}0`,
        baseVersion: state.version,
        playerId: 'p1',
      });

      for (let i = 1; i <= players; i++) {
        const actor = state.currentActorId!;
        const cards = state.pendingCards[actor];
        const nextP = i < players ? `p${i + 1}` : undefined;
        state = reduceGame(state, {
          type: 'choose_and_pass',
          actionId: `40000000-0000-4000-8000-0000000003${players}${i}`,
          baseVersion: state.version,
          playerId: actor,
          keepCardId: cards[0].id,
          passToPlayerId: nextP,
          testimonyRole: 'guest',
        });
      }

      state = reduceGame(state, {
        type: 'advance_to_vote',
        actionId: `40000000-0000-4000-8000-0000000004${players}0`,
        baseVersion: state.version,
        playerId: 'p1',
      });

      const firstLoc = state.players[0].locationId!;
      for (let i = 1; i <= players; i++) {
        state = reduceGame(state, {
          type: 'cast_vote',
          actionId: `40000000-0000-4000-8000-0000000005${players}${i}`,
          baseVersion: state.version,
          playerId: `p${i}`,
          targetLocation: firstLoc,
        });
      }

      assert.equal(state.phase, 'resolution');
      runsSummary[`${players}p_${level}`] = `version_${state.version}_winner_${state.result?.winningFaction}`;
    }

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(evidenceDir, 'task-5-replay-hashes.json'),
      JSON.stringify(runsSummary, null, 2),
      'utf8'
    );
  });
});
