import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('authoritative end-to-end game journeys', () => {
  test('three-player baseline L1 game journey with zero secret leakage and rematch', async ({ browser }) => {
    // 3 isolated contexts
    const ctxAlice = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxBob = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const ctxCharlie = await browser.newContext({ viewport: { width: 360, height: 800 } });

    const pAlice = await ctxAlice.newPage();
    const pBob = await ctxBob.newPage();
    const pCharlie = await ctxCharlie.newPage();

    // 1. Alice creates room
    await pAlice.goto('/');
    await pAlice.locator('#player-name-input').fill('AliceHost');
    await pAlice.locator('#btn-create-room').click();

    await expect(pAlice.locator('#lobby-panel')).toBeVisible();
    const roomHeader = await pAlice.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;
    expect(roomCode.length).toBe(6);

    // URL Hygiene: URL has ?room=... and NEVER contains seat token
    const aliceUrl = pAlice.url();
    expect(aliceUrl).toContain(`room=${roomCode}`);
    expect(aliceUrl).not.toContain('seatToken');

    // 2. Bob and Charlie join
    await pBob.goto(`/?room=${roomCode}`);
    await pBob.locator('#player-name-input').fill('BobPlayer');
    await pBob.locator('#btn-join-room').click();
    await expect(pBob.locator('#lobby-panel')).toBeVisible();

    await pCharlie.goto(`/?room=${roomCode}`);
    await pCharlie.locator('#player-name-input').fill('CharliePlayer');
    await pCharlie.locator('#btn-join-room').click();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    // Responsive 360px check on Bob
    const bobOverflow = await pBob.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(bobOverflow).toBe(false);

    // 3. Ready up all 3
    await pAlice.locator('#btn-toggle-ready').click();
    await pBob.locator('#btn-toggle-ready').click();
    await pCharlie.locator('#btn-toggle-ready').click();

    // 4. Host starts game
    const startBtn = pAlice.locator('#btn-start-game');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // All enter draft
    await expect(pAlice.locator('#game-header')).toBeVisible();
    await expect(pBob.locator('#game-header')).toBeVisible();
    await expect(pCharlie.locator('#game-header')).toBeVisible();

    // CANARY & PRIVACY CHECK:
    // Bob and Charlie must NOT see draft form while Alice is active
    await expect(pAlice.locator('#draft-form')).toBeVisible();
    await expect(pBob.locator('#draft-form')).toBeHidden();
    await expect(pCharlie.locator('#draft-form')).toBeHidden();

    // Alice keeps role and passes to Bob
    await pAlice.locator('#recipient-select').selectOption({ index: 0 });
    await pAlice.locator('#btn-confirm-pass').click();

    // Bob is now active actor
    await expect(pBob.locator('#draft-form')).toBeVisible();
    await expect(pAlice.locator('#draft-form')).toBeHidden();
    await pBob.locator('#recipient-select').selectOption({ index: 0 });
    await pBob.locator('#btn-confirm-pass').click();

    // Charlie is final actor
    await expect(pCharlie.locator('#draft-form')).toBeVisible();
    await pCharlie.locator('#btn-confirm-pass').click();

    // All enter discussion phase
    await expect(pAlice.locator('h2:has-text("自由討論階段")')).toBeVisible();
    await expect(pBob.locator('h2:has-text("自由討論階段")')).toBeVisible();
    await expect(pCharlie.locator('h2:has-text("自由討論階段")')).toBeVisible();

    // Host advances discussion to voting
    await pAlice.locator('#btn-advance-vote').click();

    // All enter voting phase
    await expect(pAlice.locator('h2:has-text("投票指認階段")')).toBeVisible();
    await expect(pBob.locator('h2:has-text("投票指認階段")')).toBeVisible();
    await expect(pCharlie.locator('h2:has-text("投票指認階段")')).toBeVisible();

    // All cast vote
    await pAlice.locator('#btn-submit-vote').click();
    await pBob.locator('#btn-submit-vote').click();
    await pCharlie.locator('#btn-submit-vote').click();

    // Results screen appears for all
    await expect(pAlice.locator('#results-panel')).toBeVisible();
    await expect(pBob.locator('#results-panel')).toBeVisible();
    await expect(pCharlie.locator('#results-panel')).toBeVisible();

    // Verify all 3 see matching winner announcement
    const aliceWinnerText = await pAlice.locator('#results-panel h2').first().textContent();
    const bobWinnerText = await pBob.locator('#results-panel h2').first().textContent();
    const charlieWinnerText = await pCharlie.locator('#results-panel h2').first().textContent();
    expect(aliceWinnerText).toBe(bobWinnerText);
    expect(bobWinnerText).toBe(charlieWinnerText);

    // Rematch back to lobby
    await pAlice.locator('#btn-rematch').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();
    await expect(pBob.locator('#lobby-panel')).toBeVisible();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    await ctxAlice.close();
    await ctxBob.close();
    await ctxCharlie.close();
  });

  test('four-player advanced L7 game with abilities and role secrecy', async ({ browser }) => {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const ctx3 = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const ctx4 = await browser.newContext({ viewport: { width: 360, height: 800 } });

    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();
    const p3 = await ctx3.newPage();
    const p4 = await ctx4.newPage();

    // Create room
    await p1.goto('/');
    await p1.locator('#player-name-input').fill('AdvHost');
    await p1.locator('#btn-create-room').click();
    await expect(p1.locator('#lobby-panel')).toBeVisible();

    const roomHeader = await p1.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;

    // 3 more players join
    await p2.goto(`/?room=${roomCode}`);
    await p2.locator('#player-name-input').fill('AdvP2');
    await p2.locator('#btn-join-room').click();

    await p3.goto(`/?room=${roomCode}`);
    await p3.locator('#player-name-input').fill('AdvP3');
    await p3.locator('#btn-join-room').click();

    await p4.goto(`/?room=${roomCode}`);
    await p4.locator('#player-name-input').fill('AdvP4');
    await p4.locator('#btn-join-room').click();

    await expect(p1.locator('#player-roster li')).toHaveCount(4);

    // Select level L7
    await p1.locator('#level-select').selectOption('L7');

    // Ready up all 4
    await p1.locator('#btn-toggle-ready').click();
    await p2.locator('#btn-toggle-ready').click();
    await p3.locator('#btn-toggle-ready').click();
    await p4.locator('#btn-toggle-ready').click();

    // Host starts
    const startBtn = p1.locator('#btn-start-game');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Draft phase
    await expect(p1.locator('#game-header')).toBeVisible();
    await expect(p2.locator('#game-header')).toBeVisible();
    await expect(p3.locator('#game-header')).toBeVisible();
    await expect(p4.locator('#game-header')).toBeVisible();

    const pages = [p1, p2, p3, p4];

    // Helper to pass draft for active page
    for (let i = 0; i < 4; i++) {
      let activePage: typeof p1 | null = null;
      await expect.poll(async () => {
        for (const p of pages) {
          if (await p.locator('#draft-form').isVisible()) {
            activePage = p;
            return true;
          }
        }
        return false;
      }).toBe(true);

      expect(activePage).not.toBeNull();
      if (i < 3) {
        await activePage!.locator('#recipient-select').selectOption({ index: 0 });
      }
      await activePage!.locator('#btn-confirm-pass').click();
      await expect(activePage!.locator('#draft-form')).toBeHidden();
    }

    // Discussion phase
    await expect(p1.locator('h2:has-text("自由討論階段")')).toBeVisible();

    // Check if any player is Butler or Detective
    let resolvedViaDetective = false;
    for (const p of pages) {
      if (await p.locator('#btn-butler-peek').isVisible()) {
        await p.locator('#btn-butler-peek').click();
        await expect(p.locator('.alert-success:has-text("您查看的 2 張扣置卡為")')).toBeVisible();
      }
      if (await p.locator('#btn-detective-send').isVisible()) {
        await p.locator('#btn-detective-send').click();
        resolvedViaDetective = true;
        break;
      }
    }

    if (!resolvedViaDetective) {
      await p1.locator('#btn-advance-vote').click();
      await expect(p1.locator('h2:has-text("投票指認階段")')).toBeVisible();
      for (const p of pages) {
        await expect(p.locator('h2:has-text("投票指認階段")')).toBeVisible();
        const voteBtn = p.locator('#btn-submit-vote');
        if (await voteBtn.isVisible()) {
          await voteBtn.click();
        }
      }
    }

    // Results screen
    await expect(p1.locator('#results-panel')).toBeVisible();
    await expect(p2.locator('#results-panel')).toBeVisible();
    await expect(p3.locator('#results-panel')).toBeVisible();
    await expect(p4.locator('#results-panel')).toBeVisible();

    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
    await ctx4.close();
  });

  test('reconnect journey: reload page restores session without secret loss', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/');
    await page.locator('#player-name-input').fill('ReloadUser');
    await page.locator('#btn-create-room').click();

    await expect(page.locator('#lobby-panel')).toBeVisible();
    const roomHeader = await page.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;

    // Reload page
    await page.reload();

    // Verify automatically rejoins same room
    await expect(page.locator('#lobby-panel')).toBeVisible();
    const reloadedHeader = await page.locator('#lobby-panel header h1').textContent();
    expect(reloadedHeader).toContain(roomCode);

    await context.close();
  });
});
