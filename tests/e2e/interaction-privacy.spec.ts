import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { passToFirstEligible, passToGuestRoom, startRoom } from './draft-flow.ts';

const evidenceDir = path.resolve('.omo/evidence/final-f3-visual-qa');
fs.mkdirSync(evidenceDir, { recursive: true });

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
    await expect(pAlice.locator('#draft-controls')).toBeVisible();

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

    // Bob and Charlie must NOT have draft controls visible while Alice is actor
    await expect(pBob.locator('#draft-controls')).toBeHidden();
    await expect(pCharlie.locator('#draft-controls')).toBeHidden();

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

test.describe('Public testimony claim badge (F3 blocker B2)', () => {
  test('claim badge renders the zh-Hant role label from a public claim, never the raw role id', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    // L4 exposes a three-role public roster (murderer/bomber/guest), so one pass
    // per player covers every public role in this room.
    const { pages, contexts } = await startRoom(browser, ['ClaimHost', 'ClaimBob', 'ClaimCharlie'], {
      level: 'L4',
    });
    try {
      // A non-actor page: any badge here must come from the public projection.
      const observer = pages[2];

      // Given: the draft has started and no testimony has been made public yet.
      await expect(observer.locator('.table-panel')).toBeVisible();
      await expect(observer.locator('.claim-badge')).toHaveCount(0);
      for (const text of await observer.locator('.seat:not([aria-current="true"])').allTextContents()) {
        expect(text).not.toContain('聲稱');
      }
      await expect(observer.locator('.seat .card-back')).toHaveCount(2);
      for (const text of await observer.locator('.seat .card-back').allTextContents()) {
        expect(text).toBe('');
      }

      // When: every player passes while publicly claiming a different role.
      const claims = [
        { role: 'murderer', label: '兇手' },
        { role: 'bomber', label: '炸彈魔' },
        { role: 'guest', label: '房客' },
      ] as const;
      await passToFirstEligible(pages[0], claims[0].role);
      await passToFirstEligible(pages[1], claims[1].role);
      await passToGuestRoom(pages[2], claims[2].role);

      // Then: one zh-Hant badge per claim, in seat order, with no raw role id left.
      const badges = observer.locator('.seat .claim-badge');
      await expect(badges).toHaveCount(3);
      await expect(badges).toHaveText(claims.map((claim) => `聲稱：${claim.label}`));
      const badgeTexts = await badges.allTextContents();
      for (const text of badgeTexts) expect(text).not.toMatch(/[a-z_]/);

      // Glyph-level visibility probe: a code point counts as visible only when
      // its own Range rect is laid out and fully inside the badge's clip box,
      // so a text-overflow ellipsis (or a display:none prefix) is reported
      // honestly instead of trusting textContent. The body is inlined because
      // evaluateAll serializes it into the page.
      interface BadgeProbeRow {
        text: string;
        visibleText: string;
        scrollWidth: number;
        clientWidth: number;
        badgeWidth: number;
        seatWidth: number;
        seatAriaLabel: string;
      }
      // Geometry first, assertions second: a red run still leaves rectangles.
      const viewports = [
        { width: 1280, height: 800, compact: false },
        { width: 768, height: 1024, compact: false },
        { width: 375, height: 812, compact: true },
        { width: 360, height: 800, compact: true },
      ];
      const matrix: { viewport: (typeof viewports)[number]; rows: BadgeProbeRow[] }[] = [];
      for (const viewport of viewports) {
        await observer.setViewportSize({ width: viewport.width, height: viewport.height });
        matrix.push({
          viewport,
          rows: await badges.evaluateAll<BadgeProbeRow[], HTMLElement>((nodes) =>
            nodes.map((node) => {
              const badge = node as HTMLElement;
              const box = badge.getBoundingClientRect();
              const style = getComputedStyle(badge);
              const clipLeft = box.left + parseFloat(style.borderLeftWidth);
              const clipRight = box.right - parseFloat(style.borderRightWidth);
              const walker = document.createTreeWalker(badge, NodeFilter.SHOW_TEXT);
              const visible: string[] = [];
              let textNode = walker.nextNode();
              while (textNode) {
                const data = textNode.textContent ?? '';
                for (let index = 0; index < data.length; index += 1) {
                  const range = document.createRange();
                  range.setStart(textNode, index);
                  range.setEnd(textNode, index + 1);
                  const rect = range.getClientRects()[0];
                  if (
                    rect !== undefined &&
                    rect.width > 0.5 &&
                    rect.left >= clipLeft - 1 &&
                    rect.right <= clipRight + 1
                  ) {
                    visible.push(data.charAt(index));
                  }
                }
                textNode = walker.nextNode();
              }
              const seat = badge.closest('.seat');
              return {
                text: badge.textContent ?? '',
                visibleText: visible.join(''),
                scrollWidth: badge.scrollWidth,
                clientWidth: badge.clientWidth,
                badgeWidth: Math.round(box.width * 100) / 100,
                seatWidth: Math.round((seat?.getBoundingClientRect().width ?? 0) * 100) / 100,
                seatAriaLabel: seat?.getAttribute('aria-label') ?? '',
              };
            })
          ),
        });
        await observer.locator('.table-panel').screenshot({
          path: path.join(evidenceDir, `f3s-fix-claim-badge-${viewport.width}.png`),
        });
      }
      fs.writeFileSync(
        path.join(evidenceDir, 'f3s-fix-claim-badge-visibility.json'),
        JSON.stringify(matrix, null, 2)
      );

      for (const { viewport, rows } of matrix) {
        claims.forEach((claim, index) => {
          const row = rows[index];
          // The DOM keeps the full claim and the seat keeps it accessible...
          expect(row.text).toBe(`聲稱：${claim.label}`);
          expect(row.seatAriaLabel).toContain(`聲稱：${claim.label}`);
          expect(row.text).not.toMatch(/[a-z_]/);
          if (viewport.compact) {
            // ...while narrow seats show exactly the zh-Hant role, uncut.
            expect(row.visibleText).toBe(claim.label);
          } else {
            // Wide seats keep the full badge legible.
            expect(row.visibleText).toBe(`聲稱：${claim.label}`);
            expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
          }
        });
      }
    } finally {
      for (const context of contexts) await context.close();
    }
  });
});
