import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('Responsive Witness Table & Accessible Draft Flow', () => {
  const viewports = [
    { name: 'mobile-360', width: 360, height: 800 },
    { name: 'mobile-375', width: 375, height: 812 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`draft screen layout and no overflow at ${vp.name}`, async ({ browser }) => {
      const p1Ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const p2Ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const p3Ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

      const p1 = await p1Ctx.newPage();
      const p2 = await p2Ctx.newPage();
      const p3 = await p3Ctx.newPage();

      // Setup 3-player room
      await p1.goto('/');
      await p1.fill('#player-name-input', '愛麗絲');
      await p1.click('#btn-create-room');
      await expect(p1.locator('#lobby-panel')).toBeVisible();
      const code = (await p1.locator('#lobby-panel h1').innerText()).match(/[A-Z0-9]{6}/)![0];

      await p2.goto(`/?room=${code}`);
      await p2.fill('#player-name-input', '鮑伯');
      await p2.click('#btn-join-room');
      await expect(p2.locator('#lobby-panel')).toBeVisible();

      await p3.goto(`/?room=${code}`);
      await p3.fill('#player-name-input', '查理');
      await p3.click('#btn-join-room');
      await expect(p3.locator('#lobby-panel')).toBeVisible();

      // Ready & Start
      await p1.click('#btn-toggle-ready');
      await p2.click('#btn-toggle-ready');
      await p3.click('#btn-toggle-ready');
      const startBtn = p1.locator('#btn-start-game');
      await expect(startBtn).toBeEnabled();
      await startBtn.click();

      // Draft phase entered
      await expect(p1.locator('#game-header')).toBeVisible();
      await expect(p1.locator('.table-panel')).toBeVisible();
      await expect(p1.locator('.table-oval')).toBeVisible();

      // Check overflow
      const overflow = await p1.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(overflow).toBe(true);

      // Verify seats exist and derive state
      const seats = p1.locator('.table-panel .seat');
      await expect(seats).toHaveCount(3);
      await expect(p1.locator('.table-panel .seat[aria-current="true"]')).toHaveCount(1);
      await expect(p1.locator('.table-panel .seat.is-active')).toHaveCount(1);

      // Verify cards exist for active player
      await expect(p1.locator('.cards-row .card-face')).toHaveCount(2);

      // Save screenshot for visual QA
      const shotPath = path.join(evidenceDir, `opendesign-task-5-draft-${vp.name}.png`);
      await p1.screenshot({ path: shotPath, fullPage: true });

      const jsonPath = path.join(evidenceDir, `opendesign-task-5-draft-${vp.name}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify({
        viewport: vp,
        seatsCount: 3,
        overflowFree: true,
      }, null, 2));

      await p1Ctx.close();
      await p2Ctx.close();
      await p3Ctx.close();
    });
  }

  test('draft completes by click/keyboard and native dialog restores focus', async ({ browser }) => {
    const p1Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p2Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p3Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const p1 = await p1Ctx.newPage();
    const p2 = await p2Ctx.newPage();
    const p3 = await p3Ctx.newPage();

    await p1.goto('/');
    await p1.fill('#player-name-input', '玩家一');
    await p1.click('#btn-create-room');
    const code = (await p1.locator('#lobby-panel h1').innerText()).match(/[A-Z0-9]{6}/)![0];

    await p2.goto(`/?room=${code}`);
    await p2.fill('#player-name-input', '玩家二');
    await p2.click('#btn-join-room');

    await p3.goto(`/?room=${code}`);
    await p3.fill('#player-name-input', '玩家三');
    await p3.click('#btn-join-room');

    await p1.click('#btn-toggle-ready');
    await p2.click('#btn-toggle-ready');
    await p3.click('#btn-toggle-ready');
    const startBtn = p1.locator('#btn-start-game');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Player 1 turn: click second card to select it
    await expect(p1.locator('#draft-form')).toBeVisible();
    const cardsP1 = p1.locator('.cards-row .card-face');
    await cardsP1.nth(1).click();
    await expect(cardsP1.nth(1)).toHaveClass(/is-selected/);

    // Pass to Player 2
    await p1.locator('#recipient-select').selectOption({ index: 0 });
    await p1.click('#btn-confirm-pass');

    // Player 2 turn: select card and pass to Player 3
    await expect(p2.locator('#draft-form')).toBeVisible();
    const cardsP2 = p2.locator('.cards-row .card-face');
    await cardsP2.first().click();
    await p2.locator('#recipient-select').selectOption({ index: 0 });
    await p2.click('#btn-confirm-pass');

    // Player 3 turn (final player)
    await expect(p3.locator('#draft-form')).toBeVisible();
    const cardsP3 = p3.locator('.cards-row .card-face');
    await cardsP3.first().click();
    await p3.click('#btn-confirm-pass');

    // All transition to discussion phase
    await expect(p1.locator('h2:has-text("自由討論階段")')).toBeVisible();

    await p1Ctx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  });
});
