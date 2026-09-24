import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FACTIONS, ROLES, ROLE_DETAILS } from '../../src/shared/rules.ts';

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

/** Role labels and hidden card identifiers that must never leak into opponent surfaces. */
export const SECRET_MARKERS = [
  '兇手',
  '共犯',
  '炸彈魔',
  '律師',
  '富豪',
  '偵探',
  '管家',
  '房客',
  'own-card-1',
  'own-card-2',
] as const;

/** Returns every secret string found in the given HTML fragment. Empty array means privacy-clean. */
export function findPrivacyLeaks(html: string, secrets: readonly string[]): string[] {
  return secrets.filter((secret) => html.includes(secret));
}

test.describe('Tavern Primitive Showcase & Token Verification', () => {
  const viewports = [
    { name: 'narrow-360', width: 360, height: 800 },
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

      // 6. Game menu expanded/collapsed rail
      const menu = page.locator('#game-menu');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('data-state', 'expanded');
      await expect(menu.locator('.game-menu-label').first()).toBeVisible();
      const menuToggle = page.locator('#btn-toggle-game-menu');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(menuToggle).toHaveAttribute('aria-controls', 'game-menu-content');
      await menuToggle.click();
      await expect(menu).toHaveAttribute('data-state', 'collapsed');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(menu.locator('.game-menu-label').first()).toBeHidden();
      await expect
        .poll(async () => menu.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
        .toBe(64);
      const collapsedWidth = await menu.evaluate((el) => Math.round(el.getBoundingClientRect().width));
      await menuToggle.click();
      await expect(menu).toHaveAttribute('data-state', 'expanded');
      await expect
        .poll(async () => menu.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
        .toBeGreaterThanOrEqual(240);
      const expandedWidth = await menu.evaluate((el) => Math.round(el.getBoundingClientRect().width));
      expect(expandedWidth).toBeLessThanOrEqual(300);
      await expect(menu.locator('.game-menu-label').first()).toBeVisible();

      // 7. Canonical ring seats (getTableSeats 45x38 oval), Guest Room target, action dock
      const seats = page.locator('#showcase-ring .seat');
      await expect(seats).toHaveCount(5);
      await expect(page.locator('#showcase-ring .seat[aria-current="true"]')).toHaveCount(1);
      await expect(page.locator('#showcase-ring .seat.is-active')).toHaveCount(1);
      await expect(page.locator('#showcase-ring .seat.is-offline')).toHaveCount(1);
      await expect(page.locator('#showcase-ring .seat.is-targeted')).toHaveCount(1);
      await expect(page.locator('#showcase-ring .seat.is-drop-ready')).toHaveCount(1);

      const viewerSeat = page.locator('#showcase-ring .seat[aria-current="true"]');
      const viewerX = parseFloat(
        await viewerSeat.evaluate((el) => getComputedStyle(el).getPropertyValue('--seat-x').trim())
      );
      const viewerY = parseFloat(
        await viewerSeat.evaluate((el) => getComputedStyle(el).getPropertyValue('--seat-y').trim())
      );
      expect(viewerX).toBe(50);
      expect(viewerY).toBe(88);

      const nextSeat = page.locator('#showcase-ring .seat[data-relative-index="1"]');
      const nextX = parseFloat(
        await nextSeat.evaluate((el) => getComputedStyle(el).getPropertyValue('--seat-x').trim())
      );
      const nextY = parseFloat(
        await nextSeat.evaluate((el) => getComputedStyle(el).getPropertyValue('--seat-y').trim())
      );
      const expectedNextX = Math.round((50 + 45 * Math.cos((18 * Math.PI) / 180)) * 100) / 100;
      const expectedNextY = Math.round((50 + 38 * Math.sin((18 * Math.PI) / 180)) * 100) / 100;
      expect(nextX).toBe(expectedNextX);
      expect(nextY).toBe(expectedNextY);

      const seatCount = await seats.count();
      for (let i = 0; i < seatCount; i++) {
        const box = await seats.nth(i).boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }

      const guestRoom = page.locator('[data-target-id="guest-room"]');
      await expect(guestRoom).toBeVisible();
      const guestRoomBox = await guestRoom.boundingBox();
      expect(guestRoomBox).not.toBeNull();
      if (guestRoomBox) {
        expect(guestRoomBox.width).toBeGreaterThanOrEqual(44);
        expect(guestRoomBox.height).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator('.table-action-dock')).toBeVisible();

      // 8. Own face / opponent back privacy
      await expect(page.locator('.card-face[data-hand="viewer"]')).toHaveCount(2);
      const opponentBack = page.locator('.card-back[data-owner="opponent"]');
      await expect(opponentBack).toHaveCount(1);
      await expect(opponentBack).toHaveAttribute('aria-label', '玩家的隱藏卡牌');

      // Opponent backs expose only generic back information: no secret text, no
      // role/card attributes, no title, and no drag payload on dragstart.
      const opponentBackProbe = await opponentBack.evaluate((node) => {
        const transfer = new DataTransfer();
        node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        return {
          attrs: node.getAttributeNames().sort(),
          text: node.textContent ?? '',
          title: node.getAttribute('title'),
          draggable: node.getAttribute('draggable'),
          dragged: transfer.getData('text/plain'),
        };
      });
      expect(opponentBackProbe.attrs).toEqual(['aria-label', 'class', 'data-owner', 'role']);
      expect(opponentBackProbe.text).toBe('');
      expect(opponentBackProbe.title).toBeNull();
      expect(opponentBackProbe.draggable).toBeNull();
      expect(opponentBackProbe.dragged).toBe('');
      await expect(page.locator('.transfer-box')).toBeVisible();

      // Own faces render role labels from viewer data only.
      const ownFaces = page.locator('.card-face[data-hand="viewer"]');
      await expect(ownFaces.first().locator('.card-role')).toHaveText(ROLES.detective.label);
      await expect(ownFaces.nth(1).locator('.card-role')).toHaveText(ROLES.butler.label);

      // Every own card carries its own separate >=44px detail trigger.
      const perCardTriggers = page.locator(
        '.card-face[data-hand="viewer"] [data-action="view-card"]'
      );
      await expect(perCardTriggers).toHaveCount(2);
      for (let i = 0; i < 2; i++) {
        const box = await perCardTriggers.nth(i).boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }

      const opponentHtml = await page
        .locator('#showcase-ring .seat[data-player-id]:not([aria-current="true"])')
        .evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'));
      const opponentLeaks = findPrivacyLeaks(opponentHtml, SECRET_MARKERS);
      expect(opponentLeaks).toEqual([]);

      const backsHtml = await page
        .locator('.card-back')
        .evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'));
      const backLeaks = findPrivacyLeaks(backsHtml, SECRET_MARKERS);
      expect(backLeaks).toEqual([]);

      // 9. Native dialogs: content from ROLES/FACTIONS/ROLE_DETAILS, conditional pass, focus return
      await expect(page.locator('dialog.claim-dialog, dialog.card-detail').first()).toBeAttached();
      await expect(page.locator('#card-detail-dialog')).toBeAttached();
      await expect(page.locator('#claim-dialog')).toBeAttached();

      const detailDialog = page.locator('#card-detail-dialog');
      const detailTrigger = page.locator('[data-action="view-card"]').first();
      await detailTrigger.click();
      await expect(detailDialog).toBeVisible();
      await expect(detailDialog.locator('#card-detail-title')).toHaveText(ROLES.detective.label);
      await expect(detailDialog.locator('.card-detail-faction')).toHaveText(
        `陣營：${FACTIONS.witness_faction.label}`
      );
      await expect(detailDialog.locator('.card-detail-list dd').nth(0)).toHaveText(
        ROLE_DETAILS.detective.objective
      );
      await expect(detailDialog.locator('.card-detail-list dd').nth(1)).toHaveText(
        ROLE_DETAILS.detective.ability
      );
      await expect(detailDialog.locator('#btn-pass-card')).toBeVisible();
      // Focus lands on the dialog heading, not the page behind it.
      await expect(detailDialog.locator('#card-detail-title')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(detailDialog).toBeHidden();
      await expect(detailTrigger).toBeFocused();

      // A card whose pass is not legal exposes no pass control.
      const readOnlyTrigger = page.locator('#btn-open-readonly-detail');
      await readOnlyTrigger.click();
      await expect(detailDialog).toBeVisible();
      await expect(detailDialog.locator('#card-detail-title')).toHaveText(ROLES.guest.label);
      await expect(detailDialog.locator('#btn-pass-card')).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(detailDialog).toBeHidden();
      await expect(readOnlyTrigger).toBeFocused();

      // Desktop: focusing an own card and pressing Enter opens its detail; Escape restores the card.
      const enterCard = ownFaces.first();
      await enterCard.focus();
      await expect(enterCard).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(detailDialog).toBeVisible();
      await expect(detailDialog.locator('#card-detail-title')).toHaveText(ROLES.detective.label);
      await page.keyboard.press('Escape');
      await expect(detailDialog).toBeHidden();
      await expect(enterCard).toBeFocused();

      await page.locator('#btn-open-claim-dialog').click();
      await expect(page.locator('#claim-dialog')).toBeVisible();
      await expect(page.locator('#claim-role-select')).toBeVisible();
      // No-claim option plus every role in publicRoleRoster (all eight roles in the showcase harness).
      await expect(page.locator('#claim-role-select option')).toHaveCount(9);
      const confirmBtn = page.locator('#btn-confirm-pass');
      await confirmBtn.click();
      await expect(page.locator('#claim-dialog')).toHaveAttribute('data-state', 'pending');
      await expect(confirmBtn).toBeDisabled();
      await expect(confirmBtn).toHaveAttribute('aria-busy', 'true');
      await page.locator('#btn-cancel-pass').click();
      await expect(page.locator('#claim-dialog')).toBeHidden();
      await expect(confirmBtn).toBeEnabled();

      // 10. Result reveal pre/post with one table-level class and result-only fronts
      const resultTable = page.locator('#showcase-result-table');
      await expect(resultTable).not.toHaveClass(/is-revealed/);
      const resultCards = resultTable.locator('.result-card');
      await expect(resultCards).toHaveCount(4);
      const resultFaces = resultTable.locator('.result-card .card-face');
      const resultFaceCount = await resultFaces.count();
      expect(resultFaceCount).toBe(4);
      for (let i = 0; i < resultFaceCount; i++) {
        await expect(resultFaces.nth(i)).toBeHidden();
      }
      // Pre-reveal every result card is a generic back with no secret data.
      const resultBacksHtml = await resultTable
        .locator('.result-card .card-back')
        .evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'));
      expect(findPrivacyLeaks(resultBacksHtml, SECRET_MARKERS)).toEqual([]);

      const expectedResultLabels = [
        ROLES.murderer.label,
        ROLES.accomplice.label,
        ROLES.detective.label,
        ROLES.guest.label,
      ];
      const revealButton = page.locator('#btn-showcase-reveal');
      await revealButton.click();
      await expect(resultTable).toHaveClass(/is-revealed/);
      for (let i = 0; i < resultFaceCount; i++) {
        await expect(resultFaces.nth(i)).toBeVisible();
        await expect(resultFaces.nth(i).locator('.card-role')).toHaveText(expectedResultLabels[i]);
      }
      await revealButton.click();
      await expect(resultTable).not.toHaveClass(/is-revealed/);
      for (let i = 0; i < resultFaceCount; i++) {
        await expect(resultFaces.nth(i)).toBeHidden();
      }

      // 11. Empty & Loading states
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
      const screenshotPath = path.join(
        evidenceDir,
        `task-1-game-table-interaction-redesign-showcase-${vp.name}.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const jsonPath = path.join(
        evidenceDir,
        `task-1-game-table-interaction-redesign-showcase-${vp.name}.json`
      );
      fs.writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            viewport: vp,
            computed,
            overflow,
            menu: { collapsedWidth, expandedWidth },
            ring: { viewerX, viewerY, nextX, nextY, seatCount },
            guestRoomBox,
            privacy: { opponentLeaks, backLeaks, opponentBackProbe },
            cardDetail: {
              triggerCount: 2,
              passableRole: ROLES.detective.id,
              readOnlyRole: ROLES.guest.id,
              passHiddenForReadOnly: true,
            },
            dialogs: { cardDetailTrigger: '#card-detail-dialog', claimDialog: '#claim-dialog' },
            resultReveal: {
              pre: 'hidden',
              post: 'visible',
              cardCount: resultFaceCount,
              labels: expectedResultLabels,
            },
          },
          null,
          2
        )
      );
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

  test('reduced motion disables transforms and renders the result reveal instantly', async ({ page }) => {
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

    // The simultaneous reveal must fall back to an instant face render.
    const resultFace = page.locator('#showcase-result-table .result-card .card-face').first();
    await expect(resultFace).toBeHidden();
    await page.locator('#btn-showcase-reveal').click();
    await expect(resultFace).toBeVisible();
    const revealStyle = await resultFace.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { transitionDuration: s.transitionDuration, opacity: s.opacity };
    });
    expect(parseFloat(revealStyle.transitionDuration)).toBeLessThanOrEqual(0.02);
    await expect
      .poll(async () => resultFace.evaluate((el) => Number(window.getComputedStyle(el).opacity)))
      .toBe(1);
  });

  test('compliance check rejects cyan, undersized, and privacy-leaking fixtures', async ({ page }) => {
    await page.goto('/?showcase');

    // Inject throwaway fixtures: forbidden cyan + 24px target + an opponent face leaking a secret.
    await page.evaluate(() => {
      const broken = document.createElement('button');
      broken.id = 'throwaway-broken-fixture';
      broken.style.backgroundColor = '#22d3ee';
      broken.style.width = '24px';
      broken.style.height = '24px';
      broken.innerText = 'bad';
      document.body.appendChild(broken);

      const leak = document.createElement('div');
      leak.id = 'throwaway-leak-fixture';
      leak.className = 'seat';
      leak.setAttribute('data-player-id', 'opponent-x');
      leak.innerHTML =
        '<span class="card-face" data-hand="opponent">兇手</span><span data-card-id="own-card-1">own-card-1</span>';
      document.body.appendChild(leak);
    });

    const badEl = page.locator('#throwaway-broken-fixture');
    const badBox = await badEl.boundingBox();
    const isUndersized = badBox ? badBox.width < 44 || badBox.height < 44 : false;
    expect(isUndersized).toBe(true);

    const badBg = await badEl.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    const isCyanForbidden = !checkColorNotCyan(badBg);
    expect(isCyanForbidden).toBe(true);

    const leakHtml = await page.locator('#throwaway-leak-fixture').evaluate((el) => el.outerHTML);
    const rejectedLeaks = findPrivacyLeaks(leakHtml, SECRET_MARKERS);
    expect(rejectedLeaks.length).toBeGreaterThan(0);
    expect(rejectedLeaks).toContain('兇手');
    expect(rejectedLeaks).toContain('own-card-1');

    // Real opponent surfaces must remain clean under the same helper.
    await expect(page.locator('#showcase-ring .seat')).toHaveCount(5);
    const realOpponentHtml = await page
      .locator('#showcase-ring .seat[data-player-id]:not([aria-current="true"])')
      .evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'));
    expect(findPrivacyLeaks(realOpponentHtml, SECRET_MARKERS)).toEqual([]);

    const negativePath = path.join(
      evidenceDir,
      'task-1-game-table-interaction-redesign-negative.json'
    );
    fs.writeFileSync(
      negativePath,
      JSON.stringify(
        {
          undersizedDetected: isUndersized,
          cyanDetected: isCyanForbidden,
          privacyLeaksRejected: rejectedLeaks,
          realOpponentSurfacesClean: true,
        },
        null,
        2
      )
    );

    // Clean up temporary fixtures
    await page.evaluate(() => {
      document.getElementById('throwaway-broken-fixture')?.remove();
      document.getElementById('throwaway-leak-fixture')?.remove();
    });
  });
});
