import { randomBytes, randomUUID } from 'node:crypto';
import { createGame, reduceGame, type GameAction } from '../shared/game.ts';
import type { CanonicalGameState, PlayerProjection } from '../shared/state.ts';
import { projectForViewer } from './project.ts';
import { RulesError } from '../shared/rules.ts';

const UNAMBIGUOUS_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_ROOMS = 100;
const RECONNECT_GRACE_MS = 90_000;
const EMPTY_ROOM_TTL_MS = 600_000; // 10 minutes
const MAX_ROOM_AGE_MS = 14_400_000; // 4 hours

export class RoomError extends Error {
  readonly code: 'ROOM_UNAVAILABLE' | 'INVALID_TOKEN' | 'STALE_VERSION' | 'ACTION_FAILED';
  constructor(
    code: 'ROOM_UNAVAILABLE' | 'INVALID_TOKEN' | 'STALE_VERSION' | 'ACTION_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

export interface SeatRecord {
  playerId: string;
  playerName: string;
  seatToken: string;
  joinedAt: number;
  lastSeenAt: number;
  connected: boolean;
  actionIds: string[]; // Bounded to 128 action IDs
}

export interface RoomRecord {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  state: CanonicalGameState;
  seats: Map<string, SeatRecord>; // playerId -> SeatRecord
  seatTokens: Map<string, string>; // seatToken -> playerId
}

export interface RoomManagerOptions {
  getTime?: () => number;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type ClientGameAction = DistributiveOmit<GameAction, 'playerId'> & { playerId?: string };

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly getTime: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.getTime = options.getTime || (() => Date.now());
  }

  private generateCode(): string {
    let code = '';
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += UNAMBIGUOUS_ALPHABET[bytes[i] % UNAMBIGUOUS_ALPHABET.length];
    }
    return code;
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  getRoom(roomCode: string): RoomRecord | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  createRoom(
    hostName: string,
    actionId?: string
  ): {
    roomCode: string;
    seatToken: string;
    playerId: string;
    projection: PlayerProjection;
  } {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new RoomError('ROOM_UNAVAILABLE', '房間不存在或無法加入');
    }

    const trimmed = hostName.trim();
    if (!trimmed || trimmed.length > 24) {
      throw new RoomError('ACTION_FAILED', '玩家名稱長度必須在 1 至 24 個字元之間');
    }

    let code = this.generateCode();
    while (this.rooms.has(code)) {
      code = this.generateCode();
    }

    const hostPlayerId = randomUUID();
    const hostToken = this.generateToken();
    const now = this.getTime();

    const state = createGame({
      roomCode: code,
      hostPlayerId,
      hostPlayerName: trimmed,
      seed: `${code}-${now}`,
    });

    const hostSeat: SeatRecord = {
      playerId: hostPlayerId,
      playerName: trimmed,
      seatToken: hostToken,
      joinedAt: now,
      lastSeenAt: now,
      connected: true,
      actionIds: actionId ? [actionId] : [],
    };

    const seats = new Map<string, SeatRecord>();
    seats.set(hostPlayerId, hostSeat);

    const seatTokens = new Map<string, string>();
    seatTokens.set(hostToken, hostPlayerId);

    const room: RoomRecord = {
      code,
      createdAt: now,
      lastActivityAt: now,
      state,
      seats,
      seatTokens,
    };

    this.rooms.set(code, room);

    return {
      roomCode: code,
      seatToken: hostToken,
      playerId: hostPlayerId,
      projection: projectForViewer(state, hostPlayerId),
    };
  }

  joinRoom(
    roomCode: string,
    playerName: string,
    actionId?: string
  ): {
    roomCode: string;
    seatToken: string;
    playerId: string;
    projection: PlayerProjection;
  } {
    const code = roomCode.toUpperCase();
    const room = this.rooms.get(code);

    // Identical error response for missing, non-lobby, or full room
    if (!room || room.state.phase !== 'lobby' || room.state.players.length >= 6) {
      throw new RoomError('ROOM_UNAVAILABLE', '房間不存在或無法加入');
    }

    const trimmed = playerName.trim();
    if (!trimmed || trimmed.length > 24) {
      throw new RoomError('ACTION_FAILED', '玩家名稱長度必須在 1 至 24 個字元之間');
    }

    if (
      room.state.players.some(
        (p) => p.playerName.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      throw new RoomError('ACTION_FAILED', '此暱稱已被使用');
    }

    const playerId = randomUUID();
    const seatToken = this.generateToken();
    const now = this.getTime();

    try {
      room.state = reduceGame(room.state, {
        type: 'add_player',
        actionId: actionId || randomUUID(),
        playerId,
        playerName: trimmed,
      });
    } catch (err: unknown) {
      if (err instanceof RulesError) {
        throw new RoomError('ACTION_FAILED', err.message);
      }
      throw err;
    }

    const seat: SeatRecord = {
      playerId,
      playerName: trimmed,
      seatToken,
      joinedAt: now,
      lastSeenAt: now,
      connected: true,
      actionIds: actionId ? [actionId] : [],
    };

    room.seats.set(playerId, seat);
    room.seatTokens.set(seatToken, playerId);
    room.lastActivityAt = now;

    return {
      roomCode: code,
      seatToken,
      playerId,
      projection: projectForViewer(room.state, playerId),
    };
  }

  rejoinRoom(
    roomCode: string,
    seatToken: string
  ): {
    roomCode: string;
    seatToken: string;
    playerId: string;
    projection: PlayerProjection;
  } {
    const code = roomCode.toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      throw new RoomError('INVALID_TOKEN', '憑證無效或房間已結束');
    }

    const playerId = room.seatTokens.get(seatToken);
    if (!playerId) {
      throw new RoomError('INVALID_TOKEN', '憑證無效或房間已結束');
    }

    const seat = room.seats.get(playerId);
    if (!seat) {
      throw new RoomError('INVALID_TOKEN', '憑證無效或房間已結束');
    }

    const now = this.getTime();
    seat.connected = true;
    seat.lastSeenAt = now;

    const playerInState = room.state.players.find((p) => p.playerId === playerId);
    if (playerInState) {
      playerInState.connected = true;
    }

    room.lastActivityAt = now;

    return {
      roomCode: code,
      seatToken,
      playerId,
      projection: projectForViewer(room.state, playerId),
    };
  }

