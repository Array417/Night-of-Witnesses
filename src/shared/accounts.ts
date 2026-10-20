import { z } from 'zod';
import type { GameLevel, RoleId, FactionId, PlayerLocationId } from './rules.ts';

export const displayNameSchema = z.string().trim().min(1).max(48).refine(value => [...value].length <= 24, '暱稱最多 24 個字元');
export const accountSchema = z.object({ id: z.string().uuid(), email: z.string().email(), displayName: displayNameSchema });
export const authSchema = z.object({ user: accountSchema, csrfToken: z.string(), expiresAt: z.string() });
export const authenticatedPlayerSchema = z.object({ userId: z.string().uuid(), displayName: displayNameSchema, expiresAt: z.string().datetime({ offset: true }) });
export type Account = z.infer<typeof accountSchema>;
export type AuthenticatedPlayer = z.infer<typeof authenticatedPlayerSchema>;

export interface PublicRoom {
  roomCode: string;
  hostName: string;
  level: GameLevel;
  playerCount: number;
  maxPlayers: number;
  createdAt: string;
}

export interface MatchStart {
  matchId: string;
  roomId: string;
  roundNumber: number;
  level: GameLevel;
  startedAt: string;
  players: Array<{ playerId: string; userId: string; displayName: string }>;
}

export interface MatchResult {
  endedAt: string;
  winningFaction: FactionId;
  winningPlayerIds: string[];
  reason: string;
  assignments: Array<{ playerId: string; roleId: RoleId; factionId: FactionId; locationId: PlayerLocationId }>;
}

export interface PerformanceGroup {
  id: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export interface PlayerStats {
  participated: number;
  inProgress: number;
  completed: number;
  abandoned: number;
  wins: number;
  losses: number;
  noWinner: number;
  winRate: number | null;
  currentWinStreak: number;
  bestWinStreak: number;
  totalPlaySeconds: number;
  averageCompletedSeconds: number | null;
  roles: PerformanceGroup[];
  factions: PerformanceGroup[];
}

export interface MatchHistory {
  id: string;
  level: GameLevel;
  status: string;
  startedAt: string;
  endedAt: string | null;
  roleId: RoleId | null;
  factionId: FactionId | null;
  outcome: 'pending' | 'win' | 'loss' | 'no_winner' | 'abandoned';
  reason: string | null;
  abandonReason: string | null;
  durationSeconds: number | null;
  playerCount: number;
}

export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number }
