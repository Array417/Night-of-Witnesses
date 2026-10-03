/**
 * Native WebRTC voice happy-path.
 *
 * Real Chromium + real app/server + real RTCPeerConnection transport.
 * The ONLY synthetic input is the browser's fake capture DEVICE
 * (--use-fake-device-for-media-stream with a looping tone file); the
 * getUserMedia/RTCPeerConnection path is fully native.
 *
 * Flow: 3 players -> draft -> discussion. P1 speaks via the real mic
 * button, P2 only listens (never touches the mic). Proves inbound-rtp
 * bytes + remote audio energy on P2, gain 0 suppression/restore, mic-off
 * track stop, speaker reload/re-offer, and phase-exit disposal.
 */
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeDraft, startRoom } from './draft-flow.ts';
import {
  installProbe,
  probeStats,
  rawTrackStates,
  remoteEnergy,
  writeToneWav,
} from './voice-probe.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function setSlider(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input: HTMLInputElement, next: string) => {
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test.describe('voice media happy path (native WebRTC)', () => {
  test('real audio flows to a mic-less listener; gain/mute/exit stop it', async () => {
    test.setTimeout(240000);
    const toneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'now-voice-'));
    const tonePath = path.join(toneDir, 'fake-tone.wav');
    let fakeBrowser: Browser | null = null;
    try {
      writeToneWav(tonePath);
      fakeBrowser = await chromium.launch({
        args: [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          `--use-file-for-fake-audio-capture=${tonePath}`,
          '--autoplay-policy=no-user-gesture-required',
        ],
      });

      const { pages, contexts } = await startRoom(fakeBrowser, ['蘇珊', '湯姆', '莉娜'], {
        onPage: async (page) => {
          await installProbe(page);
        },
      });
      const [speaker, listener] = pages;

      try {
        await completeDraft(pages);
        await expect(speaker.locator('.table-action-dock h2')).toHaveText('自由討論階段');

        for (const page of pages) {
          const wired = await page.evaluate(() => Boolean(window.__NOW__?.client?.voice));
          expect(wired).toBe(true);
        }

        // Listener resolves playback blocks (if any) without ever opening the mic.
        for (const page of pages) {
          const blocked = await page.evaluate(
            () => window.__NOW__?.client?.voice.getState().playbackBlocked ?? false
          );
          if (blocked) await page.locator('.table-action-dock #btn-resume-voice').click();
        }

        // Speaker opens the mic through the real button.
        const micBtn = speaker.locator('.table-action-dock #btn-toggle-mic');
        await micBtn.click();
        await expect(micBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
        await expect(speaker.locator('.voice-panel .alert-error')).toBeHidden();

        // Native proof on the listener: inbound-rtp bytes arrive and grow.
        await expect
          .poll(async () => (await probeStats(listener)).inboundBytes, { timeout: 90000 })
          .toBeGreaterThan(0);
        const bytesBefore = (await probeStats(listener)).inboundBytes;
        await expect
          .poll(async () => (await probeStats(listener)).inboundBytes, { timeout: 30000 })
          .toBeGreaterThan(bytesBefore);
        const bytesAfter = (await probeStats(listener)).inboundBytes;
        console.log(`inbound-rtp bytes on listener: ${bytesBefore} -> ${bytesAfter}`);

        // Listener never needed microphone permission; speaker used a real capture.
        expect((await probeStats(listener)).gumCalls).toBe(0);
        expect((await probeStats(speaker)).gumCalls).toBeGreaterThanOrEqual(1);

        // Remote audio energy follows the real transport.
        const energy = await remoteEnergy(listener);
        console.log(`remote sinks=${energy.sinks} live=${energy.liveSinks} rms=${energy.rms}`);
        expect(energy.liveSinks).toBeGreaterThan(0);
        expect(energy.rms).toBeGreaterThan(0.02);

        // Receiver output volume drives the actual sink element.
        await listener.locator('#btn-audio-settings').click();
        await setSlider(listener, '#settings-voice-output', '0.2');
        const sinkVolume = await listener.evaluate(() => {
          const audio = document.querySelector<HTMLAudioElement>('audio[data-voice-peer]');
          return audio ? audio.volume : -1;
        });
        expect(sinkVolume).toBeCloseTo(0.2, 2);
        await setSlider(listener, '#settings-voice-output', '0.8');

        // Mic gain 0 suppresses real audio energy; gain > 0 restores it.
        await speaker.locator('#btn-audio-settings').click();
        await setSlider(speaker, '#settings-mic-gain', '0');
        const muted = await remoteEnergy(listener);
        console.log(`rms with gain 0: ${muted.rms}`);
        expect(muted.rms).toBeLessThan(energy.rms * 0.3);
        await setSlider(speaker, '#settings-mic-gain', '1');
        const restored = await remoteEnergy(listener);
        console.log(`rms with gain restored: ${restored.rms}`);
        expect(restored.rms).toBeGreaterThan(0.02);

        // Mic off stops the recorded raw tracks and freezes inbound bytes.
        await micBtn.click();
        await expect(micBtn).toHaveAttribute('aria-pressed', 'false');
        await expect
          .poll(async () => (await rawTrackStates(speaker)).length, { timeout: 15000 })
          .toBeGreaterThan(0);
        await expect
          .poll(async () => (await rawTrackStates(speaker)).every((s) => s === 'ended'), {
            timeout: 15000,
          })
          .toBe(true);
        const frozenA = (await probeStats(listener)).inboundBytes;
        await listener.waitForTimeout(1500);
        const frozenB = (await probeStats(listener)).inboundBytes;
        console.log(`bytes frozen after mic off: ${frozenA} -> ${frozenB}`);
        expect(frozenB - frozenA).toBeLessThan(1200);

        // Re-enable: transport resumes without a page reload.
        await micBtn.click();
        await expect(micBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
        await expect
          .poll(async () => (await probeStats(listener)).inboundBytes, { timeout: 60000 })
          .toBeGreaterThan(frozenB);

        // Reconnect the speaking peer: reload rejoins via seat token, offer/answer recreates.
        const bytesPreReload = (await probeStats(listener)).inboundBytes;
        await speaker.reload();
        await expect(speaker.locator('.table-action-dock h2')).toHaveText('自由討論階段', {
          timeout: 30000,
        });
        const speakerMic = speaker.locator('.table-action-dock #btn-toggle-mic');
        await expect(speakerMic).toHaveAttribute('aria-pressed', 'false');
        await speakerMic.click();
        await expect(speakerMic).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
        await expect
          .poll(async () => (await probeStats(speaker)).pcCount, { timeout: 30000 })
          .toBeGreaterThan(0);
        await expect
          .poll(async () => (await probeStats(listener)).inboundBytes, { timeout: 60000 })
          .toBeGreaterThan(bytesPreReload);
        console.log(
          `reconnect ok: speaker pcs=${(await probeStats(speaker)).pcCount} ` +
            `listener bytes=${(await probeStats(listener)).inboundBytes}`
        );

        // Unanimous consent exits the phase: media stops and native PCs dispose.
        for (const page of pages) {
          await page.locator('.table-action-dock #btn-advance-vote').click();
        }
        for (const page of pages) {
          await expect(page.locator('.table-action-dock h2')).toHaveText('投票指認階段', {
            timeout: 30000,
          });
        }
        for (const [index, page] of pages.entries()) {
          await expect
            .poll(
              async () => {
                const states = (await probeStats(page)).pcStates;
                return states.length > 0 && states.every((s) => s === 'closed');
              },
              { timeout: 30000 }
            )
            .toBe(true);
          const sinks = await page.evaluate(
            () => document.querySelectorAll('audio[data-voice-peer]').length
          );
          expect(sinks).toBe(0);
          console.log(`page${index} pcs closed, sinks=${sinks}`);
        }
        // The mic button only exists during discussion by UI design; assert the
        // controller state instead: mic off and mesh inactive on every page.
        for (const page of pages) {
          const voiceState = await page.evaluate(
            () => window.__NOW__?.client?.voice.getState() ?? null
          );
          expect(voiceState?.micEnabled).toBe(false);
          expect(voiceState?.active).toBe(false);
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    } finally {
      if (fakeBrowser) await fakeBrowser.close().catch(() => undefined);
      fs.rmSync(toneDir, { recursive: true, force: true });
    }
  });
});
