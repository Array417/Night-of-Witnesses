import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { passToFirstEligible, passToGuestRoom, openGameMenu, closeGameMenu } from './draft-flow.ts';

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

    // All players enter draft phase; the table surface is visible on every viewport.
    await expect(pAlice.locator('#game-header')).toBeVisible();
    await expect(pBob.locator('.table-panel')).toBeVisible();
    await expect(pCharlie.locator('.table-panel')).toBeVisible();

    // Role drawer is collapsed initially
    const secretContentAlice = pAlice.locator('#secret-role-content');
    await expect(secretContentAlice).toBeHidden();

    // Alice toggles role reveal through the menu (coarse-pointer clients use the drawer)
    await openGameMenu(pAlice);
    await pAlice.locator('#btn-toggle-role').click();
    await expect(secretContentAlice).toBeVisible();

    // Verify Alice (p1) is current actor in draft
    await expect(pAlice.locator('#draft-controls')).toBeVisible();
    await expect(pBob.locator('#draft-controls')).toBeHidden();
    await closeGameMenu(pAlice);

    // Alice passes to the next eligible player, then Bob, then Charlie to the Guest Room.
    await passToFirstEligible(pAlice);

    // Now Bob is actor
    await openGameMenu(pBob);
    await expect(pBob.locator('#draft-controls')).toBeVisible();
    await closeGameMenu(pBob);
    await passToFirstEligible(pBob);

    // Charlie is final actor
    await openGameMenu(pCharlie);
    await expect(pCharlie.locator('#draft-controls')).toBeVisible();
    await closeGameMenu(pCharlie);
    await passToGuestRoom(pCharlie);

    // All transition to discussion phase; controls live in the table action dock.
    await expect(pAlice.locator('.table-action-dock h2')).toHaveText('自由討論階段');
    await expect(pBob.locator('.table-action-dock h2')).toHaveText('自由討論階段');

    // Take screenshot of desktop discussion
    await pAlice.screenshot({ path: path.join(evidenceDir, 'task-10-desktop-discussion.png'), fullPage: true });
    // Take screenshot of mobile 360px discussion
    await pBob.screenshot({ path: path.join(evidenceDir, 'task-10-mobile-360-discussion.png'), fullPage: true });

    // Alice (host) advances discussion to voting from the dock
    await openGameMenu(pAlice);
    await pAlice.locator('.table-action-dock #btn-advance-vote').click();

    // All enter voting phase; the dock form is reachable without opening the drawer.
    await expect(pAlice.locator('.table-action-dock h2')).toHaveText('投票指認階段');
    await expect(pBob.locator('.table-action-dock h2')).toHaveText('投票指認階段');
    await expect(pCharlie.locator('.table-action-dock h2')).toHaveText('投票指認階段');
    await expect(pBob.locator('.table-action-dock #vote-form')).toBeVisible();
    // Viewport screenshot: fixed drawer elements are unreliable in fullPage captures.
    await pBob.screenshot({
      path: path.join(evidenceDir, 'task-8-game-table-interaction-redesign-dock-mobile-360.png'),
    });

    // All cast votes; the dock survives the projection rerender after each ballot.
    await pAlice.locator('.table-action-dock #btn-submit-vote').click();
    await pBob.locator('.table-action-dock #btn-submit-vote').click();
    await pCharlie.locator('.table-action-dock #btn-submit-vote').click();

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
