/**
 * Fresh visual evidence for the discussion consent + voice UI at the three
 * required widths. Kept as a spec (not a one-off script) so the evidence can be
 * regenerated after future UI changes; every step waits on real state.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { completeDraft, startRoom, openGameMenu, closeGameMenu } from './draft-flow.ts';

const evidenceDir = path.resolve('.omo/evidence/discussion-voice');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

const WIDTHS = [375, 768, 1280] as const;

for (const width of WIDTHS) {
  test(`discussion consent, voice, and settings evidence at ${width}px`, async ({ browser }) => {
    test.setTimeout(60000);
    const { pages, contexts } = await startRoom(browser, ['主持愛麗絲', '玩家二號', '玩家三號'], {
      viewport: { width, height: 900 },
    });
    const [p1, p2, p3] = pages;

    try {
      await completeDraft(pages);
      await p1.locator('.table-action-dock .discussion-consent').waitFor();

      // 1. Default discussion: consent panel + voice panel (mic off).
      await p1.screenshot({
        path: path.join(evidenceDir, `discussion-${width}.png`),
        fullPage: true,
      });

      // 2. Mic enabled or its readable failure.
      await openGameMenu(p3);
      await p3.locator('#game-menu-content #btn-toggle-mic').click();
      await expect
        .poll(async () => {
          const pressed = await p3
            .locator('#game-menu-content #btn-toggle-mic')
            .getAttribute('aria-pressed');
          return pressed === 'true' || (await p3.locator('.voice-panel .alert-error').isVisible());
        })
        .toBe(true);
      await p3.screenshot({
        path: path.join(evidenceDir, `voice-state-${width}.png`),
        fullPage: true,
      });

      // 3. Persistent settings disclosure open.
      await openGameMenu(p2);
      await p2.locator('#btn-audio-settings').click();
      await expect(p2.locator('#settings-panel')).toHaveAttribute('open', '');
      await p2.screenshot({
        path: path.join(evidenceDir, `settings-${width}.png`),
        fullPage: true,
      });
      // Close the popover so it cannot overlay the dock at narrow widths.
      await p2.locator('#btn-audio-settings').click();
      await expect(p2.locator('#settings-panel')).not.toHaveAttribute('open', '');

      await closeGameMenu(p2);
      await closeGameMenu(p3);

      // 4. Strict-majority deadline: p3 sees progress 2/3 and the ticking countdown.
      await p1.locator('.table-action-dock #btn-advance-vote').click();
      await p2.locator('.table-action-dock #btn-advance-vote').click();
      await expect(p3.locator('.table-action-dock .discussion-countdown')).toContainText('剩餘');
      await expect(p3.locator('.table-action-dock .discussion-consent-progress')).toContainText(
        '2 / 3'
      );
      await p3.screenshot({
        path: path.join(evidenceDir, `consent-countdown-${width}.png`),
        fullPage: true,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}
