import { test, expect } from '@playwright/test';

test.describe('Audio Controls & Persistence', () => {
  test('audio controls shell is mounted outside #app and reachable by keyboard', async ({ page }) => {
    await page.goto('/');

    const audioShell = page.locator('#audio-controls-shell');
    await expect(audioShell).toBeAttached();

    // Check that audio controls are outside #app
    const isInsideApp = await page.evaluate(() => {
      const app = document.getElementById('app');
      const shell = document.getElementById('audio-controls-shell');
      return app && shell ? app.contains(shell) : false;
    });
    expect(isInsideApp).toBe(false);

    // Mute toggle button
    const muteBtn = page.locator('#btn-audio-mute');
    await expect(muteBtn).toBeVisible();
    await expect(muteBtn).toHaveAttribute('aria-label', '靜音切換');
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');

    // Volume slider
    const volumeSlider = page.locator('#audio-volume-slider');
    await expect(volumeSlider).toBeVisible();
    await expect(volumeSlider).toHaveAttribute('aria-label', '音量大小');

    // Ambience toggle button
    const ambienceBtn = page.locator('#btn-audio-ambience');
    await expect(ambienceBtn).toBeVisible();
    await expect(ambienceBtn).toHaveAttribute('aria-label', '酒館環境音切換');
    await expect(ambienceBtn).toHaveAttribute('aria-pressed', 'true');

    // Keyboard interaction: toggle mute
    await muteBtn.focus();
    await page.keyboard.press('Enter');
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');

    // Toggle ambience
    await ambienceBtn.focus();
    await page.keyboard.press('Enter');
    await expect(ambienceBtn).toHaveAttribute('aria-pressed', 'false');

    // Verify localStorage persistence
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('night-of-witnesses.audio.v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(saved).not.toBeNull();
    expect(saved.muted).toBe(true);
    expect(saved.ambienceEnabled).toBe(false);

    // Reload page and check persistence
    await page.reload();
    const muteBtnAfter = page.locator('#btn-audio-mute');
    await expect(muteBtnAfter).toHaveAttribute('aria-pressed', 'true');
    const ambienceBtnAfter = page.locator('#btn-audio-ambience');
    await expect(ambienceBtnAfter).toHaveAttribute('aria-pressed', 'false');
  });

  test('persistent settings disclosure exposes game, received-voice, and mic-gain controls', async ({ page }) => {
    await page.goto('/');

    // The disclosure lives inside the persistent shell outside #app.
    const settings = page.locator('#settings-panel');
    await expect(settings).toBeAttached();
    const isInsideApp = await page.evaluate(() => {
      const app = document.getElementById('app');
      const panel = document.getElementById('settings-panel');
      return app && panel ? app.contains(panel) : false;
    });
    expect(isInsideApp).toBe(false);

    // Native keyboard-operable disclosure.
    const summary = page.locator('#btn-audio-settings');
    await expect(summary).toHaveText('語音與音效設定');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(settings).toHaveAttribute('open', '');

    const gameVolume = page.locator('#settings-game-volume');
    const voiceOutput = page.locator('#settings-voice-output');
    const micGain = page.locator('#settings-mic-gain');
    await expect(gameVolume).toBeVisible();
    await expect(voiceOutput).toBeVisible();
    await expect(micGain).toBeVisible();
    await expect(gameVolume).toHaveAttribute('min', '0');
    await expect(gameVolume).toHaveAttribute('max', '1');
    await expect(voiceOutput).toHaveAttribute('max', '1');
    await expect(micGain).toHaveAttribute('min', '0');
    await expect(micGain).toHaveAttribute('max', '2');

    // Game volume drives the same master preference as the strip slider and persists.
    await gameVolume.evaluate((input: HTMLInputElement) => {
      input.value = '0.65';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#audio-volume-slider')).toHaveValue('0.65');
    const saved = await page.evaluate(() => {
      const raw = localStorage.getItem('night-of-witnesses.audio.v1');
      return raw ? (JSON.parse(raw) as { masterVolume: number }) : null;
    });
    expect(saved?.masterVolume).toBeCloseTo(0.65, 2);

    // The strip slider mirrors back into the settings control.
    await page.locator('#audio-volume-slider').evaluate((input: HTMLInputElement) => {
      input.value = '0.25';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(gameVolume).toHaveValue('0.25');
    await page.reload();
    await expect(page.locator('#settings-game-volume')).toHaveValue('0.25');
  });

  test('received-voice volume and mic gain bind to the voice controller and persist separately', async ({ page }) => {
    await page.goto('/');
    const hasVoice = await page.evaluate(() => Boolean(window.__NOW__?.client?.voice));
    test.skip(!hasVoice, 'voice controller not wired yet (parallel media agent owns client.voice)');

    await page.locator('#btn-audio-settings').click();
    const voiceOutput = page.locator('#settings-voice-output');
    const micGain = page.locator('#settings-mic-gain');
    await expect(voiceOutput).toBeEnabled();
    await expect(micGain).toBeEnabled();

    await voiceOutput.evaluate((input: HTMLInputElement) => {
      input.value = '0.3';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await micGain.evaluate((input: HTMLInputElement) => {
      input.value = '1.6';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const applied = await page.evaluate(
      () => window.__NOW__?.client.voice.getState() ?? null
    );
    expect(applied?.outputVolume).toBeCloseTo(0.3, 2);
    expect(applied?.micGain).toBeCloseTo(1.6, 2);

    // Voice preferences persist under their own key; the game audio key never gains voice fields.
    const storage = await page.evaluate(() => {
      const voiceRaw = localStorage.getItem('night-of-witnesses.voice.v1');
      const audioRaw = localStorage.getItem('night-of-witnesses.audio.v1');
      return {
        voice: voiceRaw
          ? (JSON.parse(voiceRaw) as { outputVolume?: number; micGain?: number })
          : null,
        audio: audioRaw ? (JSON.parse(audioRaw) as Record<string, unknown>) : null,
      };
    });
    expect(storage.voice?.outputVolume).toBeCloseTo(0.3, 2);
    expect(storage.voice?.micGain).toBeCloseTo(1.6, 2);
    expect(storage.audio ?? {}).not.toHaveProperty('outputVolume');
    expect(storage.audio ?? {}).not.toHaveProperty('micGain');

    await page.reload();
    await page.locator('#btn-audio-settings').click();
    await expect(page.locator('#settings-voice-output')).toHaveValue('0.3');
    await expect(page.locator('#settings-mic-gain')).toHaveValue('1.6');
  });
});
