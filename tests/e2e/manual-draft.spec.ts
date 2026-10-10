import { test, expect } from '@playwright/test';
import { startRoom, handCards, armCard, firstSeatTarget, confirmClaim, closeGameMenu } from './draft-flow.ts';

test('manual draws and transfers are visible to all seats with private card faces', async ({ browser }, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile');
  const { pages, contexts } = await startRoom(browser, ['抽牌甲', '抽牌乙', '抽牌丙'], {
    drawFirstHand: false,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    contextOptions: () => mobile ? { isMobile: true, hasTouch: true } : {},
  });
  try {
    const [sender, receiver, observer] = pages;
    const ids = await Promise.all(pages.map(p => p.evaluate(() => window.__NOW__!.client.getProjection()!.viewerId)));
    await expect(handCards(sender)).toHaveCount(0);
    await expect(observer.locator('.seat-card .card-back')).toHaveCount(0);
    for (let i = 0; i < 2; i++) {
      await expect(sender.locator('#draw-pile')).toBeEnabled();
      await sender.locator('#draw-pile').click();
      await expect(observer.locator('.card-motion')).toHaveAttribute('data-face', 'back');
      await expect(sender.locator('.card-motion')).toHaveAttribute('data-face', 'front');
      await expect(handCards(sender)).toHaveCount(i + 1);
      await expect(observer.locator(`.seat[data-player-id="${ids[0]}"] .card-back`)).toHaveCount(i + 1);
    }
    await expect(sender.locator('.hand-slot .card-kicker, .hand-slot .card-action')).toHaveCount(0);
    await armCard(sender);
    await closeGameMenu(sender);
    await firstSeatTarget(sender).click();
    await expect(sender.locator('#claim-role-select option[value=""]')).toHaveCount(0);
    await confirmClaim(sender, 'guest');
    await expect(sender.locator('.card-motion')).toHaveAttribute('data-face', 'front');
    await expect(receiver.locator('.card-motion')).toHaveAttribute('data-face', 'front');
    await expect(observer.locator('.card-motion')).toHaveAttribute('data-face', 'back');
    await expect(receiver.locator('#draw-pile')).toBeDisabled();
    await expect(handCards(receiver)).toHaveCount(1);
    await expect(receiver.locator('#draw-pile')).toBeEnabled();
    await receiver.locator('#draw-pile').click();
    await expect(observer.locator('.card-motion')).toHaveAttribute('data-kind', 'draw');
    await expect(observer.locator('.card-motion')).toHaveAttribute('data-face', 'back');
    await expect(handCards(receiver)).toHaveCount(2);
    const layout = await observer.locator('.seat').first().evaluate(seat => {
      const name = seat.querySelector('.seat-name')!.getBoundingClientRect();
      const art = seat.querySelector('.seat-location-art')!.getBoundingClientRect();
      const location = seat.querySelector('.seat-location')!.getBoundingClientRect();
      return { nameAbove: name.bottom <= art.top, locationBelow: location.top >= art.bottom };
    });
    expect(layout).toEqual({ nameAbove: true, locationBelow: true });
    await observer.screenshot({ path: `test-results/manual-draft-${testInfo.project.name}.png`, fullPage: true });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('desktop draws by dragging the pile to its own hand', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  const { pages, contexts } = await startRoom(browser, ['拖牌甲', '拖牌乙', '拖牌丙'], { drawFirstHand: false, viewport: { width: 1280, height: 1200 } });
  try {
    const page = pages[0];
    const pile = (await page.locator('#draw-pile').boundingBox())!;
    const hand = (await page.locator('.hand-slot').boundingBox())!;
    await page.mouse.move(pile.x + pile.width / 2, pile.y + pile.height / 2);
    await page.mouse.down();
    await page.mouse.move(hand.x + hand.width / 2, hand.y + hand.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(handCards(page)).toHaveCount(1);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
