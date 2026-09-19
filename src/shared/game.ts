import {
  type Card,
  type GameLevel,
  type PlayerLocationId,
  type RoleId,
  RulesError,
  createSetup,
  isValidLevelForPlayerCount,
} from './rules.ts';
import type {
  BallotEntry,
  BoilerOccupant,
  CanonicalGameState,
  GameResult,
  PlayerRecord,
  TestimonyEntry,
} from './state.ts';

export type GameAction =
  | {
      type: 'add_player';
      actionId: string;
      playerId: string;
      playerName: string;
    }
  | {
      type: 'set_ready';
      actionId: string;
      baseVersion: number;
      playerId: string;
      ready: boolean;
    }
  | {
      type: 'select_level';
      actionId: string;
      baseVersion: number;
      playerId: string;
      level: GameLevel;
    }
  | {
      type: 'kick';
      actionId: string;
      baseVersion: number;
      playerId: string;
      targetPlayerId: string;
    }
  | {
      type: 'start_game';
      actionId: string;
      baseVersion: number;
      playerId: string;
      seed?: string;
    }
  | {
      type: 'choose_and_pass';
      actionId: string;
      baseVersion: number;
      playerId: string;
      keepCardId: string;
      passToPlayerId?: string;
      testimonyRole?: RoleId;
    }
  | {
      type: 'advance_to_vote';
      actionId: string;
      baseVersion: number;
      playerId: string;
    }
  | {
      type: 'butler_peek';
      actionId: string;
      baseVersion: number;
      playerId: string;
    }
  | {
      type: 'detective_send';
      actionId: string;
      baseVersion: number;
      playerId: string;
      targetLocation: PlayerLocationId;
    }
  | {
      type: 'cast_vote';
      actionId: string;
      baseVersion: number;
      playerId: string;
      targetLocation: PlayerLocationId;
    }
  | {
      type: 'rematch';
      actionId: string;
      baseVersion: number;
      playerId: string;
      nextSeed?: string;
    };

export interface CreateGameOptions {
  roomCode: string;
  hostPlayerId: string;
  hostPlayerName: string;
  level?: GameLevel;
  seed?: string;
}

export function createGame(options: CreateGameOptions): CanonicalGameState {
  const hostRecord: PlayerRecord = {
    playerId: options.hostPlayerId,
    playerName: options.hostPlayerName.trim(),
    connected: true,
    ready: false,
    locationId: null,
    isHost: true,
  };

  return {
    roomCode: options.roomCode,
    version: 0,
    phase: 'lobby',
    level: options.level || 'L1',
    hostPlayerId: options.hostPlayerId,
    seed: options.seed || 'seed-default',
    players: [hostRecord],
    playableCards: [],
    setAsideCards: [],
    removedCards: [],
    currentActorId: null,
    servedPlayerIds: [],
    pendingCards: {},
    keptRoles: {},
    guestRoomCard: null,
    testimonyTrail: [],
    butlerPeeked: false,
    detectiveUsed: false,
    detectiveTargetLocation: null,
    votes: {},
    lawyerTargetLocation: null,
    result: null,
  };
}

function cloneState(state: CanonicalGameState): CanonicalGameState {
  return structuredClone(state);
}

