import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  FACTIONS,
  PLAYER_LOCATIONS,
  SPECIAL_LOCATIONS,
  VALID_LEVELS_BY_PLAYERS,
  isValidLevelForPlayerCount,
  createSetup,
  RulesError,
  type GameLevel,
} from '../../src/shared/rules.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('rules catalog and setup vectors', () => {
  test('constants and labels are well-defined in zh-Hant', () => {
    assert.equal(ROLES.murderer.label, '兇手');
    assert.equal(ROLES.accomplice.label, '共犯');
    assert.equal(ROLES.bomber.label, '炸彈魔');
    assert.equal(ROLES.lawyer.label, '律師');
    assert.equal(ROLES.rich_merchant.label, '富豪');
    assert.equal(ROLES.detective.label, '偵探');
    assert.equal(ROLES.butler.label, '管家');
    assert.equal(ROLES.guest.label, '房客');

    assert.equal(PLAYER_LOCATIONS.lounge.label, '交誼廳');
    assert.equal(PLAYER_LOCATIONS.gallery.label, '畫廊');
    assert.equal(PLAYER_LOCATIONS.billiard_room.label, '撞球室');
    assert.equal(PLAYER_LOCATIONS.study.label, '書房');
    assert.equal(PLAYER_LOCATIONS.entrance_hall.label, '玄關');
    assert.equal(PLAYER_LOCATIONS.dining_room.label, '餐廳');

    assert.equal(SPECIAL_LOCATIONS.guest_room.label, '客房');
    assert.equal(SPECIAL_LOCATIONS.boiler_room.label, '鍋爐室');
  });

  test('valid levels per player count match frozen matrix', () => {
    assert.deepEqual(VALID_LEVELS_BY_PLAYERS[3], ['L1', 'L2', 'L4']);
    assert.deepEqual(VALID_LEVELS_BY_PLAYERS[4], ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']);
    assert.deepEqual(VALID_LEVELS_BY_PLAYERS[5], ['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']);
    assert.deepEqual(VALID_LEVELS_BY_PLAYERS[6], ['L3', 'L5', 'L6', 'L7', 'L8']);

    assert.equal(isValidLevelForPlayerCount(3, 'L3'), false);
    assert.equal(isValidLevelForPlayerCount(5, 'L1'), false);
    assert.equal(isValidLevelForPlayerCount(6, 'L1'), false);
    assert.equal(isValidLevelForPlayerCount(2, 'L1'), false);
    assert.equal(isValidLevelForPlayerCount(7, 'L3'), false);
  });

  test('table tests for every valid (level, playerCount)', () => {
    const validPairs: { level: GameLevel; players: number }[] = [];
    for (let p = 3; p <= 6; p++) {
      for (const level of VALID_LEVELS_BY_PLAYERS[p]) {
        validPairs.push({ level, players: p });
      }
    }

    const vectorsSummary: Record<string, unknown> = {};

    for (const { level, players } of validPairs) {
      const playerIds = Array.from({ length: players }, (_, i) => `player_${i + 1}`);
      const setup = createSetup(level, playerIds, 'test-seed-12345');

      assert.equal(setup.playableCards.length, players + 1, `${level} ${players}p must have players+1 cards`);
      assert.equal(setup.playerLocations.length, players);

      const assignedLocs = new Set(setup.playerLocations.map((pl) => pl.locationId));
      assert.equal(assignedLocs.size, players, 'All player locations must be unique');

      if (level === 'L7') {
        assert.equal(setup.setAsideCards.length, 2);
        assert.equal(setup.removedCards.length, 0);
        assert.ok(setup.playableCards.some((c) => c.role === 'murderer'), 'L7 must keep Murderer in playableCards');
        assert.ok(!setup.setAsideCards.some((c) => c.role === 'murderer'), 'L7 must never set aside Murderer');
      } else if (level === 'L8') {
        assert.equal(setup.setAsideCards.length, 2);
        assert.equal(setup.removedCards.length, 2);
        assert.ok(setup.playableCards.some((c) => c.role === 'murderer'), 'L8 must keep Murderer in playableCards');
        assert.ok(!setup.setAsideCards.some((c) => c.role === 'murderer'), 'L8 must never set aside Murderer');
        assert.ok(!setup.removedCards.some((c) => c.role === 'murderer'), 'L8 must never remove Murderer');
      } else {
        assert.equal(setup.setAsideCards.length, 0);
        assert.equal(setup.removedCards.length, 0);
        assert.ok(setup.playableCards.some((c) => c.role === 'murderer'));
      }

      vectorsSummary[`${level}_${players}p`] = {
        level,
        players,
        cardRoles: setup.playableCards.map((c) => c.role),
        locations: setup.playerLocations.map((pl) => pl.locationId),
        setAside: setup.setAsideCards.map((c) => c.role),
        removed: setup.removedCards.map((c) => c.role),
      };
    }

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(evidenceDir, 'task-2-setup-vectors.json'),
      JSON.stringify(vectorsSummary, null, 2),
      'utf8'
    );
  });

  test('deterministic seed behavior: same seed is deep-equal, different seed changes assignment', () => {
    const players = ['p1', 'p2', 'p3', 'p4'];
    const s1 = createSetup('L1', players, 'fixed-seed-A');
    const s2 = createSetup('L1', players, 'fixed-seed-A');
    const s3 = createSetup('L1', players, 'fixed-seed-B');

    assert.deepEqual(s1, s2);
    const locationsChanged = s1.playerLocations.some((pl, idx) => pl.locationId !== s3.playerLocations[idx].locationId);
    const cardsChanged = s1.playableCards.some((c, idx) => c.id !== s3.playableCards[idx].id);
    assert.ok(locationsChanged || cardsChanged, 'Different seed must produce different assignment');
  });

  test('rejects invalid combinations with typed RulesError INVALID_SETUP', () => {
    const p3 = ['p1', 'p2', 'p3'];
    const p5 = ['p1', 'p2', 'p3', 'p4', 'p5'];

    assert.throws(
      () => createSetup('L3', p3, 'seed'),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_SETUP'
    );
    assert.throws(
      () => createSetup('L1', p5, 'seed'),
      (err: unknown) => err instanceof RulesError && err.code === 'INVALID_SETUP'
    );
  });

  test('100 fixed seeds for L7 and L8 never set aside or remove Murderer', () => {
    const players = ['p1', 'p2', 'p3', 'p4'];
    for (let i = 0; i < 100; i++) {
      const seed = `stress-seed-${i}`;
      const l7 = createSetup('L7', players, seed);
      assert.ok(!l7.setAsideCards.some((c) => c.role === 'murderer'), `L7 seed ${seed} set aside murderer`);
      assert.ok(l7.playableCards.some((c) => c.role === 'murderer'), `L7 seed ${seed} missing murderer in deck`);

      const l8 = createSetup('L8', players, seed);
      assert.ok(!l8.setAsideCards.some((c) => c.role === 'murderer'), `L8 seed ${seed} set aside murderer`);
      assert.ok(!l8.removedCards.some((c) => c.role === 'murderer'), `L8 seed ${seed} removed murderer`);
      assert.ok(l8.playableCards.some((c) => c.role === 'murderer'), `L8 seed ${seed} missing murderer in deck`);
    }
  });
});
