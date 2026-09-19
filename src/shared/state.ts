import type {
  Card,
  FactionId,
  GameLevel,
  PlayerLocationId,
  RoleId,
} from './rules.ts';

export type GamePhase =
  | 'lobby'
  | 'draft'
  | 'discussion'
  | 'voting'
  | 'resolution'
  | 'game_over';

export interface PlayerRecord {
  playerId: string;
  playerName: string;
  connected: boolean;
  ready: boolean;
  locationId: PlayerLocationId | null;
  isHost: boolean;
}

export interface TestimonyEntry {
  fromPlayerId: string;
  toPlayerId: string | null;
  testimonyRole?: RoleId;
}

export interface BallotEntry {
  voterId: string;
  targetLocation: PlayerLocationId;
  isVoided: boolean;
  weight: number;
}

export interface BoilerOccupant {
  locationId: PlayerLocationId;
  playerId: string;
  role: RoleId;
}

export interface GameResult {
  assignedRoles: Array<{
    playerId: string;
    locationId: PlayerLocationId;
    role: RoleId;
    cardId: string;
  }>;
  guestRoomCard: Card | null;
  ballots: BallotEntry[];
  boilerOccupants: BoilerOccupant[];
  winningFaction: FactionId;
  winningPlayerIds: string[];
  reason: string;
}

/**
 * Authoritative Canonical Game State.
 * This object is NEVER sent over the wire directly or logged in full.
 */
export interface CanonicalGameState {
  roomCode: string;
  version: number;
  phase: GamePhase;
  level: GameLevel;
  hostPlayerId: string;
  seed: string;
  players: PlayerRecord[];

  // Deck & hidden zone allocations
  playableCards: Card[];
  setAsideCards: Card[];
  removedCards: Card[];

  // Draft phase state
  currentActorId: string | null;
  servedPlayerIds: string[];
  pendingCards: Record<string, Card[]>; // playerId -> 2 candidate cards
  keptRoles: Record<string, Card>; // playerId -> kept card
  guestRoomCard: Card | null;
  testimonyTrail: TestimonyEntry[];

  // Discussion & abilities
  butlerPeeked: boolean;
  detectiveUsed: boolean;
  detectiveTargetLocation: PlayerLocationId | null;

  // Voting & resolution
  votes: Record<string, PlayerLocationId>;
  lawyerTargetLocation: PlayerLocationId | null;
  result: GameResult | null;
}

/**
 * Player Projection.
 * Safe viewer-specific projection sent to individual browser client.
 */
export interface PlayerProjection {
  roomCode: string;
  version: number;
  phase: GamePhase;
  level: GameLevel;
  viewerId: string;
  isHost: boolean;
  players: Array<{
    playerId: string;
    playerName: string;
    connected: boolean;
    ready: boolean;
    locationId: PlayerLocationId | null;
    isHost: boolean;
    hasVoted?: boolean;
  }>;
  publicRoleRoster: RoleId[];
  currentActorId: string | null;
  servedPlayerIds: string[];
  testimonyTrail: TestimonyEntry[];

  // Viewer's private view
  ownCards?: Card[];
  ownRole?: Card;
  ownBallot?: PlayerLocationId;
  butlerPeek?: Card[];
  detectiveSentLocation?: PlayerLocationId | null;

  // Only populated in resolution and game_over
  result?: GameResult;
}
