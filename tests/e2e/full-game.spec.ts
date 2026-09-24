import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { passToFirstEligible, passToGuestRoom, openGameMenu, closeGameMenu } from './draft-flow.ts';

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

    // All enter draft; the table surface is visible on every viewport.
    await expect(pAlice.locator('#game-header')).toBeVisible();
    await expect(pBob.locator('.table-panel')).toBeVisible();
    await expect(pCharlie.locator('.table-panel')).toBeVisible();

    // CANARY & PRIVACY CHECK:
    // Bob and Charlie must NOT see draft controls while Alice is active
    await openGameMenu(pAlice);
    await expect(pAlice.locator('#draft-controls')).toBeVisible();
    await expect(pBob.locator('#draft-controls')).toBeHidden();
    await expect(pCharlie.locator('#draft-controls')).toBeHidden();
    await closeGameMenu(pAlice);

    // Alice keeps role and passes to Bob, Bob to Charlie, Charlie to the Guest Room.
    await passToFirstEligible(pAlice);

    // Bob is now active actor
    await openGameMenu(pBob);
    await expect(pBob.locator('#draft-controls')).toBeVisible();
    await expect(pAlice.locator('#draft-controls')).toBeHidden();
    await closeGameMenu(pBob);
    await passToFirstEligible(pBob);

    // Charlie is final actor
    await openGameMenu(pCharlie);
    await expect(pCharlie.locator('#draft-controls')).toBeVisible();
    await closeGameMenu(pCharlie);
    await passToGuestRoom(pCharlie);

    // All enter discussion phase; controls live in the table action dock on every viewport.
    await expect(pAlice.locator('.table-action-dock h2')).toHaveText('自由討論階段');
    await expect(pBob.locator('.table-action-dock h2')).toHaveText('自由討論階段');
    await expect(pCharlie.locator('.table-action-dock h2')).toHaveText('自由討論階段');

    // Host advances discussion to voting from the dock
    await pAlice.locator('.table-action-dock #btn-advance-vote').click();

    // All enter voting phase; the dock survives the projection rerender.
    await expect(pAlice.locator('.table-action-dock h2')).toHaveText('投票指認階段');
    await expect(pBob.locator('.table-action-dock h2')).toHaveText('投票指認階段');
    await expect(pCharlie.locator('.table-action-dock h2')).toHaveText('投票指認階段');

    // All cast vote from the dock form
    await pAlice.locator('.table-action-dock #btn-submit-vote').click();
    await pBob.locator('.table-action-dock #btn-submit-vote').click();
    await pCharlie.locator('.table-action-dock #btn-submit-vote').click();

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

    // Canonical reveal table: one seat and card per player plus the Guest Room card,
    // all flipped together by one table-level `.is-revealed` class.
    const revealTable = pAlice.locator('.results-reveal');
    await expect(revealTable).toHaveClass(/is-revealed/);
    await expect(revealTable.locator('.seat')).toHaveCount(3);
    await expect(revealTable.locator('.result-card[data-player-id]')).toHaveCount(3);
    await expect(revealTable.locator('.results-guest-room .result-card')).toHaveCount(1);

    // Rematch back to lobby
    await pAlice.locator('#btn-rematch').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();
    await expect(pBob.locator('#lobby-panel')).toBeVisible();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    // No stale revealed table survives the rematch rerender on any client.
    for (const page of [pAlice, pBob, pCharlie]) {
      await expect(page.locator('.results-reveal')).toHaveCount(0);
    }

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

    // Draft phase; the table surface is the visible signal on drawer viewports.
    await expect(p1.locator('#game-header')).toBeVisible();
    await expect(p2.locator('.table-panel')).toBeVisible();
    await expect(p3.locator('.table-panel')).toBeVisible();
    await expect(p4.locator('.table-panel')).toBeVisible();

    const pages = [p1, p2, p3, p4];

    // Helper to pass draft for the active page; the last actor uses the Guest Room.
    // The viewer's own seat carries both `aria-current` and `is-active` only on the actor's page,
    // which stays visible on every viewport even while the menu drawer is closed.
    for (let i = 0; i < 4; i++) {
      let activePage: typeof p1 | null = null;
      await expect.poll(async () => {
        for (const p of pages) {
          if ((await p.locator('.table-panel .seat[aria-current="true"].is-active').count()) > 0) {
            activePage = p;
            return true;
          }
        }
        return false;
      }).toBe(true);

      expect(activePage).not.toBeNull();
      if (i < 3) {
        await passToFirstEligible(activePage!);
      } else {
        await passToGuestRoom(activePage!);
      }
      await expect(activePage!.locator('#draft-controls')).toBeHidden();
    }

    // Discussion phase; ability controls now live in the table action dock.
    await expect(p1.locator('.table-action-dock h2')).toHaveText('自由討論階段');

    // Check if any player is Butler or Detective; their controls render in the dock.
    let resolvedViaDetective = false;
    for (const p of pages) {
      if (await p.locator('.table-action-dock #btn-butler-peek').isVisible()) {
        await p.locator('.table-action-dock #btn-butler-peek').click();
        await expect(p.locator('.table-action-dock .alert-success:has-text("您查看的 2 張扣置卡為")')).toBeVisible();
      }
      if (await p.locator('.table-action-dock #btn-detective-send').isVisible()) {
        await p.locator('.table-action-dock #btn-detective-send').click();
        resolvedViaDetective = true;
        break;
      }
    }

    if (!resolvedViaDetective) {
      await p1.locator('.table-action-dock #btn-advance-vote').click();
      // Every client must observe voting before any ballot is cast; a peeking Butler
      // abstains, so the round can resolve on the third vote and the last page would
      // otherwise race straight past this heading.
      for (const p of pages) {
        await expect(p.locator('.table-action-dock h2')).toHaveText('投票指認階段');
      }
      for (const p of pages) {
        const voteBtn = p.locator('.table-action-dock #btn-submit-vote');
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

    // Four player seats plus the Guest Room card all reveal on the canonical table.
    await expect(p1.locator('.results-reveal .seat')).toHaveCount(4);
    await expect(p1.locator('.results-reveal .result-card')).toHaveCount(5);

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
