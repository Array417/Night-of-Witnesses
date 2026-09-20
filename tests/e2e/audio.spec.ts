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
});
