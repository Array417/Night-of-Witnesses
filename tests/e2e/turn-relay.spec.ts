import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRoom, completeDraft, openGameMenu } from './draft-flow.ts';
import { installProbe, probeStats, remoteEnergy, writeToneWav } from './voice-probe.ts';

test('configured TURN carries native audio using relay candidates only', async () => {
  test.skip(!process.env.TURN_TEST_HOST || !process.env.TURN_TEST_SECRET, 'Requires a reachable coturn and its server-only shared secret');
  test.setTimeout(180000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'now-relay-'));
  const tonePath = path.join(dir, 'tone.wav');
  writeToneWav(tonePath);
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${tonePath}`] });
  try {
    const { pages, contexts } = await startRoom(browser, ['中繼甲', '中繼乙', '中繼丙'], {
      onPage: async page => {
        await page.addInitScript(() => {
          const Native = window.RTCPeerConnection;
          window.RTCPeerConnection = class extends Native {
            constructor(config?: RTCConfiguration) { super({ ...config, iceTransportPolicy: 'relay' }); }
          };
        });
        await installProbe(page);
      },
    });
    try {
      await completeDraft(pages);
      for (const page of pages) {
        await openGameMenu(page);
        await page.evaluate(() => window.__NOW__!.client.voice.resumePlayback());
      }
      await pages[0].locator('#game-menu-content #btn-toggle-mic').click();
      await expect(pages[0].locator('#btn-toggle-mic')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await probeStats(pages[1])).inboundBytes, { timeout: 60000 }).toBeGreaterThan(0);
      await expect.poll(async () => (await remoteEnergy(pages[1])).rms, { timeout: 30000 }).toBeGreaterThan(0.02);
      const diagnostics = await pages[1].evaluate(async () => await window.__NOW__!.client.voice.getDiagnostics() as { transport: Array<{ candidateType: string }> });
      expect(diagnostics.transport.some(peer => peer.candidateType === 'relay')).toBe(true);
    } finally { await Promise.all(contexts.map(context => context.close())); }
  } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
