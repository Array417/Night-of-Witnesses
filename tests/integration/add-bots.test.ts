import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createServerInstance } from '../../src/server/http.ts';
import { attachWebSocketServer } from '../../src/server/socket.ts';
import { RoomManager } from '../../src/server/rooms.ts';

describe('local bot player helper', () => {
  let server: http.Server;
  let manager: RoomManager;
  let closeWs: () => Promise<void>;
  let wsUrl: string;

  before(async () => {
    manager = new RoomManager();
    server = createServerInstance({
      clientDistDir: path.resolve('dist/client'),
      allowedOrigins: ['http://127.0.0.1:3000'],
    }).server;
    closeWs = attachWebSocketServer(server, manager, {
      allowedOrigins: ['http://127.0.0.1:3000'],
      pingIntervalMs: 100,
    }).close;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        wsUrl = `ws://127.0.0.1:${address.port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    await closeWs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('joins three named bots and keeps all seats connected', async () => {
    const { roomCode } = manager.createRoom('Human');

    const botProcess = spawn(
      process.execPath,
      ['scripts/add-bots.mjs', roomCode, 'Red', 'Blue', 'Green'],
      {
        cwd: path.resolve('.'),
        env: {
          ...process.env,
          WS_URL: wsUrl,
          ORIGIN: 'http://127.0.0.1:3000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let output = '';
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`bot process timed out: ${output}`)), 5000);
      botProcess.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('All bots are ready')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      botProcess.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      botProcess.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    const room = manager.getRoom(roomCode);

    assert.ok(room);
    assert.deepEqual(
      room.state.players.map((player) => player.playerName),
      ['Human', 'Red', 'Blue', 'Green']
    );
    assert.ok(room.state.players.slice(1).every((player) => player.ready));
    assert.ok(room.state.players.slice(1).every((player) => player.connected));

    botProcess.kill('SIGINT');
    await new Promise<void>((resolve) => botProcess.once('close', () => resolve()));
  });
});
