import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Results, Loading, Empty and Recovery States', () => {
  test('three-player complete round to results, edge cases and rematch', async ({ browser }) => {
    const ctxAlice = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxBob = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const ctxCharlie = await browser.newContext({ viewport: { width: 375, height: 667 } });

    const pAlice = await ctxAlice.newPage();
    const pBob = await ctxBob.newPage();
    const pCharlie = await ctxCharlie.newPage();

    // 1. Join room and start L1 game
    await pAlice.goto('/');
    await pAlice.locator('#player-name-input').fill('AliceHost');
    await pAlice.locator('#btn-create-room').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();

    const roomHeader = await pAlice.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;
    expect(roomCode.length).toBe(6);

    for (const [page, name] of [[pBob, 'BobGuest'], [pCharlie, 'CharlieGuest']] as const) {
      await page.goto(`/?room=${roomCode}`);
      await page.locator('#player-name-input').fill(name);
      await page.locator('#btn-join-room').click();
      await expect(page.locator('#lobby-panel')).toBeVisible();
    }

    await pAlice.locator('#btn-toggle-ready').click();
    await pBob.locator('#btn-toggle-ready').click();
    await pCharlie.locator('#btn-toggle-ready').click();

    await expect(pAlice.locator('#btn-start-game')).toBeEnabled();
    await pAlice.locator('#btn-start-game').click();

    // 2. Draft phase
    await expect(pAlice.locator('#game-header')).toBeVisible();
    await expect(pBob.locator('#game-header')).toBeVisible();
    await expect(pCharlie.locator('#game-header')).toBeVisible();

    // Alice passes to Bob
    await expect(pAlice.locator('#draft-form')).toBeVisible();
    await pAlice.locator('#recipient-select').selectOption({ index: 0 });
    await pAlice.locator('#btn-confirm-pass').click();

    // Bob passes to Charlie
    await expect(pBob.locator('#draft-form')).toBeVisible();
    await pBob.locator('#recipient-select').selectOption({ index: 0 });
    await pBob.locator('#btn-confirm-pass').click();

    // Charlie passes leftover to Guest Room
    await expect(pCharlie.locator('#draft-form')).toBeVisible();
    await pCharlie.locator('#btn-confirm-pass').click();

    // 3. Discussion to Voting
    await expect(pAlice.locator('#btn-advance-vote')).toBeVisible({ timeout: 10000 });
    await pAlice.locator('#btn-advance-vote').click();

    await expect(pAlice.locator('#vote-form')).toBeVisible({ timeout: 10000 });
    await expect(pBob.locator('#vote-form')).toBeVisible();
    await expect(pCharlie.locator('#vote-form')).toBeVisible();

    // Submit votes
    await pAlice.locator('#btn-submit-vote').click();
    await pBob.locator('#btn-submit-vote').click();
    await pCharlie.locator('#btn-submit-vote').click();

    // 4. Results Screen Verification
    await expect(pAlice.locator('#results-panel')).toBeVisible({ timeout: 10000 });
    await expect(pBob.locator('#results-panel')).toBeVisible();
    await expect(pCharlie.locator('#results-panel')).toBeVisible();

    // Winner banner heading
    const aliceWinner = await pAlice.locator('.winner-banner, #results-panel h2').first().textContent();
    const bobWinner = await pBob.locator('.winner-banner, #results-panel h2').first().textContent();
    expect(aliceWinner).toBe(bobWinner);

    // Responsive table wrapper existence and no page overflow
    const tableWrapper = pAlice.locator('.results-table-wrapper');
    await expect(tableWrapper).toBeVisible();

    // Check no horizontal overflow at 1280 (Alice), 768 (Bob), 375 (Charlie)
    for (const [p, label] of [[pAlice, 'desktop'], [pBob, 'tablet'], [pCharlie, 'mobile']] as const) {
      const overflow = await p.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow, `Page-level overflow detected on ${label}`).toBe(false);
    }

    // 360px viewport check on Charlie
    await pCharlie.setViewportSize({ width: 360, height: 667 });
    const overflow360 = await pCharlie.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow360, 'Page-level overflow detected at 360px').toBe(false);

    // Capture screenshots for evidence
    const evidenceDir = path.resolve(process.cwd(), '.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    await pAlice.screenshot({
      path: path.join(evidenceDir, 'opendesign-task-7-results-desktop.png'),
      fullPage: true,
    });
    await pCharlie.screenshot({
      path: path.join(evidenceDir, 'opendesign-task-7-results-mobile.png'),
      fullPage: true,
    });

    // 5. Host Rematch back to Lobby
    await pAlice.locator('#btn-rematch').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible({ timeout: 10000 });
    await expect(pBob.locator('#lobby-panel')).toBeVisible();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    // Write evidence JSON
    fs.writeFileSync(
      path.join(evidenceDir, 'opendesign-task-7-results.json'),
      JSON.stringify(
        {
          task: 'opendesign-task-7',
          status: 'passed',
          winnerBanner: aliceWinner?.trim(),
          verifiedViewports: [1280, 768, 375, 360],
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await ctxAlice.close();
    await ctxBob.close();
    await ctxCharlie.close();
  });
});
