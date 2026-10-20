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
import { completeDraft, startRoom, openGameMenu, closeGameMenu } from './draft-flow.ts';
import {
  installProbe,
  probeStats,
  rawTrackStates,
  remoteEnergy,
  writeToneWav,
} from './voice-probe.ts';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function setSlider(page: Page, name: string, value: string): Promise<void> {
  const slider = page.getByRole('slider', {name, exact:true});
  await slider.press('Home');
  const steps = Math.round(Number(value) / (name === '麥克風增益' ? 0.1 : 0.05));
  for (let index = 0; index < steps; index++) await slider.press('ArrowRight');
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
        viewport: {width:test.info().project.use.viewport?.width??1280,height:1000},
        contextOptions: () => ({isMobile:test.info().project.use.isMobile,hasTouch:test.info().project.use.hasTouch}),
        onPage: async (page) => {
          await installProbe(page);
        },
      });
      const [speaker, listener] = pages;

      try {
        await completeDraft(pages);
        await expect(speaker.locator('[data-phase-heading]')).toHaveText('自由討論階段');

        for (const page of pages) {
          const wired = await page.evaluate(() => Boolean(window.__NOW__?.client?.voice));
          expect(wired).toBe(true);
        }

        // Listener resolves playback blocks (if any) without ever opening the mic.
        for (const page of pages) {
          await openGameMenu(page);
          const blocked = await page.evaluate(
            () => window.__NOW__?.client?.voice.getState().playbackBlocked ?? false
          );
          if (blocked) await page.locator('#btn-resume-voice').click();
        }

        // Speaker opens the mic through the real button.
        const micBtn = speaker.locator('#btn-toggle-mic');
        await micBtn.click();
        await expect(micBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
        await expect(speaker.getByRole('dialog').getByRole('alert')).toHaveCount(0);

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
        await openGameMenu(listener);
        await setSlider(listener, '對方語音音量', '0.2');
        const sinkVolume = await listener.evaluate(() => {
          const audio = document.querySelector<HTMLAudioElement>('audio[data-voice-peer]');
          return audio ? audio.volume : -1;
        });
        expect(sinkVolume).toBeCloseTo(0.2, 2);
        await setSlider(listener, '對方語音音量', '0.8');

        // Mic gain 0 suppresses real audio energy; gain > 0 restores it.
        await openGameMenu(speaker);
        await setSlider(speaker, '麥克風增益', '0');
        const muted = await remoteEnergy(listener);
        console.log(`rms with gain 0: ${muted.rms}`);
        expect(muted.rms).toBeLessThan(energy.rms * 0.3);
        await setSlider(speaker, '麥克風增益', '1');
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
        await expect(speaker.locator('[data-phase-heading]')).toHaveText('自由討論階段', {
          timeout: 30000,
        });
        await openGameMenu(speaker);
        const speakerMic = speaker.locator('#btn-toggle-mic');
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
          await closeGameMenu(page);
          await page.locator('#btn-consent-vote').click();
        }
        for (const page of pages) {
          await expect(page.locator('[data-phase-heading]')).toHaveText('投票指認階段', {
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
