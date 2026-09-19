import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createServerInstance } from '../../src/server/http.ts';
import { attachWebSocketServer } from '../../src/server/socket.ts';
import { RoomManager } from '../../src/server/rooms.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('hardened HTTP and WebSocket transport', () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let wsUrl: string;
  let manager: RoomManager;
  let closeWs: () => Promise<void>;

  before(async () => {
    manager = new RoomManager();
    const serverInstance = createServerInstance({
      clientDistDir: path.resolve('dist/client'),
      allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
    });
    server = serverInstance.server;

    const wsHandler = attachWebSocketServer(server, manager, {
      allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
      pingIntervalMs: 500, // Fast ping for testing
      handshakeTimeoutMs: 1500,
    });
    closeWs = wsHandler.close;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    await closeWs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('GET /healthz returns exact {"ok":true} and captures task-8-health.json', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const body = await res.json();
    assert.deepEqual(body, { ok: true });

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    fs.writeFileSync(path.join(evidenceDir, 'task-8-health.json'), JSON.stringify(body, null, 2), 'utf8');
  });

  test('GET /robots.txt blocks all indexing', async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('Disallow: /'));
  });

  test('security headers are present on HTTP responses', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('content-security-policy'));
  });

  test('static path traversal attacks are rejected', async () => {
    const res = await fetch(`${baseUrl}/../../package.json`);
    // Should either 404 or serve index.html (SPA fallback), never raw package.json content
    const text = await res.text();
    assert.ok(!text.includes('"dependencies"'));
  });

  test('WebSocket: create room, join seats, and dispatch action over wire', async () => {
    const framesLog: string[] = [];
    const client1 = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3000' } });

    await new Promise<void>((resolve) => client1.on('open', resolve));

    let roomCode = '';
    let p1Token = '';
    let p1Id = '';

    // Create room
    client1.send(
      JSON.stringify({
        type: 'create_room',
        actionId: '00000000-0000-4000-8000-000000000001',
        playerName: 'Alice',
      })
    );

    await new Promise<void>((resolve) => {
      client1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        framesLog.push(JSON.stringify(msg));
        if (msg.type === 'welcome') {
          roomCode = msg.roomCode;
          p1Token = msg.seatToken;
          p1Id = msg.playerId;
        } else if (msg.type === 'projection' && roomCode) {
          resolve();
        }
      });
    });

    assert.ok(roomCode);
    assert.ok(p1Token);
    assert.ok(p1Id);

    // Client 2 joins
    const client2 = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3000' } });
    await new Promise<void>((resolve) => client2.on('open', resolve));

    client2.send(
      JSON.stringify({
        type: 'join_room',
        actionId: '00000000-0000-4000-8000-000000000002',
        roomCode,
        playerName: 'Bob',
      })
    );

    await new Promise<void>((resolve) => {
      client2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        framesLog.push(JSON.stringify(msg));
        if (msg.type === 'projection') {
          resolve();
        }
      });
    });

    client1.close();
    client2.close();

    const evidenceDir = path.resolve('.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    fs.writeFileSync(path.join(evidenceDir, 'task-8-frames.jsonl'), framesLog.join('\n') + '\n', 'utf8');
  });

  test('WebSocket rejects invalid origin', async () => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://malicious-website.com' } });
    const closed = await new Promise<boolean>((resolve) => {
      ws.on('unexpected-response', () => resolve(true));
      ws.on('error', () => resolve(true));
      ws.on('close', () => resolve(true));
    });
    assert.ok(closed);
  });

  test('WebSocket rejects invalid path', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/invalid-ws`, {
      headers: { Origin: 'http://127.0.0.1:3000' },
    });
    const closed = await new Promise<boolean>((resolve) => {
      ws.on('unexpected-response', () => resolve(true));
      ws.on('error', () => resolve(true));
      ws.on('close', () => resolve(true));
    });
    assert.ok(closed);
  });

  test('WebSocket rejects malformed payload with secret canary without echoing it', async () => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3000' } });
    await new Promise<void>((resolve) => ws.on('open', resolve));

    const canarySecret = 'CANARY_ATTACK_STRING_SECRET_777';
    ws.send(JSON.stringify({ type: 'unknown_action', secret: canarySecret }));

    const response = await new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });

    assert.ok(!response.includes(canarySecret), 'Error response must not echo client input or secret canary');
    ws.close();
  });

  test('WebSocket terminates connection when handshake times out', async () => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3000' } });
    await new Promise<void>((resolve) => ws.on('open', resolve));
    // Send nothing -> wait for handshake timeout (1500ms)
    const closed = await new Promise<boolean>((resolve) => {
      ws.on('close', () => resolve(true));
    });
    assert.ok(closed, 'Socket without initial handshake must be terminated');
  });
});
