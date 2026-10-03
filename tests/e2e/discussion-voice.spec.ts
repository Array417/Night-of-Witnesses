import { test, expect } from '@playwright/test';
import { completeDraft, startRoom } from './draft-flow.ts';

test.describe('discussion voice panel', () => {
  test('mic defaults off, failures stay readable, and the consent flow keeps working', async ({ browser }) => {
    const { pages, contexts } = await startRoom(browser, ['愛麗絲', '鮑伯', '查理']);
    const [p1, p2, p3] = pages;

    try {
      await completeDraft(pages);
      await expect(p1.locator('.table-action-dock h2')).toHaveText('自由討論階段');

      const voiceWired = await p1.evaluate(() => Boolean(window.__NOW__?.client?.voice));
      test.skip(!voiceWired, 'voice controller not wired yet (parallel media agent owns client.voice)');

      const micBtn = p1.locator('.table-action-dock #btn-toggle-mic');
      await expect(micBtn).toBeVisible();
      await expect(micBtn).toHaveAttribute('aria-pressed', 'false');
      await expect(micBtn).toHaveText('開啟麥克風');

      // Enabling requests permission; either the mic opens or a readable error appears.
      await micBtn.click();
      await expect
        .poll(async () => {
          const pressed = await micBtn.getAttribute('aria-pressed');
          const errorVisible = await p1.locator('.voice-panel .alert-error').isVisible();
          return pressed === 'true' || errorVisible;
        })
        .toBe(true);
      if ((await micBtn.getAttribute('aria-pressed')) === 'true') {
        // Off is always possible, including after a successful request.
        await micBtn.click();
        await expect(micBtn).toHaveAttribute('aria-pressed', 'false');
      } else {
        await expect(p1.locator('.voice-panel .alert-error')).not.toBeEmpty();
      }

      // The game flow is unaffected: this player can still consent to end discussion.
      await p1.locator('.table-action-dock #btn-advance-vote').click();
      await expect(p1.locator('.table-action-dock .discussion-consent-progress')).toContainText(
        '1 / 3'
      );
      await p2.locator('.table-action-dock #btn-advance-vote').click();
      await p3.locator('.table-action-dock #btn-advance-vote').click();
      await expect(p1.locator('.table-action-dock h2')).toHaveText('投票指認階段');
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('discussion consent and voice controls clear the fixed audio shell at max scroll on 375', async ({ browser }) => {
    const { pages, contexts } = await startRoom(browser, ['愛麗絲', '鮑伯', '查理'], {
      viewport: { width: 375, height: 812 },
    });
    const page = pages[0];

    try {
      await completeDraft(pages);
      await expect(page.locator('.table-action-dock .discussion-consent')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

      const probe = await page.evaluate(() => {
        const shell = document.getElementById('audio-controls-shell');
        const voice = document.querySelector<HTMLElement>('.voice-panel');
        const consent = document.querySelector<HTMLElement>('.discussion-consent');
        if (!shell || !voice || !consent) throw new Error('dock or shell missing');
        const shellTop = shell.getBoundingClientRect().top;
        const consentRect = consent.getBoundingClientRect();
        const hit = document.elementFromPoint(
          consentRect.left + consentRect.width / 2,
          consentRect.top + consentRect.height / 2
        );
        return {
          voiceClearance: shellTop - voice.getBoundingClientRect().bottom,
          consentClearance: shellTop - consentRect.bottom,
          consentHitInside: hit !== null && consent.contains(hit),
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });

      expect(probe.voiceClearance).toBeGreaterThanOrEqual(8);
      expect(probe.consentClearance).toBeGreaterThanOrEqual(8);
      expect(probe.consentHitInside).toBe(true);
      expect(probe.pageOverflow).toBe(false);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
