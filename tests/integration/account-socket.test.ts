import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createServerInstance } from '../../src/server/http.ts';
import { RoomManager } from '../../src/server/rooms.ts';
import { attachWebSocketServer } from '../../src/server/socket.ts';
import type { GameAccounts } from '../../src/server/accounts.ts';

for (const stage of ['authentication', 'registration']) test(`disconnect during ${stage} cannot leave a connected ghost seat`, async () => {
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let resolutions = 0;
  const userId = randomUUID();
  const accounts: GameAccounts = {
    resolveSession: async () => {
      if (++resolutions === 2 && stage === 'authentication') { entered(); await delayed; }
      return { userId, displayName: '斷線玩家', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    recordRoom: async () => { if (stage === 'registration') { entered(); await delayed; } },
    registerInstance: async () => {}, closeRoom: async () => {}, startMatch: async () => {}, completeMatch: async () => {}, abandonMatch: async () => {},
  };
  const manager = new RoomManager();
  const { server } = createServerInstance();
  const transport = attachWebSocketServer(server, manager, { accounts });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as {port:number}).port}/ws`);
  await once(client, 'open');
  try {
    client.send(JSON.stringify({ type:'create_room', playerName:'斷線玩家', isPublic:true, actionId:randomUUID() }));
    await paused;
    client.close(); await once(client, 'close');
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(manager.listRooms().every(room => [...room.seats.values()].every(seat => !seat.connected)));
    assert.equal(manager.listPublicRooms().length, 0);
  } finally {
    release(); client.terminate(); await transport.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('production account gateway rejects anonymous and revoked sockets and ignores forged names', async () => {
  let valid = true;
  const userId = randomUUID();
  const accounts: GameAccounts = {
    resolveSession: async cookie => {
      if (cookie !== 'now_user_session=valid' || !valid) throw Object.assign(new Error('expired'), { status: 401 });
      return { userId, displayName: '真正玩家', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    registerInstance: async () => {}, recordRoom: async () => {}, closeRoom: async () => {},
    startMatch: async () => {}, completeMatch: async () => {}, abandonMatch: async () => {},
  };
  const manager = new RoomManager();
  const { server } = createServerInstance();
  const transport = attachWebSocketServer(server, manager, { accounts, allowedOrigins: ['http://localhost:3000'] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const anonymous = new WebSocket(url, { headers: { Origin: 'http://localhost:3000' } });
  await assert.rejects(once(anonymous, 'open'), /401/);
  const client = new WebSocket(url, { headers: { Origin: 'http://localhost:3000', Cookie: 'now_user_session=valid' } });
  await once(client, 'open');
  const frames: Array<Record<string, any>> = [];
  client.on('message', data => frames.push(JSON.parse(data.toString())));
  const wait = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate());
  };
  try {
    client.send(JSON.stringify({ type: 'create_room', playerName: '冒認別人', isPublic: true, actionId: randomUUID() }));
    await wait(() => frames.some(frame => frame.type === 'projection'));
    const projection = frames.find(frame => frame.type === 'projection')!.projection;
    assert.equal(projection.players[0].playerName, '真正玩家');
    assert.equal(projection.isPublic, true);
    valid = false;
    client.send(JSON.stringify({ type: 'set_ready', ready: true, actionId: randomUUID(), baseVersion: projection.version }));
    await wait(() => frames.some(frame => frame.code === 'AUTH_REQUIRED'));
    assert.equal(manager.getRoom(projection.roomCode)!.state.players[0].ready, false);
  } finally {
    client.close();
    await transport.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
