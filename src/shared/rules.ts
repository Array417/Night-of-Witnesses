export type RoleId =
  | 'murderer'
  | 'accomplice'
  | 'bomber'
  | 'lawyer'
  | 'rich_merchant'
  | 'detective'
  | 'butler'
  | 'guest';

export type FactionId = 'murderer_faction' | 'bomber_faction' | 'witness_faction';

export type PlayerLocationId =
  | 'lounge'
  | 'gallery'
  | 'billiard_room'
  | 'study'
  | 'entrance_hall'
  | 'dining_room';

export type SpecialLocationId = 'guest_room' | 'boiler_room';

export type LocationId = PlayerLocationId | SpecialLocationId;

export type GameLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8';

export interface RoleDef {
  id: RoleId;
  label: string;
  faction: FactionId;
}

export interface LocationDef {
  id: LocationId;
  label: string;
}

export interface Card {
  id: string;
  role: RoleId;
  label: string;
}

export interface PlayerLocationAssignment {
  playerId: string;
  locationId: PlayerLocationId;
}

export interface GameSetup {
  level: GameLevel;
  playerLocations: PlayerLocationAssignment[];
  playableCards: Card[];
  setAsideCards: Card[];
  removedCards: Card[];
  seed: string;
}

export class RulesError extends Error {
  readonly code: 'INVALID_SETUP' | 'INVALID_ACTION';
  constructor(code: 'INVALID_SETUP' | 'INVALID_ACTION', message: string) {
    super(message);
    this.name = 'RulesError';
    this.code = code;
  }
}

export const FACTIONS: Record<FactionId, { id: FactionId; label: string }> = {
  murderer_faction: { id: 'murderer_faction', label: '兇手陣營' },
  bomber_faction: { id: 'bomber_faction', label: '炸彈魔' },
  witness_faction: { id: 'witness_faction', label: '目擊者陣營' },
};

export const ROLES: Record<RoleId, RoleDef> = {
  murderer: { id: 'murderer', label: '兇手', faction: 'murderer_faction' },
  accomplice: { id: 'accomplice', label: '共犯', faction: 'murderer_faction' },
  bomber: { id: 'bomber', label: '炸彈魔', faction: 'bomber_faction' },
  lawyer: { id: 'lawyer', label: '律師', faction: 'witness_faction' },
  rich_merchant: { id: 'rich_merchant', label: '富豪', faction: 'witness_faction' },
  detective: { id: 'detective', label: '偵探', faction: 'witness_faction' },
  butler: { id: 'butler', label: '管家', faction: 'witness_faction' },
  guest: { id: 'guest', label: '房客', faction: 'witness_faction' },
};

export const PLAYER_LOCATIONS: Record<PlayerLocationId, LocationDef> = {
  lounge: { id: 'lounge', label: '交誼廳' },
  gallery: { id: 'gallery', label: '畫廊' },
  billiard_room: { id: 'billiard_room', label: '撞球室' },
  study: { id: 'study', label: '書房' },
  entrance_hall: { id: 'entrance_hall', label: '玄關' },
  dining_room: { id: 'dining_room', label: '餐廳' },
};

export const ALL_PLAYER_LOCATION_IDS: readonly PlayerLocationId[] = [
  'lounge',
  'gallery',
  'billiard_room',
  'study',
  'entrance_hall',
  'dining_room',
];

export const SPECIAL_LOCATIONS: Record<SpecialLocationId, LocationDef> = {
  guest_room: { id: 'guest_room', label: '客房' },
  boiler_room: { id: 'boiler_room', label: '鍋爐室' },
};

export const VALID_LEVELS_BY_PLAYERS: Record<number, GameLevel[]> = {
  3: ['L1', 'L2', 'L4'],
  4: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'],
  5: ['L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'],
  6: ['L3', 'L5', 'L6', 'L7', 'L8'],
};

export function isValidLevelForPlayerCount(playerCount: number, level: GameLevel): boolean {
  const allowed = VALID_LEVELS_BY_PLAYERS[playerCount];
  return allowed ? allowed.includes(level) : false;
}

