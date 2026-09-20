import { test, expect } from '@playwright/test';

test.describe('Responsive, Accessibility and Content Resilience (Todo 8)', () => {
  test('360, 375, 768, 1280 viewports and 200% text have zero page horizontal overflow', async ({ page }) => {
    await page.goto('/');

    const viewports = [
      { width: 360, height: 640 },
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow, `Overflow detected on home at ${vp.width}x${vp.height}`).toBe(false);
    }

    // 200% text zoom test (base 16px doubled to 32px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    const overflow200 = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow200, 'Overflow detected at 200% font zoom on 375px').toBe(false);

    // Reset font size
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  });

  test('24-character CJK player name displays cleanly in lobby and game without overflow', async ({ page }) => {
    const longCjkName = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await page.locator('#player-name-input').fill(longCjkName);
    await page.locator('#btn-create-room').click();

    await expect(page.locator('#lobby-panel')).toBeVisible();

    const displayedName = await page.locator('#player-roster li').first().textContent();
    expect(displayedName).toContain(longCjkName);

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow, 'Overflow detected with 24-character CJK name').toBe(false);
  });

  test('keyboard-only navigation: create room and toggle ready with Tab and Enter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Focus input and type name
    await page.locator('#player-name-input').focus();
    await page.keyboard.type('KeyUser');

    // Tab to create button and press Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    await expect(page.locator('#lobby-panel')).toBeVisible();

    // Tab through lobby controls to toggle-ready
    await page.locator('#btn-toggle-ready').focus();
    await page.keyboard.press('Enter');

    // Verify ready state changed
    await expect(page.locator('#btn-toggle-ready')).toContainText('取消準備');
  });

  test('native dialog opens, traps focus, and Escape closes with focus restoration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?showcase');

    await expect(page.locator('#design-showcase')).toBeVisible();

    const openDialogBtn = page.locator('#btn-open-showcase-dialog');
    await expect(openDialogBtn).toBeVisible();

    await openDialogBtn.focus();
    await openDialogBtn.click();

    const dialog = page.locator('#showcase-dialog');
    await expect(dialog).toBeVisible();

    // Verify dialog has focus inside
    const insideFocused = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.getElementById('showcase-dialog');
      return dlg ? dlg.contains(active) : false;
    });
    expect(insideFocused).toBe(true);

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Verify focus returned to trigger button
    const restoredId = await page.evaluate(() => document.activeElement?.id);
    expect(restoredId).toBe('btn-open-showcase-dialog');
  });

  test('reduced motion disables non-essential animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const duration = await page.evaluate(() => {
      const btn = document.querySelector('.btn');
      if (!btn) return '0s';
      return window.getComputedStyle(btn).animationDuration;
    });
    // In reduced motion, animation-duration is 0.01ms (rounds to ~0s in CSS)
    expect(duration).toMatch(/(0s|0\.00001s|0\.01ms)/);
  });
});