  disconnectPlayer(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return;

    const seat = room.seats.get(playerId);
    if (seat) {
      seat.connected = false;
      seat.lastSeenAt = this.getTime();
    }

    const playerInState = room.state.players.find((p) => p.playerId === playerId);
    if (playerInState) {
      playerInState.connected = false;
    }
  }

  dispatchAction(
    roomCode: string,
    playerId: string,
    action: ClientGameAction
  ): {
    projection: PlayerProjection;
  } {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      throw new RoomError('ROOM_UNAVAILABLE', '房間不存在或無法加入');
    }

    const seat = room.seats.get(playerId);
    if (!seat) {
      throw new RoomError('ACTION_FAILED', '玩家不在房間中');
    }

    // 1. Action Deduplication (per seat, last 128 IDs)
    if (action.actionId && seat.actionIds.includes(action.actionId)) {
      return { projection: projectForViewer(room.state, playerId) };
    }

    // 2. Base version check
    if ('baseVersion' in action && action.baseVersion !== room.state.version) {
      throw new RoomError('STALE_VERSION', '狀態版本已過期，請重新嘗試');
    }

    // 3. Execute authoritative reducer with seat's playerId
    try {
      const gameAction = { ...action, playerId } as GameAction;
      room.state = reduceGame(room.state, gameAction);
    } catch (err: unknown) {
      if (err instanceof RulesError) {
        throw new RoomError('ACTION_FAILED', err.message);
      }
      throw err;
    }

    // Record action ID into seat's bounded history
    if (action.actionId) {
      seat.actionIds.push(action.actionId);
      if (seat.actionIds.length > 128) {
        seat.actionIds.shift();
      }
    }

    const now = this.getTime();
    seat.lastSeenAt = now;
    room.lastActivityAt = now;

    return { projection: projectForViewer(room.state, playerId) };
  }

  checkExpiry(roomCode: string): void {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return;

    const now = this.getTime();

    // Check 90s reconnect expiration for disconnected players
    let draftNeedsCancel = false;

    for (const [playerId, seat] of room.seats.entries()) {
      if (!seat.connected && now - seat.lastSeenAt >= RECONNECT_GRACE_MS) {
        // Expiry condition reached
        if (room.state.phase === 'lobby') {
          // Remove player from lobby
          room.seats.delete(playerId);
          room.seatTokens.delete(seat.seatToken);
          const pIdx = room.state.players.findIndex((p) => p.playerId === playerId);
          if (pIdx !== -1) {
            room.state.players.splice(pIdx, 1);
            room.state.version += 1;
          }
        } else if (room.state.phase === 'draft') {
          draftNeedsCancel = true;
        }
      }
    }

    // Phase-dependent expiry: in draft, any unreturned disconnect cancels to lobby
    if (draftNeedsCancel && room.state.phase === 'draft') {
      room.state.phase = 'lobby';
      for (const p of room.state.players) {
        p.ready = false;
        p.locationId = null;
      }
      room.state.playableCards = [];
      room.state.setAsideCards = [];
      room.state.removedCards = [];
      room.state.currentActorId = null;
      room.state.servedPlayerIds = [];
      room.state.pendingCards = {};
      room.state.keptRoles = {};
      room.state.guestRoomCard = null;
      room.state.version += 1;
    }

    // Host transfer: if host is disconnected past grace window, transfer to earliest-joined connected player
    const hostSeat = room.seats.get(room.state.hostPlayerId);
    if (hostSeat && !hostSeat.connected && now - hostSeat.lastSeenAt >= RECONNECT_GRACE_MS) {
      const connectedSeats = Array.from(room.seats.values())
        .filter((s) => s.connected)
        .sort((a, b) => a.joinedAt - b.joinedAt);

      if (connectedSeats.length > 0) {
        const newHost = connectedSeats[0];
        room.state.hostPlayerId = newHost.playerId;
        for (const p of room.state.players) {
          p.isHost = p.playerId === newHost.playerId;
        }
        room.state.version += 1;
      }
    }

    // Room cleanup: empty room TTL 10 mins or max age 4 hours
    const allDisconnected = Array.from(room.seats.values()).every((s) => !s.connected);
    const roomAge = now - room.createdAt;
    const idleTime = now - room.lastActivityAt;

    if (
      (allDisconnected && idleTime >= EMPTY_ROOM_TTL_MS) ||
      roomAge >= MAX_ROOM_AGE_MS
    ) {
      this.rooms.delete(room.code);
    }
  }
}
