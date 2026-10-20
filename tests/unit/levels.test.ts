import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSetup, VALID_LEVELS_BY_PLAYERS} from '../../src/shared/rules.ts';
import {getLevelPreview, LEVEL_SUMMARIES} from '../../src/shared/levels.ts';

test('public level previews match the complete rule pool without disclosing hidden assignments', () => {
  for (const [count, levels] of Object.entries(VALID_LEVELS_BY_PLAYERS)) {
    const playerIds = Array.from({length:Number(count)}, (_, index) => `player-${index}`);
    for (const level of levels) {
      const preview = getLevelPreview(level, Number(count));
      assert.ok(LEVEL_SUMMARIES[level].length > 4);
      for (const seed of ['first', 'different']) {
        const setup = createSetup(level, playerIds, seed);
        const cards = [...setup.playableCards, ...setup.setAsideCards, ...setup.removedCards];
        assert.equal(preview.deckCount, setup.playableCards.length);
        assert.equal(preview.setAsideCount, setup.setAsideCards.length);
        assert.equal(preview.removedCount, setup.removedCards.length);
        assert.equal(preview.poolCount, cards.length);
        for (const entry of preview.roles) assert.equal(entry.count, cards.filter(card => card.role === entry.roleId).length);
        assert.equal(preview.roles.reduce((total, entry) => total + entry.count, 0), cards.length);
      }
      assert.equal('playerLocations' in preview, false);
      assert.equal('setAsideCards' in preview, false);
      assert.equal('removedCards' in preview, false);
    }
  }
  assert.equal(getLevelPreview('L7', 4).roles.some(entry => entry.roleId === 'guest'), false);
  assert.equal(getLevelPreview('L8', 4).roles.find(entry => entry.roleId === 'guest')?.count, 2);
  assert.throws(() => getLevelPreview('L8', 3));
});
