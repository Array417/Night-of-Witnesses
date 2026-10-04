import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startRoom, handCards, playToResults } from './draft-flow.ts';

const assets = ['murderer', 'accomplice', 'bomber', 'lawyer', 'rich_merchant', 'detective', 'butler', 'guest', 'lounge', 'gallery', 'billiard_room', 'study', 'entrance_hall', 'dining_room', 'guest_room', 'boiler_room', 'card_back'];

test('all seventeen artwork assets decode as images', async ({ page }) => {
  await page.goto('/');
  const decoded = await page.evaluate(async names => Promise.all(names.map(async name => {
    const image = new Image();
    image.src = `/art/${name}.webp`;
    await image.decode();
    return { name, width: image.naturalWidth, height: image.naturalHeight };
  })), assets);
  expect(decoded).toHaveLength(17);
  for (const image of decoded) {
    expect(image.width).toBeGreaterThanOrEqual(256);
    expect(image.height).toBeGreaterThanOrEqual(256);
  }
});

test('artwork renders in cards, details and results without exposing opponents', async ({ browser }) => {
  const { pages, contexts } = await startRoom(browser, ['甲', '乙', '丙']);
  const page = pages[0];
  mkdirSync('.cache/art-evidence', { recursive: true });
  try {
    await expect(handCards(page).first().locator('img.card-art')).toBeVisible();
    await expect(page.locator('.card-back img')).toHaveCount(0);
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.table-panel img').evaluateAll(async images => {
        await Promise.all(images.map(image => (image as HTMLImageElement).decode()));
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.cache/art-evidence/draft-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await handCards(page).first().locator('[data-action="view-card"]').click();
    await expect(page.locator('#card-detail-dialog .card-detail-art')).toBeVisible();
    await page.keyboard.press('Escape');
    await playToResults(pages);
    await expect(page.locator('.results-stage .card-art').first()).toBeVisible();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#app img').evaluateAll(async images => {
        await Promise.all(images.map(image => (image as HTMLImageElement).decode()));
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.cache/art-evidence/results-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
