import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  clientMessageSchema,
  type IceServerConfig,
  type ServerMessage,
} from '../shared/protocol.ts';
import type { RoomManager } from './rooms.ts';
import { RoomError } from './rooms.ts';
import { projectForViewer } from './project.ts';
import { createTurnIceServers, type TurnConfig } from './turn.ts';

export interface WebSocketOptions {
  allowedOrigins?: string[];
  pingIntervalMs?: number;
  handshakeTimeoutMs?: number;
  iceServers?: IceServerConfig[];
  turn?: TurnConfig;
  discussionCheckIntervalMs?: number;
}

const GAME_RATE_LIMIT = 20;
const RTC_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 10_000;

interface SocketContext {
  ws: WebSocket;
  isAlive: boolean;
  roomCode?: string;
  playerId?: string;
  seatToken?: string;
  messageTimestamps: number[];
  rtcMessageTimestamps: number[];
  handshakeTimer?: NodeJS.Timeout;
}

export function attachWebSocketServer(
  server: http.Server,
  manager: RoomManager,
  options: WebSocketOptions = {}
): {
  wss: WebSocketServer;
  close: () => Promise<void>;
} {
  const allowedOrigins = options.allowedOrigins;
  const pingIntervalMs = options.pingIntervalMs ?? 20_000;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 10_000;
  const iceServers = options.iceServers ?? [];
  const discussionCheckIntervalMs = options.discussionCheckIntervalMs ?? 250;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });

  const sockets = new Map<WebSocket, SocketContext>();

  function sendServerMessage(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function sendWelcome(
    ws: WebSocket,
    roomCode: string,
    seatToken: string,
    playerId: string
  ): void {
    const turnServers = createTurnIceServers(options.turn, playerId);
    sendServerMessage(ws, { type: 'welcome', roomCode, seatToken, playerId, iceServers: [...iceServers, ...turnServers].slice(0, 8) });
  }

  function broadcastRoomProjections(roomCode: string): void {
    const room = manager.getRoom(roomCode);
    if (!room) return;

    for (const ctx of sockets.values()) {
      if (ctx.roomCode === roomCode && ctx.playerId && ctx.ws.readyState === WebSocket.OPEN) {
        const projection = projectForViewer(room.state, ctx.playerId);
        sendServerMessage(ctx.ws, {
          type: 'projection',
          projection,
        });
      }
    }
  }

  // HTTP Upgrade handling
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Strictly /ws path
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Origin verification
    if (allowedOrigins && allowedOrigins.length > 0) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  // WebSocket Connection Lifecycle
  wss.on('connection', (ws) => {
    const ctx: SocketContext = {
      ws,
      isAlive: true,
      messageTimestamps: [],
      rtcMessageTimestamps: [],
    };
    sockets.set(ws, ctx);

    // Initial handshake timeout: must identify / join within handshakeTimeoutMs
    ctx.handshakeTimer = setTimeout(() => {
      if (!ctx.roomCode || !ctx.playerId) {
        ws.terminate();
      }
    }, handshakeTimeoutMs);

    ws.on('pong', () => {
      ctx.isAlive = true;
    });

    ws.on('message', (data, isBinary) => {
      // Reject binary frames
      if (isBinary) {
        sendServerMessage(ws, {
          type: 'error',
          code: 'INVALID_PAYLOAD',
          message: '僅支援文字 JSON 訊息',
        });
        ws.terminate();
        return;
      }

      // JSON parse (before rate limiting so rtc/game buckets stay separate)
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(data.toString());
      } catch {
        sendServerMessage(ws, {
          type: 'error',
          code: 'INVALID_JSON',
          message: '無法解析的 JSON 格式',
        });
        return;
      }

      const now = Date.now();
      const isRtc = (
        typeof parsedJson === 'object' &&
        parsedJson !== null &&
        (parsedJson as Record<string, unknown>).type === 'rtc_signal'
      );
      // Separate rtc bucket (120/10s) so signaling never exhausts the game quota.
      const bucket = isRtc ? ctx.rtcMessageTimestamps : ctx.messageTimestamps;
      const limit = isRtc ? RTC_RATE_LIMIT : GAME_RATE_LIMIT;
      const fresh = bucket.filter((t) => now - t < RATE_WINDOW_MS);
      if (isRtc) {
        ctx.rtcMessageTimestamps = fresh;
      } else {
        ctx.messageTimestamps = fresh;
      }
      if (fresh.length >= limit) {
        sendServerMessage(ws, {
          type: 'error',
          code: 'RATE_LIMITED',
          message: '操作過於頻繁，請稍候再試',
        });
        return;
      }
      fresh.push(now);

      // Zod schema parse
      const parseResult = clientMessageSchema.safeParse(parsedJson);
      if (!parseResult.success) {
        sendServerMessage(ws, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: '無效的訊息結構',
        });
        return;
      }

      const msg = parseResult.data;

      // Handle pong
      if (msg.type === 'pong') {
        ctx.isAlive = true;
        return;
      }

      // Handle initial handshake messages
      if (msg.type === 'create_room') {
        if (ctx.handshakeTimer) {
          clearTimeout(ctx.handshakeTimer);
          ctx.handshakeTimer = undefined;
        }
        try {
          const res = manager.createRoom(msg.playerName, msg.actionId);
          ctx.roomCode = res.roomCode;
          ctx.playerId = res.playerId;
          ctx.seatToken = res.seatToken;

          sendWelcome(ws, res.roomCode, res.seatToken, res.playerId);
          sendServerMessage(ws, {
            type: 'projection',
            projection: res.projection,
          });
        } catch (err: unknown) {
          const code = err instanceof RoomError ? err.code : 'CREATE_FAILED';
          const message = err instanceof Error ? err.message : '建立房間失敗';
          sendServerMessage(ws, { type: 'error', code, message });
        }
        return;
      }

      if (msg.type === 'join_room') {
        if (ctx.handshakeTimer) {
          clearTimeout(ctx.handshakeTimer);
          ctx.handshakeTimer = undefined;
        }
        try {
          const res = manager.joinRoom(msg.roomCode, msg.playerName, msg.actionId);
          ctx.roomCode = res.roomCode;
          ctx.playerId = res.playerId;
          ctx.seatToken = res.seatToken;

          sendWelcome(ws, res.roomCode, res.seatToken, res.playerId);
          broadcastRoomProjections(res.roomCode);
        } catch (err: unknown) {
          const code = err instanceof RoomError ? err.code : 'JOIN_FAILED';
          const message = err instanceof Error ? err.message : '加入房間失敗';
          sendServerMessage(ws, { type: 'error', code, message });
        }
        return;
      }

      if (msg.type === 'rejoin') {
        if (ctx.handshakeTimer) {
          clearTimeout(ctx.handshakeTimer);
          ctx.handshakeTimer = undefined;
        }
        try {
          const res = manager.rejoinRoom(msg.roomCode, msg.seatToken);
          ctx.roomCode = res.roomCode;
          ctx.playerId = res.playerId;
          ctx.seatToken = res.seatToken;

          sendWelcome(ws, res.roomCode, res.seatToken, res.playerId);
          broadcastRoomProjections(res.roomCode);
        } catch (err: unknown) {
          const code = err instanceof RoomError ? err.code : 'REJOIN_FAILED';
          const message = err instanceof Error ? err.message : '重新加入失敗';
          sendServerMessage(ws, { type: 'error', code, message });
        }
        return;
      }

      // Remaining messages require an authenticated socket
      if (!ctx.roomCode || !ctx.playerId) {
        sendServerMessage(ws, {
          type: 'error',
          code: 'UNAUTHENTICATED',
          message: '尚未加入房間',
        });
        return;
      }

      // Authenticated audio signaling: targeted relay only, no state version change.
      if (msg.type === 'rtc_signal') {
        const room = manager.getRoom(ctx.roomCode);
        const senderId = ctx.playerId;
        const senderSeat = room?.seats.get(senderId);
        if (!room || !senderSeat || !senderSeat.connected) {
          sendServerMessage(ws, { type: 'error', code: 'UNAUTHENTICATED', message: '尚未加入房間' });
          return;
        }
        if (room.state.phase !== 'discussion') {
          sendServerMessage(ws, { type: 'error', code: 'INVALID_PHASE', message: '語音信令僅能在討論階段使用' });
          return;
        }
        if (msg.targetPlayerId === senderId) {
          sendServerMessage(ws, { type: 'error', code: 'INVALID_TARGET', message: '無效的信令目標' });
          return;
        }
        const targetSeat = room.seats.get(msg.targetPlayerId);
        const targetPlayer = room.state.players.find((p) => p.playerId === msg.targetPlayerId);
        if (!targetSeat || !targetSeat.connected || !targetPlayer || !targetPlayer.connected) {
          sendServerMessage(ws, { type: 'error', code: 'INVALID_TARGET', message: '目標玩家不在房間或已離線' });
          return;
        }
        // Targeted relay only (never broadcast, never log SDP payload).
        for (const peer of sockets.values()) {
          if (
            peer.roomCode === ctx.roomCode &&
            peer.playerId === msg.targetPlayerId &&
            peer.ws.readyState === WebSocket.OPEN
          ) {
            sendServerMessage(peer.ws, {
              type: 'rtc_signal',
              fromPlayerId: senderId,
              kind: msg.kind,
              payload: msg.payload,
            });
          }
        }
        return;
      }

      // A lobby departure is transport membership, not a game reducer action.
      if (msg.type === 'leave') {
        try {
          const roomCode = ctx.roomCode!;
          manager.leaveRoom(roomCode, ctx.playerId!);
          ctx.roomCode = undefined;
          ctx.playerId = undefined;
          ctx.seatToken = undefined;
          sendServerMessage(ws, { type: 'room_closed', reason: '已離開房間' });
          broadcastRoomProjections(roomCode);
        } catch (err) {
          sendServerMessage(ws, { type: 'error', code: err instanceof RoomError ? err.code : 'ACTION_FAILED', message: err instanceof Error ? err.message : '離房失敗', actionId: msg.actionId });
        }
        return;
      }

      // Dispatch to room manager
      try {
        manager.dispatchAction(ctx.roomCode, ctx.playerId, msg as unknown as import('./rooms.ts').ClientGameAction);
        broadcastRoomProjections(ctx.roomCode);
      } catch (err: unknown) {
        const code = err instanceof RoomError ? err.code : 'ACTION_FAILED';
        const message = err instanceof Error ? err.message : '操作失敗';
        sendServerMessage(ws, {
          type: 'error',
          code,
          message,
          actionId: 'actionId' in msg ? (msg.actionId as string) : undefined,
        });
      }
    });

    ws.on('close', () => {
      if (ctx.handshakeTimer) {
        clearTimeout(ctx.handshakeTimer);
      }
      if (ctx.roomCode && ctx.playerId) {
        manager.disconnectPlayer(ctx.roomCode, ctx.playerId);
        broadcastRoomProjections(ctx.roomCode);
      }
      sockets.delete(ws);
    });
  });

  // Heartbeat ping interval
  const pingInterval = setInterval(() => {
    for (const [ws, ctx] of sockets.entries()) {
      if (!ctx.isAlive) {
        ws.terminate();
        sockets.delete(ws);
        continue;
      }
      ctx.isAlive = false;
      sendServerMessage(ws, { type: 'ping' });
    }
  }, pingIntervalMs);

  // Complete card movements and discussion deadlines without client messages.
  // Broadcast only rooms whose timed transition changed the state.
  const discussionInterval = setInterval(() => {
    try {
      const changed = new Set([...manager.checkAllCardMotions(), ...manager.checkAllDiscussionDeadlines()]);
      for (const roomCode of changed) {
        broadcastRoomProjections(roomCode);
      }
    } catch {
      // Never crash the timer loop on a room error.
    }
  }, discussionCheckIntervalMs);

  async function close(): Promise<void> {
    clearInterval(pingInterval);
    clearInterval(discussionInterval);
    for (const [ws, ctx] of sockets.entries()) {
      if (ctx.handshakeTimer) {
        clearTimeout(ctx.handshakeTimer);
      }
      if (ws.readyState === WebSocket.OPEN) {
        sendServerMessage(ws, {
          type: 'room_closed',
          reason: '伺服器正在重新啟動',
        });
        ws.close();
      }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }

  return { wss, close };
}
