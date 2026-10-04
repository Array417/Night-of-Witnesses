import { test, expect } from '@playwright/test';

test.describe('Audio controls in Menu', () => {
  test('menu contains keyboard-accessible mute, ambience and game volume controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-audio-mute')).toBeHidden();
    await page.locator('#btn-app-menu').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#app-menu #audio-controls-shell')).toBeVisible();
    const mute = page.locator('#btn-audio-mute');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    const ambience = page.locator('#btn-audio-ambience');
    const before = await ambience.getAttribute('aria-pressed');
    await ambience.click();
    await expect(ambience).toHaveAttribute('aria-pressed', String(before !== 'true'));
    await page.locator('#btn-audio-settings').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settings-panel')).toHaveAttribute('open', '');
    await page.locator('#settings-game-volume').fill('0.65');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('night-of-witnesses.audio.v1')!).masterVolume)).toBeCloseTo(0.65, 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-menu')).not.toHaveAttribute('open', '');
  });

  test('audio preferences and independent voice preferences persist on reload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-app-menu').click();
    await page.locator('#btn-audio-settings').click();
    await page.locator('#settings-game-volume').fill('0.25');
    await page.locator('#settings-voice-output').fill('0.3');
    await page.locator('#settings-mic-gain').fill('1.6');
    await page.locator('#btn-audio-mute').click();
    const state = await page.evaluate(() => window.__NOW__!.client.voice.getState());
    expect(state.outputVolume).toBeCloseTo(0.3, 2);
    expect(state.micGain).toBeCloseTo(1.6, 2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('night-of-witnesses.audio.v1')!))).not.toHaveProperty('micGain');
    await page.reload();
    await page.locator('#btn-app-menu').click();
    await page.locator('#btn-audio-settings').click();
    await expect(page.locator('#settings-game-volume')).toHaveValue('0.25');
    await expect(page.locator('#settings-voice-output')).toHaveValue('0.3');
    await expect(page.locator('#settings-mic-gain')).toHaveValue('1.6');
    await expect(page.locator('#btn-audio-mute')).toHaveAttribute('aria-pressed', 'true');
  });
});
