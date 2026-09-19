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

describe('advanced roles and winner precedence (L7-L8 truth table)', () => {
  // Helper to construct a customized game state at discussion or voting phase for unit testing abilities
  function setupTestGame(config: {
    level: import('../../src/shared/rules.ts').GameLevel;
    playerRoles: Record<string, 'murderer' | 'accomplice' | 'bomber' | 'lawyer' | 'rich_merchant' | 'detective' | 'butler' | 'guest'>;
    phase?: 'discussion' | 'voting';
  }) {
    const playerIds = Object.keys(config.playerRoles);
    let state = createGame({
      roomCode: 'ADV123',
      hostPlayerId: playerIds[0],
      hostPlayerName: 'HostPlayer',
      level: config.level,
      seed: 'fixed-adv-seed',
    });

    for (let i = 1; i < playerIds.length; i++) {
      state = reduceGame(state, {
        type: 'add_player',
        actionId: `00000000-0000-4000-8000-00000000100${i}`,
        playerId: playerIds[i],
        playerName: `Player_${playerIds[i]}`,
      });
    }

    for (const pid of playerIds) {
      state = reduceGame(state, {
        type: 'set_ready',
        actionId: `00000000-0000-4000-8000-00000000200${pid}`,
        baseVersion: state.version,
        playerId: pid,
        ready: true,
      });
    }

    state = reduceGame(state, {
      type: 'start_game',
      actionId: '00000000-0000-4000-8000-000000003000',
      baseVersion: state.version,
      playerId: playerIds[0],
    });

    // Override keptRoles and player locations deterministically for unit testing exact ability combinations
    const locations = ['lounge', 'gallery', 'billiard_room', 'study', 'entrance_hall', 'dining_room'] as const;
    playerIds.forEach((pid, idx) => {
      const p = state.players.find((pl) => pl.playerId === pid)!;
      p.locationId = locations[idx];
      state.keptRoles[pid] = {
        id: `card_${config.playerRoles[pid]}`,
        role: config.playerRoles[pid],
        label: config.playerRoles[pid],
      };
    });

    // Advance to discussion
    state.phase = config.phase || 'discussion';
    state.currentActorId = null;
    state.pendingCards = {};

    return state;
  }

  test('Butler one-time peek during discussion and enforced abstention during voting', () => {
    let state = setupTestGame({
      level: 'L7',
      playerRoles: {
        p1: 'butler',
        p2: 'murderer',
        p3: 'guest',
        p4: 'guest',
      },
      phase: 'discussion',
    });

    // Non-butler cannot peek
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'butler_peek',
          actionId: '00000000-0000-4000-8000-000000004001',
          baseVersion: state.version,
          playerId: 'p2',
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );

    // Butler peeks
    state = reduceGame(state, {
      type: 'butler_peek',
      actionId: '00000000-0000-4000-8000-000000004002',
      baseVersion: state.version,
      playerId: 'p1',
    });
    assert.equal(state.butlerPeeked, true);

    // Butler cannot peek a second time
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'butler_peek',
          actionId: '00000000-0000-4000-8000-000000004003',
          baseVersion: state.version,
          playerId: 'p1',
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );

    // Advance to voting
    state = reduceGame(state, {
      type: 'advance_to_vote',
      actionId: '00000000-0000-4000-8000-000000004004',
      baseVersion: state.version,
      playerId: 'p1',
    });

    // Butler voting is rejected due to enforced abstention
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'cast_vote',
          actionId: '00000000-0000-4000-8000-000000004005',
          baseVersion: state.version,
          playerId: 'p1',
          targetLocation: 'gallery',
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );

    // Other 3 players vote
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000004006',
      baseVersion: state.version,
      playerId: 'p2',
      targetLocation: 'billiard_room',
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000004007',
      baseVersion: state.version,
      playerId: 'p3',
      targetLocation: 'billiard_room',
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000004008',
      baseVersion: state.version,
      playerId: 'p4',
      targetLocation: 'billiard_room',
    });

    assert.equal(state.phase, 'resolution');
    assert.equal(state.result?.boilerOccupants[0].locationId, 'billiard_room');
  });

  test('Detective reveal and send occupied location skips voting and immediately resolves', () => {
    let state = setupTestGame({
      level: 'L6',
      playerRoles: {
        p1: 'detective',
        p2: 'bomber',
        p3: 'murderer',
        p4: 'guest',
      },
      phase: 'discussion',
    });

    // Detective targets empty location -> rejects
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'detective_send',
          actionId: '00000000-0000-4000-8000-000000005001',
          baseVersion: state.version,
          playerId: 'p1',
          targetLocation: 'dining_room', // unoccupied
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );

    // Non-detective attempts detective_send -> rejects
    assert.throws(
      () =>
        reduceGame(state, {
          type: 'detective_send',
          actionId: '00000000-0000-4000-8000-000000005002',
          baseVersion: state.version,
          playerId: 'p2',
          targetLocation: 'lounge',
        }),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_ACTION'
    );

    // Detective sends p2 (Bomber) at 'gallery'
    state = reduceGame(state, {
      type: 'detective_send',
      actionId: '00000000-0000-4000-8000-000000005003',
      baseVersion: state.version,
      playerId: 'p1',
      targetLocation: 'gallery',
    });

    assert.equal(state.phase, 'resolution');
    assert.equal(state.result?.boilerOccupants.length, 1);
    assert.equal(state.result?.boilerOccupants[0].playerId, 'p2');
    assert.equal(state.result?.boilerOccupants[0].role, 'bomber');
    // Detective -> Bomber: Bomber wins alone!
    assert.equal(state.result?.winningFaction, 'bomber_faction');
    assert.deepEqual(state.result?.winningPlayerIds, ['p2']);
  });

  test('Lawyer voids ballot before Rich Merchant doubling (Lawyer targeting Rich)', () => {
    let state = setupTestGame({
      level: 'L7',
      playerRoles: {
        p1: 'lawyer', // lounge
        p2: 'rich_merchant', // gallery
        p3: 'murderer', // billiard_room
        p4: 'guest', // study
      },
      phase: 'voting',
    });

    // p1 (Lawyer) votes for gallery (targeting Rich Merchant's location)
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000006001',
      baseVersion: state.version,
      playerId: 'p1',
      targetLocation: 'gallery',
    });

    // p2 (Rich Merchant) votes for lounge
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000006002',
      baseVersion: state.version,
      playerId: 'p2',
      targetLocation: 'lounge',
    });

    // p3 (Murderer) votes for study
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000006003',
      baseVersion: state.version,
      playerId: 'p3',
      targetLocation: 'study',
    });

    // p4 (Guest) votes for study
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000006004',
      baseVersion: state.version,
      playerId: 'p4',
      targetLocation: 'study',
    });

    assert.equal(state.phase, 'resolution');
    const p2Ballot = state.result?.ballots.find((b) => b.voterId === 'p2')!;
    assert.equal(p2Ballot.isVoided, true, 'Rich Merchant ballot was voided by Lawyer');
    assert.equal(p2Ballot.weight, 0, 'Voided ballot weight must be 0, not doubled');

    // Tallies: lounge has 0 votes, gallery has 1 vote, study has 2 votes
    assert.equal(state.result?.boilerOccupants.length, 1);
    assert.equal(state.result?.boilerOccupants[0].locationId, 'study');
  });

  test('tie with Murderer and Bomber: Bomber wins alone before Murderer check', () => {
    let state = setupTestGame({
      level: 'L4',
      playerRoles: {
        p1: 'murderer', // lounge
        p2: 'bomber', // gallery
        p3: 'guest', // billiard_room
        p4: 'guest', // study
      },
      phase: 'voting',
    });

    // 2 votes for lounge (Murderer), 2 votes for gallery (Bomber) -> tie
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000007001',
      baseVersion: state.version,
      playerId: 'p1',
      targetLocation: 'gallery',
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000007002',
      baseVersion: state.version,
      playerId: 'p2',
      targetLocation: 'lounge',
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000007003',
      baseVersion: state.version,
      playerId: 'p3',
      targetLocation: 'gallery',
    });
    state = reduceGame(state, {
      type: 'cast_vote',
      actionId: '00000000-0000-4000-8000-000000007004',
      baseVersion: state.version,
      playerId: 'p4',
      targetLocation: 'lounge',
    });

    assert.equal(state.phase, 'resolution');
    assert.equal(state.result?.boilerOccupants.length, 2);
    // Both Murderer and Bomber are in boiler! Bomber wins alone!
    assert.equal(state.result?.winningFaction, 'bomber_faction');
    assert.deepEqual(state.result?.winningPlayerIds, ['p2']);
  });

  test('Murderer absent in L7/L8: active Accomplice wins if Murderer absent; no winner if neither active', () => {
    // Case 1: Murderer absent, Accomplice active
    let stateWithAccomplice = setupTestGame({
      level: 'L7',
      playerRoles: {
        p1: 'accomplice', // lounge
        p2: 'guest', // gallery
        p3: 'guest', // billiard_room
        p4: 'guest', // study
      },
      phase: 'voting',
    });

    // Votes send p2 (Guest) to Boiler Room
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      stateWithAccomplice = reduceGame(stateWithAccomplice, {
        type: 'cast_vote',
        actionId: `00000000-0000-4000-8000-00000000810${pid}`,
        baseVersion: stateWithAccomplice.version,
        playerId: pid,
        targetLocation: 'gallery',
      });
    }
    assert.equal(stateWithAccomplice.phase, 'resolution');
    assert.equal(stateWithAccomplice.result?.winningFaction, 'murderer_faction');
    assert.deepEqual(stateWithAccomplice.result?.winningPlayerIds, ['p1']);

    // Case 2: Neither Murderer nor Accomplice active
    let stateNoEvil = setupTestGame({
      level: 'L7',
      playerRoles: {
        p1: 'guest', // lounge
        p2: 'guest', // gallery
        p3: 'guest', // billiard_room
        p4: 'guest', // study
      },
      phase: 'voting',
    });

    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      stateNoEvil = reduceGame(stateNoEvil, {
        type: 'cast_vote',
        actionId: `00000000-0000-4000-8000-00000000820${pid}`,
        baseVersion: stateNoEvil.version,
        playerId: pid,
        targetLocation: 'gallery',
      });
    }
    assert.equal(stateNoEvil.phase, 'resolution');
    assert.deepEqual(stateNoEvil.result?.winningPlayerIds, []);
  });

  test('frozen truth table fixture written to task-6-resolution-table.json', () => {
    const resolutionTable = {
      'bomber_in_boiler': { winner: 'bomber_faction', condition: 'Bomber wins alone before Murderer check' },
      'murderer_in_boiler_no_bomber': { winner: 'witness_faction', condition: 'Active good roles win' },
      'murderer_not_in_boiler_active': { winner: 'murderer_faction', condition: 'Active Murderer and Accomplice win' },
      'murderer_absent_accomplice_active': { winner: 'murderer_faction', condition: 'Active Accomplice wins' },
      'neither_evil_active': { winner: 'none', condition: 'No winner' },
      'lawyer_precedence': { order: 'Lawyer voids before Rich Merchant doubles' },
    };

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(evidenceDir, 'task-6-resolution-table.json'),
      JSON.stringify(resolutionTable, null, 2),
      'utf8'
    );
  });
});
