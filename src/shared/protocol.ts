import { z } from 'zod';
import type { PlayerProjection } from './state.ts';

export const roleIdSchema = z.enum([
  'murderer',
  'accomplice',
  'bomber',
  'lawyer',
  'rich_merchant',
  'detective',
  'butler',
  'guest',
]);

export const factionIdSchema = z.enum([
  'murderer_faction',
  'bomber_faction',
  'witness_faction',
]);

export const playerLocationSchema = z.enum([
  'lounge',
  'gallery',
  'billiard_room',
  'study',
  'entrance_hall',
  'dining_room',
]);

export const specialLocationSchema = z.enum(['guest_room', 'boiler_room']);

export const gameLevelSchema = z.enum([
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
  'L6',
  'L7',
  'L8',
]);

export const gamePhaseSchema = z.enum([
  'lobby',
  'draft',
  'discussion',
  'voting',
  'resolution',
  'game_over',
]);

export const cardSchema = z.object({
  id: z.string(),
  role: roleIdSchema,
  label: z.string(),
});

export const ballotEntrySchema = z.object({
  voterId: z.string(),
  targetLocation: playerLocationSchema,
  isVoided: z.boolean(),
  weight: z.number(),
});

export const boilerOccupantSchema = z.object({
  locationId: playerLocationSchema,
  playerId: z.string(),
  role: roleIdSchema,
});

export const gameResultSchema = z.object({
  assignedRoles: z.array(
    z.object({
      playerId: z.string(),
      locationId: playerLocationSchema,
      role: roleIdSchema,
      cardId: z.string(),
    })
  ),
  guestRoomCard: cardSchema.nullable(),
  ballots: z.array(ballotEntrySchema),
  boilerOccupants: z.array(boilerOccupantSchema),
  winningFaction: factionIdSchema,
  winningPlayerIds: z.array(z.string()),
  reason: z.string(),
});

export const playerProjectionSchema = z.object({
  roomCode: z.string(),
  version: z.number().int().nonnegative(),
  phase: gamePhaseSchema,
  level: gameLevelSchema,
  viewerId: z.string(),
  isHost: z.boolean(),
  players: z.array(
    z.object({
      playerId: z.string(),
      playerName: z.string(),
      connected: z.boolean(),
      ready: z.boolean(),
      locationId: playerLocationSchema.nullable(),
      isHost: z.boolean(),
      hasVoted: z.boolean().optional(),
    })
  ),
  publicRoleRoster: z.array(roleIdSchema),
  currentActorId: z.string().nullable(),
  servedPlayerIds: z.array(z.string()),
  testimonyTrail: z.array(
    z.object({
      fromPlayerId: z.string(),
      toPlayerId: z.string().nullable(),
      testimonyRole: roleIdSchema.optional(),
    })
  ),
  ownCards: z.array(cardSchema).optional(),
  ownRole: cardSchema.optional(),
  ownBallot: playerLocationSchema.optional(),
  butlerPeek: z.array(cardSchema).optional(),
  detectiveSentLocation: playerLocationSchema.nullable().optional(),
  result: gameResultSchema.optional(),
});

// Client messages
const createRoomSchema = z.object({
  type: z.literal('create_room'),
  actionId: z.string().uuid(),
  playerName: z.string().trim().min(1).max(24),
});

const joinRoomSchema = z.object({
  type: z.literal('join_room'),
  actionId: z.string().uuid(),
  roomCode: z.string().length(6),
  playerName: z.string().trim().min(1).max(24),
});

const rejoinSchema = z.object({
  type: z.literal('rejoin'),
  actionId: z.string().uuid(),
  roomCode: z.string().length(6),
  seatToken: z.string().min(1),
});

const setReadySchema = z.object({
  type: z.literal('set_ready'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  ready: z.boolean(),
});

const selectLevelSchema = z.object({
  type: z.literal('select_level'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  level: gameLevelSchema,
});

const startGameSchema = z.object({
  type: z.literal('start_game'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
});

const chooseAndPassSchema = z.object({
  type: z.literal('choose_and_pass'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  keepCardId: z.string().min(1),
  passToPlayerId: z.string().min(1).optional(),
  testimonyRole: roleIdSchema.optional(),
});

const advanceToVoteSchema = z.object({
  type: z.literal('advance_to_vote'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
});

const butlerPeekSchema = z.object({
  type: z.literal('butler_peek'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
});

const detectiveSendSchema = z.object({
  type: z.literal('detective_send'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  targetLocation: playerLocationSchema,
});

const castVoteSchema = z.object({
  type: z.literal('cast_vote'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  targetLocation: playerLocationSchema,
});

const rematchSchema = z.object({
  type: z.literal('rematch'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
});

const kickSchema = z.object({
  type: z.literal('kick'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  targetPlayerId: z.string().min(1),
});

const leaveSchema = z.object({
  type: z.literal('leave'),
  actionId: z.string().uuid(),
  baseVersion: z.number().int().nonnegative().optional(),
});

const pongSchema = z.object({
  type: z.literal('pong'),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  createRoomSchema,
  joinRoomSchema,
  rejoinSchema,
  setReadySchema,
  selectLevelSchema,
  startGameSchema,
  chooseAndPassSchema,
  advanceToVoteSchema,
  butlerPeekSchema,
  detectiveSendSchema,
  castVoteSchema,
  rematchSchema,
  kickSchema,
  leaveSchema,
  pongSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Server messages
const welcomeSchema = z.object({
  type: z.literal('welcome'),
  roomCode: z.string(),
  seatToken: z.string().min(1),
  playerId: z.string().min(1),
});

const projectionSchema = z.object({
  type: z.literal('projection'),
  projection: playerProjectionSchema,
});

const errorSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  actionId: z.string().optional(),
});

const pingSchema = z.object({
  type: z.literal('ping'),
});

const roomClosedSchema = z.object({
  type: z.literal('room_closed'),
  reason: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  welcomeSchema,
  projectionSchema,
  errorSchema,
  pingSchema,
  roomClosedSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
