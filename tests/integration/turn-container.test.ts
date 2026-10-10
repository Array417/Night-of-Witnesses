import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test('production coturn command starts the pinned image without unsupported options', { skip: process.env.TURN_CONTAINER_TEST !== '1' }, async () => {
  const run = (args: string[], env = process.env) => spawnSync('docker', args, { encoding: 'utf8', env });
  const config = run(['compose', '--profile', 'voice', 'config', '--format', 'json'], {
    ...process.env, TURN_HOST: 'voice.example.test', TURN_EXTERNAL_IP: '127.0.0.1', TURN_SHARED_SECRET: 'temporary-container-check',
  });
  assert.equal(config.status, 0, 'compose configuration should resolve');
  const service = JSON.parse(config.stdout).services.coturn;
  const name = `now-turn-check-${randomUUID()}`;
  try {
    const started = run(['run', '-d', '--name', name, ...Object.entries(service.environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]), '--entrypoint', '/bin/sh', service.image, '-ec', service.command[0]]);
    assert.equal(started.status, 0, 'test container should be created');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const state = run(['inspect', name, '--format', '{{.State.Running}}']);
    if (state.stdout.trim() !== 'true') {
      const logs = run(['logs', name]);
      assert.fail(`coturn exited: ${logs.stderr.match(/unrecognized option[^\n]*/)?.[0] ?? 'see container startup'}`);
    }
  } finally { run(['rm', '-f', name]); }
});