export function reduceGame(
  currentState: Readonly<CanonicalGameState>,
  action: GameAction
): CanonicalGameState {
  // Validate baseVersion for version-bearing actions
  if ('baseVersion' in action) {
    if (action.baseVersion !== currentState.version) {
      throw new RulesError(
        'INVALID_ACTION',
        `Stale baseVersion: action version ${action.baseVersion} does not match current state ${currentState.version}`
      );
    }
  }

  const next = cloneState(currentState);

  switch (action.type) {
    case 'add_player': {
      if (next.phase !== 'lobby') {
        throw new RulesError('INVALID_ACTION', 'Cannot join a game that has already started');
      }
      if (next.players.length >= 6) {
        throw new RulesError('INVALID_ACTION', 'Room is full (max 6 players)');
      }
      const trimmed = action.playerName.trim();
      if (!trimmed) {
        throw new RulesError('INVALID_ACTION', 'Player name cannot be empty');
      }
      if (next.players.some((p) => p.playerName.toLowerCase() === trimmed.toLowerCase())) {
        throw new RulesError('INVALID_ACTION', 'Player name is already taken in this room');
      }
      if (next.players.some((p) => p.playerId === action.playerId)) {
        throw new RulesError('INVALID_ACTION', 'Player ID already in room');
      }

      next.players.push({
        playerId: action.playerId,
        playerName: trimmed,
        connected: true,
        ready: false,
        locationId: null,
        isHost: false,
      });
      next.version += 1;
      return next;
    }

    case 'set_ready': {
      if (next.phase !== 'lobby') {
        throw new RulesError('INVALID_ACTION', 'Cannot toggle ready outside lobby');
      }
      const player = next.players.find((p) => p.playerId === action.playerId);
      if (!player) {
        throw new RulesError('INVALID_ACTION', 'Player not in room');
      }
      player.ready = action.ready;
      next.version += 1;
      return next;
    }

    case 'select_level': {
      if (next.phase !== 'lobby') {
        throw new RulesError('INVALID_ACTION', 'Cannot select level outside lobby');
      }
      if (action.playerId !== next.hostPlayerId) {
        throw new RulesError('INVALID_ACTION', 'Only the host can select level');
      }
      if (!isValidLevelForPlayerCount(next.players.length, action.level)) {
        throw new RulesError(
          'INVALID_ACTION',
          `Level ${action.level} is not valid for ${next.players.length} players`
        );
      }
      next.level = action.level;
      next.version += 1;
      return next;
    }

    case 'kick': {
      if (next.phase !== 'lobby') {
        throw new RulesError('INVALID_ACTION', 'Host can only kick players during lobby');
      }
      if (action.playerId !== next.hostPlayerId) {
        throw new RulesError('INVALID_ACTION', 'Only host can kick players');
      }
      if (action.targetPlayerId === next.hostPlayerId) {
        throw new RulesError('INVALID_ACTION', 'Host cannot kick themselves');
      }
      const targetIndex = next.players.findIndex((p) => p.playerId === action.targetPlayerId);
      if (targetIndex === -1) {
        throw new RulesError('INVALID_ACTION', 'Target player not found in room');
      }
      next.players.splice(targetIndex, 1);
      next.version += 1;
      return next;
    }

    case 'start_game': {
      if (next.phase !== 'lobby') {
        throw new RulesError('INVALID_ACTION', 'Game has already started');
      }
      if (action.playerId !== next.hostPlayerId) {
        throw new RulesError('INVALID_ACTION', 'Only the host can start the game');
      }
      if (next.players.length < 3 || next.players.length > 6) {
        throw new RulesError('INVALID_ACTION', 'Need 3 to 6 players to start');
      }
      if (!isValidLevelForPlayerCount(next.players.length, next.level)) {
        throw new RulesError(
          'INVALID_ACTION',
          `Selected level ${next.level} is not valid for ${next.players.length} players`
        );
      }
      // All players must be ready
      const allReady = next.players.every((p) => p.ready);
      if (!allReady) {
        throw new RulesError('INVALID_ACTION', 'All players must be ready before starting');
      }

      const seed = action.seed || next.seed;
      const playerIds = next.players.map((p) => p.playerId);
      const setup = createSetup(next.level, playerIds, seed);

      // Assign locations to player records
      for (const assign of setup.playerLocations) {
        const p = next.players.find((pl) => pl.playerId === assign.playerId);
        if (p) {
          p.locationId = assign.locationId;
        }
      }

      next.seed = seed;
      next.playableCards = setup.playableCards;
      next.setAsideCards = setup.setAsideCards;
      next.removedCards = setup.removedCards;

      // Draft setup: First player receives first 2 cards
      const firstPlayerId = playerIds[0];
      next.currentActorId = firstPlayerId;
      next.servedPlayerIds = [firstPlayerId];
      next.pendingCards[firstPlayerId] = [next.playableCards[0], next.playableCards[1]];
      next.phase = 'draft';
      next.version += 1;
      return next;
    }

    case 'choose_and_pass': {
      if (next.phase !== 'draft') {
        throw new RulesError('INVALID_ACTION', 'Cannot choose/pass outside draft phase');
      }
      if (action.playerId !== next.currentActorId) {
        throw new RulesError('INVALID_ACTION', 'Not your turn to choose and pass');
      }

      const currentCards = next.pendingCards[action.playerId];
      if (!currentCards || currentCards.length !== 2) {
        throw new RulesError('INVALID_ACTION', 'No pending cards to choose from');
      }

      const keptCard = currentCards.find((c) => c.id === action.keepCardId);
      if (!keptCard) {
        throw new RulesError('INVALID_ACTION', 'Selected card is not in your pending hand');
      }

      const passedCard = currentCards.find((c) => c.id !== action.keepCardId)!;
      next.keptRoles[action.playerId] = keptCard;
      delete next.pendingCards[action.playerId];

      const isFinalPlayer = next.servedPlayerIds.length === next.players.length;

      const testimony: TestimonyEntry = {
        fromPlayerId: action.playerId,
        toPlayerId: isFinalPlayer ? null : (action.passToPlayerId || null),
        testimonyRole: action.testimonyRole,
      };
      next.testimonyTrail.push(testimony);

      if (isFinalPlayer) {
        // Leftover card goes to Guest Room face-down
        next.guestRoomCard = passedCard;
        next.currentActorId = null;
        next.phase = 'discussion';
      } else {
        if (!action.passToPlayerId) {
          throw new RulesError('INVALID_ACTION', 'Must specify passToPlayerId for non-final player');
        }
        if (!next.players.some((p) => p.playerId === action.passToPlayerId)) {
          throw new RulesError('INVALID_ACTION', 'Target player not in room');
        }
        if (next.servedPlayerIds.includes(action.passToPlayerId)) {
          throw new RulesError('INVALID_ACTION', 'Target player has already received cards');
        }

        // Target draws next card from playable deck
        // Index in playableCards = servedPlayerIds.length + 1
        const nextDrawIndex = next.servedPlayerIds.length + 1;
        const drawnCard = next.playableCards[nextDrawIndex];

        next.servedPlayerIds.push(action.passToPlayerId);
        next.currentActorId = action.passToPlayerId;
        next.pendingCards[action.passToPlayerId] = [passedCard, drawnCard];
      }

      next.version += 1;
      return next;
    }

    case 'advance_to_vote': {
      if (next.phase !== 'discussion') {
        throw new RulesError('INVALID_ACTION', 'Can only advance to vote from discussion phase');
      }
      if (action.playerId !== next.hostPlayerId) {
        throw new RulesError('INVALID_ACTION', 'Only the host can advance discussion to vote');
      }
      next.phase = 'voting';
      next.version += 1;
      return next;
    }

    case 'butler_peek': {
      if (next.phase !== 'discussion') {
        throw new RulesError('INVALID_ACTION', 'Butler can only peek during discussion');
      }
      const playerRole = next.keptRoles[action.playerId];
      if (!playerRole || playerRole.role !== 'butler') {
        throw new RulesError('INVALID_ACTION', 'Only the Butler can use butler_peek');
      }
      if (next.butlerPeeked) {
        throw new RulesError('INVALID_ACTION', 'Butler has already peeked');
      }
      next.butlerPeeked = true;
      next.version += 1;
      return next;
    }

    case 'detective_send': {
      if (next.phase !== 'discussion') {
        throw new RulesError('INVALID_ACTION', 'Detective can only act during discussion');
      }
      const playerRole = next.keptRoles[action.playerId];
      if (!playerRole || playerRole.role !== 'detective') {
        throw new RulesError('INVALID_ACTION', 'Only the Detective can use detective_send');
      }
      if (next.detectiveUsed) {
        throw new RulesError('INVALID_ACTION', 'Detective has already used their ability');
      }
      const occupied = next.players.find((p) => p.locationId === action.targetLocation);
      if (!occupied) {
        throw new RulesError('INVALID_ACTION', 'Target location is not occupied by a player');
      }

      next.detectiveUsed = true;
      next.detectiveTargetLocation = action.targetLocation;

      // Detective immediately resolves the round without voting!
      resolveRound(next, action.targetLocation);
      next.version += 1;
      return next;
    }

    case 'cast_vote': {
      if (next.phase !== 'voting') {
        throw new RulesError('INVALID_ACTION', 'Cannot cast vote outside voting phase');
      }
      const player = next.players.find((p) => p.playerId === action.playerId);
      if (!player) {
        throw new RulesError('INVALID_ACTION', 'Player not in room');
      }
      if (next.votes[action.playerId]) {
        throw new RulesError('INVALID_ACTION', 'Player has already cast their vote');
      }
      // Butler who peeked abstains
      if (next.butlerPeeked && next.keptRoles[action.playerId]?.role === 'butler') {
        throw new RulesError('INVALID_ACTION', 'Butler who inspected cards must abstain from voting');
      }
      const isOccupied = next.players.some((p) => p.locationId === action.targetLocation);
      if (!isOccupied) {
        throw new RulesError('INVALID_ACTION', 'Cannot vote for unoccupied or invalid location');
      }

      next.votes[action.playerId] = action.targetLocation;

      // Check if all eligible connected voters have submitted their vote
      const eligibleVoters = next.players.filter((p) => {
        if (!p.connected) return false;
        if (next.butlerPeeked && next.keptRoles[p.playerId]?.role === 'butler') return false;
        return true;
      });

      const allVoted = eligibleVoters.every((p) => next.votes[p.playerId]);
      if (allVoted) {
        resolveRound(next);
      }

      next.version += 1;
      return next;
    }

    case 'rematch': {
      if (next.phase !== 'resolution' && next.phase !== 'game_over') {
        throw new RulesError('INVALID_ACTION', 'Rematch only allowed after game resolution');
      }
      if (action.playerId !== next.hostPlayerId) {
        throw new RulesError('INVALID_ACTION', 'Only the host can initiate rematch');
      }

      // Reset round state while keeping roster
      next.phase = 'lobby';
      next.seed = action.nextSeed || `${next.seed}-rematch-${next.version}`;
      for (const p of next.players) {
        p.ready = false;
        p.locationId = null;
      }
      next.playableCards = [];
      next.setAsideCards = [];
      next.removedCards = [];
      next.currentActorId = null;
      next.servedPlayerIds = [];
      next.pendingCards = {};
      next.keptRoles = {};
      next.guestRoomCard = null;
      next.testimonyTrail = [];
      next.butlerPeeked = false;
      next.detectiveUsed = false;
      next.detectiveTargetLocation = null;
      next.votes = {};
      next.lawyerTargetLocation = null;
      next.result = null;

      next.version += 1;
      return next;
    }

    default: {
      const _exhaustive: never = action;
      throw new RulesError('INVALID_ACTION', `Unhandled action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function resolveRound(state: CanonicalGameState, detectiveForcedLocation?: PlayerLocationId): void {
  const ballots: BallotEntry[] = [];
  const boilerOccupants: BoilerOccupant[] = [];

  const assignedRoles = state.players.map((p) => ({
    playerId: p.playerId,
    locationId: p.locationId!,
    role: state.keptRoles[p.playerId]?.role || 'guest',
    cardId: state.keptRoles[p.playerId]?.id || 'unknown',
  }));

  if (detectiveForcedLocation) {
    const occupant = assignedRoles.find((a) => a.locationId === detectiveForcedLocation)!;
    boilerOccupants.push({
      locationId: detectiveForcedLocation,
      playerId: occupant.playerId,
      role: occupant.role,
    });
  } else {
    // 1. Lawyer cancellation: check if Lawyer is active
    // "Lawyer may reveal and void the entire ballot cast by the occupant of the location the Lawyer selected"
    // In L3, L7, L8: if Lawyer selected a location, void that location occupant's ballot
    // (If not explicitly selected yet, check lawyerTargetLocation)
    const lawyerPlayer = state.players.find((p) => state.keptRoles[p.playerId]?.role === 'lawyer');
    const lawyerTargetLoc = state.lawyerTargetLocation || (lawyerPlayer ? state.votes[lawyerPlayer.playerId] : null);
    const voidedVoterId = lawyerTargetLoc
      ? state.players.find((p) => p.locationId === lawyerTargetLoc)?.playerId
      : null;

    // 2. Build ballots & calculate weights
    const tallies: Record<string, number> = {};

    for (const [voterId, targetLoc] of Object.entries(state.votes)) {
      const isVoided = voterId === voidedVoterId;
      const voterRole = state.keptRoles[voterId]?.role;
      // Rich Merchant doubles its ballot if not voided
      const weight = isVoided ? 0 : voterRole === 'rich_merchant' ? 2 : 1;

      ballots.push({
        voterId,
        targetLocation: targetLoc,
        isVoided,
        weight,
      });

      if (weight > 0) {
        tallies[targetLoc] = (tallies[targetLoc] || 0) + weight;
      }
    }

    // 3. Find highest vote total and resolve all ties
    let highestVotes = -1;
    for (const count of Object.values(tallies)) {
      if (count > highestVotes) {
        highestVotes = count;
      }
    }

    if (highestVotes > 0) {
      for (const [loc, count] of Object.entries(tallies)) {
        if (count === highestVotes) {
          const locId = loc as PlayerLocationId;
          const occupant = assignedRoles.find((a) => a.locationId === locId);
          if (occupant) {
            boilerOccupants.push({
              locationId: locId,
              playerId: occupant.playerId,
              role: occupant.role,
            });
          }
        }
      }
    }
  }

  // 4. Winner determination precedence:
  // - Bomber in Boiler wins alone before Murderer checks
  // - Murderer in Boiler: good roles (Guest, Lawyer, Rich Merchant, Detective, Butler) win
  // - Murderer not in Boiler: active Murderer and Accomplice win
  // - Murderer absent: active Accomplice wins
  // - No active evil role: no winner
  const boilerRoles = boilerOccupants.map((b) => b.role);
  const activeRoles = assignedRoles.map((a) => a.role);
  const isBomberInBoiler = boilerRoles.includes('bomber');
  const isMurdererInBoiler = boilerRoles.includes('murderer');
  const isMurdererActive = activeRoles.includes('murderer');
  const isAccompliceActive = activeRoles.includes('accomplice');

  let winningFaction: GameResult['winningFaction'];
  let winningPlayerIds: string[];
  let reason: string;

  if (isBomberInBoiler) {
    winningFaction = 'bomber_faction';
    winningPlayerIds = assignedRoles.filter((a) => a.role === 'bomber').map((a) => a.playerId);
    reason = '炸彈魔進入鍋爐室，單獨獲勝！';
  } else if (isMurdererInBoiler) {
    winningFaction = 'witness_faction';
    winningPlayerIds = assignedRoles
      .filter((a) => ['guest', 'lawyer', 'rich_merchant', 'detective', 'butler'].includes(a.role))
      .map((a) => a.playerId);
    reason = '兇手進入鍋爐室，目擊者陣營獲勝！';
  } else if (isMurdererActive) {
    winningFaction = 'murderer_faction';
    winningPlayerIds = assignedRoles
      .filter((a) => a.role === 'murderer' || a.role === 'accomplice')
      .map((a) => a.playerId);
    reason = '兇手未進入鍋爐室，兇手陣營獲勝！';
  } else if (isAccompliceActive) {
    winningFaction = 'murderer_faction';
    winningPlayerIds = assignedRoles.filter((a) => a.role === 'accomplice').map((a) => a.playerId);
    reason = '兇手未在場且未進入鍋爐室，共犯獲勝！';
  } else {
    winningFaction = 'witness_faction';
    winningPlayerIds = [];
    reason = '無兇手陣營角色在場，本局無獲勝者。';
  }

  state.result = {
    assignedRoles,
    guestRoomCard: state.guestRoomCard,
    ballots,
    boilerOccupants,
    winningFaction,
    winningPlayerIds,
    reason,
  };
  state.phase = 'resolution';
}
