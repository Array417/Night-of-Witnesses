import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('Home and Lobby Redesign Verification', () => {
  const viewports = [
    { name: 'mobile-360', width: 360, height: 800 },
    { name: 'mobile-375', width: 375, height: 812 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`home and lobby journey at ${vp.name}`, async ({ browser }) => {
      const hostContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const guest1Context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const guest2Context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

      const hostPage = await hostContext.newPage();
      const guest1Page = await guest1Context.newPage();
      const guest2Page = await guest2Context.newPage();

      // 1. Host visits home
      await hostPage.goto('/');
      await expect(hostPage.locator('#home-panel')).toBeVisible();

      // Check no overflow on home
      let overflow = await hostPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(overflow).toBe(true);

      // 24-character CJK name test
      const longName = '一二三四五六七八九十一二三四五六七八九十一二三四';
      await hostPage.fill('#player-name-input', longName);
      await hostPage.click('#btn-create-room');

      // Wait for lobby
      await expect(hostPage.locator('#lobby-panel')).toBeVisible();
      const roomHeading = await hostPage.locator('#lobby-panel h1').innerText();
      const roomCodeMatch = roomHeading.match(/[A-Z0-9]{6}/);
      expect(roomCodeMatch).not.toBeNull();
      const roomCode = roomCodeMatch![0];

      // Check lobby overflow
      overflow = await hostPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(overflow).toBe(true);

      // 2. Guest 1 joins
      await guest1Page.goto(`/?room=${roomCode}`);
      await expect(guest1Page.locator('#home-panel')).toBeVisible();
      await guest1Page.fill('#player-name-input', '玩家乙');
      await guest1Page.click('#btn-join-room');
      await expect(guest1Page.locator('#lobby-panel')).toBeVisible();

      // 3. Guest 2 joins
      await guest2Page.goto('/');
      await guest2Page.fill('#player-name-input', '玩家丙');
      await guest2Page.fill('#room-code-input', roomCode);
      await guest2Page.click('#btn-join-room');
      await expect(guest2Page.locator('#lobby-panel')).toBeVisible();

      // Verify roster on host page has 3 players
      const roster = hostPage.locator('#player-roster li');
      await expect(roster).toHaveCount(3);

      // Start button should be disabled before ready
      const startBtn = hostPage.locator('#btn-start-game');
      await expect(startBtn).toBeDisabled();

      // Guests and Host toggle ready
      await hostPage.click('#btn-toggle-ready');
      await guest1Page.click('#btn-toggle-ready');
      await guest2Page.click('#btn-toggle-ready');

      // Now start button should be enabled
      await expect(startBtn).toBeEnabled();

      // Capture screenshot and evidence at this viewport
      const screenshotPath = path.join(evidenceDir, `opendesign-task-4-home-lobby-${vp.name}.png`);
      await hostPage.screenshot({ path: screenshotPath, fullPage: true });

      const jsonPath = path.join(evidenceDir, `opendesign-task-4-home-lobby-${vp.name}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify({
        viewport: vp,
        roomCode,
        playerCount: 3,
        overflowFree: true,
      }, null, 2));

      await hostContext.close();
      await guest1Context.close();
      await guest2Context.close();
    });
  }

  test('form validation and error recovery preserves typed inputs', async ({ page }) => {
    await page.goto('/');

    // Empty name error
    await page.click('#btn-create-room');
    const alert = page.locator('.alert-danger, .alert');
    await expect(alert).toBeVisible();

    // Malformed room code error
    await page.fill('#player-name-input', '測試玩家');
    await page.fill('#room-code-input', '123'); // only 3 chars
    await page.click('#btn-join-room');
    await expect(alert).toBeVisible();

    // Input preserved
    expect(await page.inputValue('#player-name-input')).toBe('測試玩家');
    expect(await page.inputValue('#room-code-input')).toBe('123');
  });
});
