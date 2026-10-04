import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { createServerInstance } from '../../src/server/http.ts';
import { attachWebSocketServer } from '../../src/server/socket.ts';
import { RoomManager } from '../../src/server/rooms.ts';

test('leave acknowledgement frees socket membership for immediate create/join', async () => {
  const manager = new RoomManager();
  const { server } = createServerInstance();
  const { close } = attachWebSocketServer(server, manager, { pingIntervalMs: 100000 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox: any[] = [];
  ws.on('message', data => inbox.push(JSON.parse(data.toString())));
  async function receive(type: string): Promise<any> {
    for (let i = 0; i < 200; i++) {
      const index = inbox.findIndex(m => m.type === type);
      if (index !== -1) return inbox.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Missing ${type}: ${JSON.stringify(inbox)}`);
  }
  try {
    await new Promise<void>(resolve => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'create_room', actionId: randomUUID(), playerName: 'A' }));
    const original = await receive('welcome');
    await receive('projection');
    ws.send(JSON.stringify({ type: 'leave', actionId: randomUUID() }));
    assert.equal((await receive('room_closed')).reason, '已離開房間');
    assert.equal(manager.getRoom(original.roomCode), undefined);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.send(JSON.stringify({ type: 'create_room', actionId: randomUUID(), playerName: 'B' }));
    const next = await receive('welcome');
    assert.notEqual(next.seatToken, original.seatToken);
    await receive('projection');
    ws.send(JSON.stringify({ type: 'leave', actionId: randomUUID() }));
    await receive('room_closed');
    ws.send(JSON.stringify({ type: 'rejoin', actionId: randomUUID(), roomCode: original.roomCode, seatToken: original.seatToken }));
    assert.equal((await receive('error')).code, 'INVALID_TOKEN');
  } finally {
    ws.close();
    await close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
