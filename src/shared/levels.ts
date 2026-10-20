import {createSetup, ROLES, type GameLevel} from './rules.ts';

export const LEVEL_SUMMARIES: Record<GameLevel, string> = {
  L1: '兇手與房客・基礎推理',
  L2: '兇手、共犯與房客',
  L3: '兇手、共犯、律師與房客',
  L4: '兇手、炸彈魔與房客',
  L5: '兇手、炸彈魔、富豪與房客',
  L6: '兇手、炸彈魔、偵探與房客',
  L7: '七大特殊角色・隨機扣置 2 張',
  L8: '七大特殊角色・扣置 2 張及移除 2 張',
};

export function getLevelPreview(level: GameLevel, playerCount: number) {
  const setup = createSetup(level, Array.from({length:playerCount}, (_, index) => `preview-${index}`), 'public-level-preview');
  const pool = [...setup.playableCards, ...setup.setAsideCards, ...setup.removedCards];
  return {
    poolCount: pool.length,
    deckCount: setup.playableCards.length,
    setAsideCount: setup.setAsideCards.length,
    removedCount: setup.removedCards.length,
    roles: Object.values(ROLES).flatMap(role => {
      const count = pool.filter(card => card.role === role.id).length;
      return count ? [{roleId:role.id, count}] : [];
    }),
  };
}
