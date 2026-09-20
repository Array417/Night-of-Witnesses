import { test, expect } from '@playwright/test';

test.describe('Interaction, Audio Persistence and Privacy Contracts (Todo 8)', () => {
  test('audio settings persist in localStorage and update manager state', async ({ page }) => {
    await page.goto('/');

    // Check default preferences stored or initial state
    await page.locator('#btn-audio-mute').click();
    const isMuted = await page.evaluate(() => {
      const raw = localStorage.getItem('night-of-witnesses.audio.v1');
      return raw ? JSON.parse(raw).muted : null;
    });
    expect(isMuted).toBe(true);

    // Reload page and verify settings persisted
    await page.reload();
    const persistedMuted = await page.evaluate(() => {
      const raw = localStorage.getItem('night-of-witnesses.audio.v1');
      return raw ? JSON.parse(raw).muted : null;
    });
    expect(persistedMuted).toBe(true);
  });

  test('visible connection status badge reflects connection state', async ({ page }) => {
    await page.goto('/');

    const badge = page.locator('#connection-status-badge');
    await expect(badge).toBeVisible();

    // After connecting, data-status should be connected
    await expect(badge).toHaveAttribute('data-status', 'connected');
    const badgeText = await badge.textContent();
    expect(badgeText).toContain('已連線');
  });

  test('three-client zero-leak privacy audit: opponent role and card never exist in DOM', async ({ browser }) => {
    const ctxAlice = await browser.newContext();
    const ctxBob = await browser.newContext();
    const ctxCharlie = await browser.newContext();

    const pAlice = await ctxAlice.newPage();
    const pBob = await ctxBob.newPage();
    const pCharlie = await ctxCharlie.newPage();

    // Alice creates room
    await pAlice.goto('/');
    await pAlice.locator('#player-name-input').fill('AlicePrivacyHost');
    await pAlice.locator('#btn-create-room').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();

    const roomHeader = await pAlice.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;

    // Bob and Charlie join
    for (const [p, name] of [[pBob, 'BobAudit'], [pCharlie, 'CharlieAudit']] as const) {
      await p.goto(`/?room=${roomCode}`);
      await p.locator('#player-name-input').fill(name);
      await p.locator('#btn-join-room').click();
      await expect(p.locator('#lobby-panel')).toBeVisible();
    }

    // Ready and start
    await pAlice.locator('#btn-toggle-ready').click();
    await pBob.locator('#btn-toggle-ready').click();
    await pCharlie.locator('#btn-toggle-ready').click();
    await pAlice.locator('#btn-start-game').click();

    // Alice enters draft and sees her own cards
    await expect(pAlice.locator('#draft-form')).toBeVisible();

    // Get Alice's own secret role from the role disclosure button
    const aliceRoleText = await pAlice.locator('#btn-toggle-role').textContent();
    const aliceSecretRole = aliceRoleText?.replace('查看身分：', '').trim();

    if (aliceSecretRole) {
      // Bob and Charlie DOM must NOT contain Alice's secret role
      const bobHtml = await pBob.content();
      const charlieHtml = await pCharlie.content();
      expect(bobHtml).not.toContain(`【${aliceSecretRole}】`);
      expect(charlieHtml).not.toContain(`【${aliceSecretRole}】`);
    }

    // Bob and Charlie must NOT have draft-form visible while Alice is actor
    await expect(pBob.locator('#draft-form')).toBeHidden();
    await expect(pCharlie.locator('#draft-form')).toBeHidden();

    // Check Bob's rendered seats: none of other seats expose card names
    const bobSeatTexts = await pBob.locator('.seat:not([aria-current="true"])').allTextContents();
    for (const text of bobSeatTexts) {
      expect(text).not.toContain('身分牌');
      expect(text).not.toContain('手牌：');
    }

    await ctxAlice.close();
    await ctxBob.close();
    await ctxCharlie.close();
  });
});