/** Deterministic 32-bit PRNG (Mulberry32) */
function createPrng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function mulberry32(): number {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle */
function shuffle<T>(array: readonly T[], prng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

function makeRoleCard(role: RoleId, index: number = 0): Card {
  const id = role === 'guest' ? `guest_${index}` : role;
  return {
    id,
    role,
    label: ROLES[role].label,
  };
}

export function createSetup(
  level: GameLevel,
  players: readonly string[],
  seed: string | number
): GameSetup {
  const playerCount = players.length;
  if (playerCount < 3 || playerCount > 6) {
    throw new RulesError(
      'INVALID_SETUP',
      `Player count must be between 3 and 6, received: ${playerCount}`
    );
  }

  if (!isValidLevelForPlayerCount(playerCount, level)) {
    throw new RulesError(
      'INVALID_SETUP',
      `Level ${level} is invalid for ${playerCount} players`
    );
  }

  const seedString = String(seed);
  const prng = createPrng(seedString);

  // 1. Unique player location assignment
  const shuffledLocs = shuffle(ALL_PLAYER_LOCATION_IDS, prng);
  const playerLocations: PlayerLocationAssignment[] = players.map((playerId, i) => ({
    playerId,
    locationId: shuffledLocs[i],
  }));

  // 2. Playable cards and hidden zones based on level
  let playableCards: Card[] = [];
  let setAsideCards: Card[] = [];
  let removedCards: Card[] = [];

  const createGuestCards = (count: number, startIndex: number = 1): Card[] =>
    Array.from({ length: count }, (_, idx) => makeRoleCard('guest', startIndex + idx));

  if (level === 'L1') {
    // Murderer + playerCount Guests (deck = playerCount + 1)
    const cards: Card[] = [makeRoleCard('murderer'), ...createGuestCards(playerCount)];
    playableCards = shuffle(cards, prng);
  } else if (level === 'L2') {
    // Murderer + Accomplice + (playerCount - 1) Guests
    const cards: Card[] = [
      makeRoleCard('murderer'),
      makeRoleCard('accomplice'),
      ...createGuestCards(playerCount - 1),
    ];
    playableCards = shuffle(cards, prng);
  } else if (level === 'L3') {
    // Murderer + Accomplice + Lawyer + (playerCount - 2) Guests
    const cards: Card[] = [
      makeRoleCard('murderer'),
      makeRoleCard('accomplice'),
      makeRoleCard('lawyer'),
      ...createGuestCards(playerCount - 2),
    ];
    playableCards = shuffle(cards, prng);
  } else if (level === 'L4') {
    // Murderer + Bomber + (playerCount - 1) Guests
    const cards: Card[] = [
      makeRoleCard('murderer'),
      makeRoleCard('bomber'),
      ...createGuestCards(playerCount - 1),
    ];
    playableCards = shuffle(cards, prng);
  } else if (level === 'L5') {
    // Murderer + Bomber + Rich Merchant + (playerCount - 2) Guests
    const cards: Card[] = [
      makeRoleCard('murderer'),
      makeRoleCard('bomber'),
      makeRoleCard('rich_merchant'),
      ...createGuestCards(playerCount - 2),
    ];
    playableCards = shuffle(cards, prng);
  } else if (level === 'L6') {
    // Murderer + Bomber + Detective + (playerCount - 2) Guests
    const cards: Card[] = [
      makeRoleCard('murderer'),
      makeRoleCard('bomber'),
      makeRoleCard('detective'),
      ...createGuestCards(playerCount - 2),
    ];
    playableCards = shuffle(cards, prng);
  } else if (level === 'L7') {
    // 7 special roles + (playerCount - 4) Guests
    // Exclude Murderer, set aside 2 random non-Murderer cards, return Murderer, deck = playerCount + 1
    const murdererCard = makeRoleCard('murderer');
    const nonMurdererSpecial: Card[] = [
      makeRoleCard('accomplice'),
      makeRoleCard('bomber'),
      makeRoleCard('lawyer'),
      makeRoleCard('rich_merchant'),
      makeRoleCard('detective'),
      makeRoleCard('butler'),
    ];
    const guestCards = createGuestCards(playerCount - 4);
    const nonMurdererPool = shuffle([...nonMurdererSpecial, ...guestCards], prng);

    setAsideCards = nonMurdererPool.slice(0, 2);
    const remainingNonMurderer = nonMurdererPool.slice(2);
    playableCards = shuffle([murdererCard, ...remainingNonMurderer], prng);
  } else if (level === 'L8') {
    // 7 special roles + (playerCount - 2) Guests
    // Exclude Murderer, set aside 2 random non-Murderer cards, remove 2 random non-Murderer cards, return Murderer
    const murdererCard = makeRoleCard('murderer');
    const nonMurdererSpecial: Card[] = [
      makeRoleCard('accomplice'),
      makeRoleCard('bomber'),
      makeRoleCard('lawyer'),
      makeRoleCard('rich_merchant'),
      makeRoleCard('detective'),
      makeRoleCard('butler'),
    ];
    const guestCards = createGuestCards(playerCount - 2);
    const nonMurdererPool = shuffle([...nonMurdererSpecial, ...guestCards], prng);

    setAsideCards = nonMurdererPool.slice(0, 2);
    removedCards = nonMurdererPool.slice(2, 4);
    const remainingNonMurderer = nonMurdererPool.slice(4);
    playableCards = shuffle([murdererCard, ...remainingNonMurderer], prng);
  }

  return {
    level,
    playerLocations,
    playableCards,
    setAsideCards,
    removedCards,
    seed: seedString,
  };
}
