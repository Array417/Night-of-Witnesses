import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTurnIceServers } from '../../src/server/turn.ts';

test('TURN credentials expire after five hours and never expose the shared secret', () => {
  const servers = createTurnIceServers({ host: 'game.example.com', secret: 'server-only-secret' }, 'player-1', 1000000);
  assert.equal(servers.length, 2);
  assert.equal(servers[1].username, '19000:player-1');
  assert.equal(servers[1].credential, createHmac('sha1', 'server-only-secret').update('19000:player-1').digest('base64'));
  assert.ok(!JSON.stringify(servers).includes('server-only-secret'));
  assert.deepEqual(servers[1].urls, ['turn:game.example.com:3478?transport=udp', 'turn:game.example.com:3478?transport=tcp']);
});

test('TURN is optional; incomplete or unsafe configuration fails explicitly', () => {
  assert.deepEqual(createTurnIceServers(undefined, 'p'), []);
  assert.throws(() => createTurnIceServers({ host: 'https://bad.example', secret: 'secret' }, 'p'));
  assert.throws(() => createTurnIceServers({ host: 'game.example.com', secret: '' }, 'p'));
});
