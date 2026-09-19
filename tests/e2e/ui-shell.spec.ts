import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('UI shell and accessible responsive foundation', () => {
  const viewports = [
    { name: 'mobile-360', width: 360, height: 800 },
    { name: 'desktop-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`smoke checks at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Document title and language
      await expect(page).toHaveTitle('目擊者之夜');
      const htmlLang = await page.locator('html').getAttribute('lang');
      expect(htmlLang).toBe('zh-Hant');

      // Skip link
      const skipLink = page.locator('a.skip-link');
      await expect(skipLink).toBeAttached();

      // Exactly one main element
      const mains = page.locator('main');
      await expect(mains).toHaveCount(1);

      // Persistent live region
      const liveRegion = page.locator('[role="status"][aria-live="polite"]');
      await expect(liveRegion).toHaveCount(1);
      await expect(liveRegion).toBeAttached();

      // All form controls have associated labels
      const inputs = page.locator('input:not([type="hidden"]), select, textarea');
      const inputCount = await inputs.count();
      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        const id = await input.getAttribute('id');
        expect(id).toBeTruthy();
        const label = page.locator(`label[for="${id}"]`);
        await expect(label).toBeAttached();
      }

      // No horizontal overflow: scrollWidth <= clientWidth
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth,
        };
      });
      expect(overflow.hasOverflow).toBe(false);

      // Visible focus after Tab
      await page.keyboard.press('Tab');
      const focusedElement = page.locator(':focus-visible');
      await expect(focusedElement).toBeAttached();

      // Capture screenshot for evidence
      const screenshotPath = path.join(evidenceDir, `task-4-ui-shell-${vp.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      expect(fs.existsSync(screenshotPath)).toBe(true);
    });
  }

  test('reduced motion disables CSS animations and transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const transitionDuration = await page.evaluate(() => {
      const btn = document.querySelector('button');
      if (!btn) return 'none';
      return window.getComputedStyle(btn).transitionDuration;
    });

    // When reduced motion is requested, transition duration should be 0s or <= 0.01s
    const durationNum = parseFloat(transitionDuration);
    expect(durationNum).toBeLessThanOrEqual(0.01);
  });

  test('failure scenario: submitting invalid form moves focus to inline role=alert and preserves input', async ({ page }) => {
    await page.goto('/');

    const input = page.locator('#player-name-input');
    await input.fill('ExistingText');

    // Trigger validation failure by submitting join without valid 6-char room code
    const submitBtn = page.locator('#btn-join-room');
    await submitBtn.click();

    // Focus must move to role=alert
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();

    // Existing input is preserved
    await expect(input).toHaveValue('ExistingText');
  });
});
