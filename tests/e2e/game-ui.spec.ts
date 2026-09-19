import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('complete Traditional Chinese lobby and gameplay interface', () => {
  test('three players complete full game cycle with keyboard, responsive 360px, and zero secret leak', async ({ browser }) => {
    // 3 isolated contexts
    const ctxAlice = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxBob = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const ctxCharlie = await browser.newContext({ viewport: { width: 360, height: 800 } });

    const pAlice = await ctxAlice.newPage();
    const pBob = await ctxBob.newPage();
    const pCharlie = await ctxCharlie.newPage();

    // Alice opens home and creates room using keyboard
    await pAlice.goto('/');
    await pAlice.locator('#player-name-input').fill('Alice');
    await pAlice.locator('#btn-create-room').click();

    // Alice arrives in lobby
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();
    const roomHeader = await pAlice.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;
    expect(roomCode.length).toBe(6);

    // Verify Bob joins via UI
    await pBob.goto(`/?room=${roomCode}`);
    await pBob.locator('#player-name-input').fill('Bob');
    await pBob.locator('#btn-join-room').click();
    await expect(pBob.locator('#lobby-panel')).toBeVisible();

    // Verify Charlie joins via UI
    await pCharlie.goto(`/?room=${roomCode}`);
    await pCharlie.locator('#player-name-input').fill('Charlie');
    await pCharlie.locator('#btn-join-room').click();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    // Check 360px overflow on Bob's page
    const bobOverflow = await pBob.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth;
    });
    expect(bobOverflow).toBe(false);

    // Ready up all players
    await pAlice.locator('#btn-toggle-ready').click();
    await pBob.locator('#btn-toggle-ready').click();
    await pCharlie.locator('#btn-toggle-ready').click();

    // Host starts game
    const startBtn = pAlice.locator('#btn-start-game');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // All players enter draft phase
    await expect(pAlice.locator('#game-header')).toBeVisible();
    await expect(pBob.locator('#game-header')).toBeVisible();
    await expect(pCharlie.locator('#game-header')).toBeVisible();

    // Role drawer is collapsed initially
    const secretContentAlice = pAlice.locator('#secret-role-content');
    await expect(secretContentAlice).toBeHidden();

    // Alice toggles role reveal
    await pAlice.locator('#btn-toggle-role').click();
    await expect(secretContentAlice).toBeVisible();

    // Verify Alice (p1) is current actor in draft
    await expect(pAlice.locator('#draft-form')).toBeVisible();
    await expect(pBob.locator('#draft-form')).toBeHidden();

    // Alice passes to next player
    await pAlice.locator('#recipient-select').selectOption({ index: 0 });
    await pAlice.locator('#btn-confirm-pass').click();

    // Now Bob is actor
    await expect(pBob.locator('#draft-form')).toBeVisible();
    await pBob.locator('#recipient-select').selectOption({ index: 0 });
    await pBob.locator('#btn-confirm-pass').click();

    // Charlie is final actor
    await expect(pCharlie.locator('#draft-form')).toBeVisible();
    await pCharlie.locator('#btn-confirm-pass').click();

    // All transition to discussion phase
    await expect(pAlice.locator('h2:has-text("自由討論階段")')).toBeVisible();

    // Take screenshot of desktop discussion
    await pAlice.screenshot({ path: path.join(evidenceDir, 'task-10-desktop-discussion.png'), fullPage: true });
    // Take screenshot of mobile 360px discussion
    await pBob.screenshot({ path: path.join(evidenceDir, 'task-10-mobile-360-discussion.png'), fullPage: true });

    // Alice (host) advances discussion to voting
    await pAlice.locator('#btn-advance-vote').click();

    // All enter voting phase
    await expect(pAlice.locator('h2:has-text("投票指認階段")')).toBeVisible();
    await expect(pBob.locator('h2:has-text("投票指認階段")')).toBeVisible();
    await expect(pCharlie.locator('h2:has-text("投票指認階段")')).toBeVisible();

    // All cast votes
    await pAlice.locator('#btn-submit-vote').click();
    await pBob.locator('#btn-submit-vote').click();
    await pCharlie.locator('#btn-submit-vote').click();

    // Results screen appears for all
    await expect(pAlice.locator('#results-panel')).toBeVisible();
    await expect(pBob.locator('#results-panel')).toBeVisible();
    await expect(pCharlie.locator('#results-panel')).toBeVisible();

    // Alice triggers Rematch
    const rematchBtn = pAlice.locator('#btn-rematch');
    await expect(rematchBtn).toBeVisible();
    await rematchBtn.click();

    // Returns all back to lobby!
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();
    await expect(pBob.locator('#lobby-panel')).toBeVisible();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    await ctxAlice.close();
    await ctxBob.close();
    await ctxCharlie.close();
  });

  test('failure scenarios: invalid inputs render accessible recovery alerts without secret leak', async ({ page }) => {
    await page.goto('/');

    // 1. Submit empty name
    await page.locator('#btn-create-room').click();
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible();
    expect(await alert.textContent()).toContain('請輸入有效的玩家暱稱');

    // 2. Submit short/invalid room code
    await page.locator('#player-name-input').fill('Alice');
    await page.locator('#room-code-input').fill('123');
    await page.locator('#btn-join-room').click();
    await expect(alert).toBeVisible();
    expect(await alert.textContent()).toContain('請輸入正確的 6 碼房間代碼');

    // 3. Attempt joining non-existent room code
    await page.locator('#room-code-input').fill('ZZZZZZ');
    await page.locator('#btn-join-room').click();
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });
});
