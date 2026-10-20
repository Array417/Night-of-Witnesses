import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomQueue } from '../../src/server/room-queue.ts';

test('room queue serializes operations and recovers after rejection', async () => {
  const queue = new RoomQueue();
  const events: string[] = [];
  const first = queue.run('ROOM01', async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    events.push('first');
    throw new Error('expected');
  });
  const second = queue.run('ROOM01', async () => { events.push('second'); return 42; });
  await assert.rejects(first, /expected/);
  assert.equal(await second, 42);
  assert.deepEqual(events, ['first', 'second']);
});
