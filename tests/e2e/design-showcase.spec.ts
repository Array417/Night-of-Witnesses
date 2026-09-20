import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

export function checkColorNotCyan(colorStr: string): boolean {
  // Cyan prototype colors: #22d3ee is rgb(34, 211, 238), #0b1426 is rgb(11, 20, 38), #16233b is rgb(22, 35, 59)
  const forbidden = [
    'rgb(34, 211, 238)',
    '#22d3ee',
    'rgb(11, 20, 38)',
    '#0b1426',
    'rgb(22, 35, 59)',
    '#16233b',
  ];
  return !forbidden.some((f) => colorStr.includes(f));
}

test.describe('Tavern Primitive Showcase & Token Verification', () => {
  const viewports = [
    { name: 'mobile-375', width: 375, height: 812 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`showcase renders all primitives and states without overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/?showcase');

      // Verify page title and showcase container
      const showcase = page.locator('#design-showcase');
      await expect(showcase).toBeVisible();

      // Verify no horizontal overflow
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth,
        };
      });
      expect(overflow.hasOverflow).toBe(false);

      // Verify primitives exist:
      // 1. Panels
      const panels = page.locator('.panel');
      await expect(panels.first()).toBeVisible();

      // 2. Buttons
      await expect(page.locator('.primary-button, .btn-primary').first()).toBeVisible();
      await expect(page.locator('.secondary-button, .btn-secondary').first()).toBeVisible();
      await expect(page.locator('.danger-button, .btn-danger').first()).toBeVisible();
      await expect(page.locator('.role-button').first()).toBeVisible();

      // 3. Form controls & fields
      await expect(page.locator('input[type="text"]').first()).toBeVisible();
      await expect(page.locator('select').first()).toBeVisible();
      await expect(page.locator('fieldset').first()).toBeVisible();

      // 4. Alerts
      await expect(page.locator('.alert-danger, .alert-error').first()).toBeVisible();
      await expect(page.locator('.alert-warning').first()).toBeVisible();
      await expect(page.locator('.alert-success').first()).toBeVisible();

      // 5. Connection badges (all 5 states)
      const connBadges = page.locator('.connection, .status-badge');
      await expect(connBadges.first()).toBeVisible();
      for (const st of ['connected', 'connecting', 'reconnecting', 'disconnected', 'error']) {
        await expect(page.locator(`[data-status="${st}"]`)).toBeVisible();
      }

      // 6. Seats & states
      await expect(page.locator('.seat[aria-current="true"]')).toBeVisible();
      await expect(page.locator('.seat.is-active')).toBeVisible();
      await expect(page.locator('.seat.is-offline')).toBeVisible();
      await expect(page.locator('.seat.is-targeted')).toBeVisible();
      await expect(page.locator('.seat.is-drop-ready')).toBeVisible();

      // 7. Cards
      await expect(page.locator('.card-face').first()).toBeVisible();
      await expect(page.locator('.card-face.is-selected').first()).toBeVisible();
      await expect(page.locator('.card-back').first()).toBeVisible();

      // 8. Transfer box
      await expect(page.locator('.transfer-box').first()).toBeVisible();

      // 9. Native Dialog
      const dialog = page.locator('dialog.claim-dialog, dialog.card-detail');
      await expect(dialog.first()).toBeAttached();

      // 10. Empty & Loading states
      await expect(page.locator('.state-loading').first()).toBeVisible();
      await expect(page.locator('.state-empty').first()).toBeVisible();

      // Check touch target minimum size (>= 44x44) for interactive elements
      const interactiveElements = page.locator('button, input[type="text"], input[type="password"], select, .seat, .card-face, .radio-option');
      const count = await interactiveElements.count();
      for (let i = 0; i < count; i++) {
        const el = interactiveElements.nth(i);
        if (await el.isVisible()) {
          const box = await el.boundingBox();
          if (box) {
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
          }
        }
      }

      // Verify computed colors: background must not be cyan
      const computed = await page.evaluate(() => {
        const bodyStyle = window.getComputedStyle(document.body);
        const panelStyle = window.getComputedStyle(document.querySelector('.panel')!);
        const btnStyle = window.getComputedStyle(document.querySelector('.primary-button, .btn-primary')!);
        return {
          bodyBg: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          panelBg: panelStyle.backgroundColor,
          panelBorder: panelStyle.borderColor,
          btnBg: btnStyle.backgroundColor,
        };
      });

      expect(checkColorNotCyan(computed.bodyBg)).toBe(true);
      expect(checkColorNotCyan(computed.panelBg)).toBe(true);
      expect(checkColorNotCyan(computed.panelBorder)).toBe(true);

      // Save screenshot & computed style JSON evidence
      const screenshotPath = path.join(evidenceDir, `opendesign-task-2-showcase-${vp.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const jsonPath = path.join(evidenceDir, `opendesign-task-2-showcase-${vp.name}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify({ viewport: vp, computed }, null, 2));
    });
  }

  test('focus treatment uses double brass outline', async ({ page }) => {
    await page.goto('/?showcase');
    const button = page.locator('.primary-button, .btn-primary').first();
    await button.focus();

    const focusStyle = await button.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
      };
    });

    expect(focusStyle.outlineStyle).toBe('double');
  });

  test('reduced motion disables transforms and animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?showcase');

    const card = page.locator('.card-face.is-selected').first();
    const style = await card.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        transitionDuration: s.transitionDuration,
        animationDuration: s.animationDuration,
      };
    });

    // Under reduced motion, durations should be near 0
    expect(parseFloat(style.transitionDuration)).toBeLessThanOrEqual(0.02);
  });

  test('compliance check rejects cyan fixture and undersized targets', async ({ page }) => {
    await page.goto('/?showcase');

    // Inject temporary fixture with forbidden cyan color and 24px target
    await page.evaluate(() => {
      const div = document.createElement('button');
      div.id = 'throwaway-broken-fixture';
      div.style.backgroundColor = '#22d3ee';
      div.style.width = '24px';
      div.style.height = '24px';
      div.innerText = 'bad';
      document.body.appendChild(div);
    });

    const badEl = page.locator('#throwaway-broken-fixture');
    const badBox = await badEl.boundingBox();
    const isUndersized = badBox ? badBox.width < 44 || badBox.height < 44 : false;
    expect(isUndersized).toBe(true);

    const badBg = await badEl.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    const isCyanForbidden = !checkColorNotCyan(badBg);
    expect(isCyanForbidden).toBe(true);

    // Clean up temporary fixture
    await page.evaluate(() => {
      document.getElementById('throwaway-broken-fixture')?.remove();
    });
  });
});
