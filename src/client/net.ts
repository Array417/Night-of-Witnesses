import {
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '../shared/protocol.ts';
import type { PlayerProjection } from '../shared/state.ts';
import {
  loadSavedSeat,
  saveSeat,
  clearSavedSeat,
  setRoomCodeInUrl,
} from './session.ts';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface GameClientEvents {
  onStatusChange?: (status: ConnectionStatus) => void;
  onProjection?: (projection: PlayerProjection) => void;
  onError?: (code: string, message: string) => void;
  onRoomClosed?: (reason: string) => void;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

const BACKOFF_DELAYS = [500, 1000, 2000, 4000, 8000];

export class GameClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private currentProjection: PlayerProjection | null = null;
  private inFlightAction: boolean = false;
  private backoffIndex = 0;
  private reconnectTimer: NodeJS.Timeout | number | null = null;
  private explicitDisconnect = false;
  private events: GameClientEvents = {};

  constructor(events: GameClientEvents = {}) {
    this.events = events;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getProjection(): PlayerProjection | null {
    return this.currentProjection;
  }

  isActionPending(): boolean {
    return this.inFlightAction;
  }

  setEvents(events: GameClientEvents): void {
    this.events = events;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.events.onStatusChange?.(status);
    }
  }

  connect(): void {
    this.explicitDisconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close any previous socket to supersede it
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.setStatus('connected');
      this.backoffIndex = 0;

      // Check if we have a saved seat to automatically rejoin
      const saved = loadSavedSeat();
      if (saved) {
        this.sendRaw({
          type: 'rejoin',
          actionId: crypto.randomUUID(),
          roomCode: saved.roomCode,
          seatToken: saved.seatToken,
        });
      }
    };

    this.ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      const result = serverMessageSchema.safeParse(parsed);
      if (!result.success) {
        return;
      }

      this.handleServerMessage(result.data);
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.inFlightAction = false;
      if (!this.explicitDisconnect) {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.setStatus('error');
    };
  }

  disconnect(): void {
    this.explicitDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.explicitDisconnect || this.reconnectTimer) return;

    this.setStatus('reconnecting');
    const delay = BACKOFF_DELAYS[Math.min(this.backoffIndex, BACKOFF_DELAYS.length - 1)];
    this.backoffIndex++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        saveSeat(msg.roomCode, msg.seatToken);
        setRoomCodeInUrl(msg.roomCode);
        break;
      }
      case 'projection': {
        this.currentProjection = msg.projection;
        this.inFlightAction = false;
        setRoomCodeInUrl(msg.projection.roomCode);
        this.events.onProjection?.(msg.projection);
        break;
      }
      case 'error': {
        this.inFlightAction = false;
        // If reconnect token is invalid, clear storage
        if (msg.code === 'INVALID_TOKEN' || msg.code === 'ROOM_UNAVAILABLE') {
          clearSavedSeat();
        }
        this.events.onError?.(msg.code, msg.message);
        break;
      }
      case 'ping': {
        this.sendRaw({ type: 'pong' });
        break;
      }
      case 'room_closed': {
        clearSavedSeat();
        setRoomCodeInUrl(null);
        this.currentProjection = null;
        this.inFlightAction = false;
        this.events.onRoomClosed?.(msg.reason);
        break;
      }
    }
  }

  createRoom(playerName: string): boolean {
    if (this.inFlightAction || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.inFlightAction = true;
    this.sendRaw({
      type: 'create_room',
      actionId: crypto.randomUUID(),
      playerName,
    });
    return true;
  }

  joinRoom(roomCode: string, playerName: string): boolean {
    if (this.inFlightAction || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.inFlightAction = true;
    this.sendRaw({
      type: 'join_room',
      actionId: crypto.randomUUID(),
      roomCode: roomCode.toUpperCase(),
      playerName,
    });
    return true;
  }

  dispatchAction(
    action: DistributiveOmit<ClientMessage, 'actionId' | 'baseVersion'>
  ): boolean {
    if (this.inFlightAction || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (!this.currentProjection) {
      return false;
    }

    this.inFlightAction = true;
    const msg = {
      ...action,
      actionId: crypto.randomUUID(),
      baseVersion: this.currentProjection.version,
    } as ClientMessage;

    this.sendRaw(msg);
    return true;
  }
}
