import { randomUUID } from 'node:crypto';
import { ROLES } from '../shared/rules.ts';
import type { GameAccounts } from './accounts.ts';
import { RoomError, type RoomManager, type RoomRecord, type ClientGameAction } from './rooms.ts';

export class RoomPersistence {
  private readonly accounts: GameAccounts;
  private readonly instanceId: string;
  private readonly knownRooms = new Map<string, string>();

  constructor(accounts: GameAccounts, instanceId: string) {
    this.accounts = accounts;
    this.instanceId = instanceId;
  }

  async registerRoom(room: RoomRecord, userId: string): Promise<void> {
    await this.accounts.recordRoom({ roomId: room.id, code: room.code, instanceId: this.instanceId, createdByUserId: userId, isPublic: room.isPublic, createdAt: new Date(room.createdAt).toISOString() });
    this.knownRooms.set(room.id, room.code);
  }

  async dispatch(manager: RoomManager, room: RoomRecord, playerId: string, action: ClientGameAction): Promise<void> {
    if (action.actionId && room.seats.get(playerId)?.actionIds.includes(action.actionId)) return;
    if (room.pendingStart || (action.type === 'rematch' && room.historyStatus === 'saving')) throw new RoomError('ACTION_FAILED', '戰績正在保存，請稍候。');
    await this.saveAbandonment(room);
    if (action.type === 'start_game') {
      const before = room.state;
      const seat = room.seats.get(playerId)!;
      const actionIds = [...seat.actionIds];
      manager.dispatchAction(room.code, playerId, action);
      const candidate = room.state;
      room.state = before;
      seat.actionIds = actionIds;
      if (candidate.phase !== 'draft') return;
      room.pendingStart = { state: candidate, playerId, actionId: action.actionId, payload: {
        matchId: randomUUID(), roomId: room.id, roundNumber: room.roundNumber + 1,
        level: candidate.level, startedAt: new Date().toISOString(),
        players: candidate.players.map(player => {
          const userId = room.seats.get(player.playerId)?.userId;
          if (!userId) throw new Error('Player account missing');
          return { playerId: player.playerId, userId, displayName: player.playerName };
        }),
      } };
      room.historyStatus = 'saving';
      try { await this.saveStart(room); } catch (error) { this.schedule(room); throw error; }
      return;
    }
    const previousPhase = room.state.phase;
    manager.dispatchAction(room.code, playerId, action);
    if (action.type === 'rematch' && previousPhase !== 'lobby' && room.state.phase === 'lobby') {
      room.matchId = undefined;
      room.historyStatus = 'none';
    }
    if (room.state.result && room.matchId && room.historyStatus !== 'saved') {
      if (!room.pendingResult) {
        const result = room.state.result;
        room.pendingResult = { endedAt: new Date().toISOString(), winningFaction: result.winningFaction, winningPlayerIds: result.winningPlayerIds, reason: result.reason,
          assignments: result.assignedRoles.map(assignment => ({ playerId: assignment.playerId, roleId: assignment.role, factionId: ROLES[assignment.role].faction, locationId: assignment.locationId })),
        };
      }
      room.historyStatus = 'saving';
      try { await this.saveResult(room); } catch { this.schedule(room); }
    }
  }

  private schedule(room: RoomRecord): void {
    room.retryCount = (room.retryCount ?? 0) + 1;
    room.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(room.retryCount - 1, 5));
  }

  private async saveStart(room: RoomRecord): Promise<void> {
    const pending = room.pendingStart;
    if (!pending) return;
    await this.accounts.startMatch(pending.payload);
    for (const player of pending.state.players) player.connected = room.seats.get(player.playerId)?.connected ?? false;
    room.state = pending.state;
    room.matchId = pending.payload.matchId;
    room.roundNumber = pending.payload.roundNumber;
    const seat = room.seats.get(pending.playerId);
    if (seat && pending.actionId) seat.actionIds = [...seat.actionIds, pending.actionId].slice(-128);
    room.pendingStart = undefined;
    room.historyStatus = 'none';
    room.retryCount = 0;
    room.retryAt = undefined;
  }

  private async saveResult(room: RoomRecord): Promise<void> {
    if (!room.pendingResult || !room.matchId) return;
    await this.accounts.completeMatch(room.matchId, room.pendingResult);
    room.pendingResult = undefined;
    room.historyStatus = 'saved';
    room.retryCount = 0;
    room.retryAt = undefined;
  }

  async retry(room: RoomRecord): Promise<boolean> {
    const abandoned = room.matchId && room.state.phase === 'lobby' && !room.pendingStart;
    if (!room.pendingStart && !room.pendingResult && !abandoned) return false;
    if ((room.retryAt ?? 0) > Date.now()) return false;
    try {
      if (room.pendingStart) await this.saveStart(room);
      else if (room.pendingResult) await this.saveResult(room);
      else await this.saveAbandonment(room);
      return true;
    } catch { this.schedule(room); return false; }
  }

  private async saveAbandonment(room: RoomRecord): Promise<void> {
    if (!room.matchId || room.state.phase !== 'lobby' || room.pendingStart) return;
    const matchId = room.matchId;
    room.historyStatus = 'saving';
    await this.accounts.abandonMatch(matchId, new Date().toISOString(), '對局因玩家離線而中斷');
    if (room.matchId === matchId) {
      room.matchId = undefined;
      room.historyStatus = 'none';
      room.retryAt = undefined;
      room.retryCount = 0;
    }
  }

  async syncRooms(manager: RoomManager): Promise<void> {
    for (const [roomId, code] of this.knownRooms) {
      if (manager.getRoom(code)?.id !== roomId) {
        try { await this.accounts.closeRoom(roomId); this.knownRooms.delete(roomId); } catch { }
      }
    }
  }

  async shutdown(manager: RoomManager): Promise<void> {
    for (const room of manager.listRooms()) {
      if (room.pendingResult) { try { await this.saveResult(room); } catch { } }
      await this.accounts.closeRoom(room.id);
    }
  }
}
