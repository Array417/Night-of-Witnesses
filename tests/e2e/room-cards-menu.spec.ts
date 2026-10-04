import { test, expect } from '@playwright/test';
import { startRoom, handCards, completeDraft, closeGameMenu, openGameMenu } from './draft-flow.ts';

test('Back revokes membership, transfers host, and keeps the socket usable', async ({ browser }) => {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto('/');
    await host.locator('#player-name-input').fill('房主');
    await host.locator('#btn-create-room').click();
    await expect(host.locator('#lobby-panel')).toBeVisible();
    const code = await host.evaluate(() => window.__NOW__!.client.getProjection()!.roomCode);
    await guest.goto('/');
    await guest.locator('#player-name-input').fill('玩家');
    await guest.locator('#room-code-input').fill(code);
    await guest.locator('#btn-join-room').click();
    await expect(guest.locator('#player-roster li')).toHaveCount(2);
    await host.locator('#btn-leave-room').click();
    await expect(host.locator('#home-panel')).toBeVisible();
    await expect(guest.locator('#player-roster li')).toHaveCount(1);
    await expect(guest.locator('#btn-start-game')).toBeVisible();
    expect(await host.evaluate(() => window.__NOW__!.session.loadSavedSeat())).toBeNull();
    expect(new URL(host.url()).searchParams.has('room')).toBe(false);
    await host.reload();
    await expect(host.locator('#home-panel')).toBeVisible();
    await host.locator('#player-name-input').fill('再次建立');
    await host.locator('#btn-create-room').click();
    await expect(host.locator('#lobby-panel')).toBeVisible();
    await host.locator('#btn-leave-room').click();
    await host.locator('#player-name-input').fill('重新加入');
    await host.locator('#room-code-input').fill(code);
    await host.locator('#btn-join-room').click();
    await expect(host.locator('#player-roster li')).toHaveCount(2);
  } finally { await host.close(); await guest.close(); }
});

test('original card moves opaquely, cancels safely, and drops through confirmation', async ({ browser }) => {
  const { pages, contexts } = await startRoom(browser, ['甲', '乙', '丙'], { viewport: { width: 1280, height: 1100 } });
  const page = pages[0];
  try {
    await closeGameMenu(page);
    const card = handCards(page).first();
    const handle = (await card.elementHandle())!;
    const initial = (await card.boundingBox())!;
    const target = page.locator('.seat.is-eligible').first();
    const dest = (await target.boundingBox())!;
    await page.mouse.move(initial.x + initial.width / 2, initial.y + 30);
    await page.mouse.down();
    await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 12 });
    expect(await handle.evaluate(element => element.parentElement === document.body)).toBe(true);
    expect(await handle.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await expect(page.locator('.card-placeholder')).toHaveCount(1);
    await expect(target).toHaveClass(/is-drop-ready/);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.card-placeholder')).toHaveCount(0);
    expect(await handle.evaluate(element => element.parentElement?.classList.contains('hand-slot'))).toBe(true);
    await expect(page.locator('#claim-dialog')).toBeHidden();
    await expect(page.locator('#card-detail-dialog')).toBeHidden();
    const next = (await card.boundingBox())!;
    await page.mouse.move(next.x + next.width / 2, next.y + 30);
    await page.mouse.down();
    await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('#claim-dialog')).toBeVisible();
    await page.locator('#btn-cancel-pass').click();
    await expect(page.locator('#claim-dialog')).toBeHidden();
    // A deliberate detail-button click immediately after a drag must still work.
    await card.locator('[data-action="view-card"]').click();
    await expect(page.locator('#card-detail-dialog')).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('touch drag moves the original card and the final actor can drop into Guest Room', async ({ browser }) => {
  const { pages, contexts } = await startRoom(browser, ['甲', '乙', '丙'], { viewport: { width: 375, height: 1000 }, contextOptions: () => ({ hasTouch: true }) });
  try {
    // Real touch events via CDP, not synthetic drag/drop payloads.
    const page = pages[0];
    const cdp = await page.context().newCDPSession(page);
    const card = handCards(page).first();
    await card.scrollIntoViewIfNeeded();
    const rect = (await card.boundingBox())!;
    const dest = (await page.locator('.seat.is-eligible').first().boundingBox())!;
    const handle = (await card.elementHandle())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dest.x + dest.width / 2, y: dest.y + dest.height / 2 }] });
    expect(await handle.evaluate(element => element.parentElement === document.body)).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#claim-dialog')).toBeVisible();
    await page.locator('#btn-confirm-pass').click();
    await expect(page.locator('#claim-dialog')).toBeHidden();
    const actor = await page.evaluate(() => window.__NOW__!.client.getProjection()!.currentActorId);
    const active = (await Promise.all(pages.map(async p => ({ p, id: await p.evaluate(() => window.__NOW__!.client.getProjection()!.viewerId) })))).find(row => row.id === actor)!.p;
    await handCards(active).first().locator('[data-action="view-card"]').click();
    await active.locator('#btn-pass-card').click();
    await active.locator('.seat-target').first().click();
    await active.locator('#btn-confirm-pass').click();
    const final = pages.find(p => p !== page && p !== active)!;
    await expect(final.locator('.guest-room-target')).toBeVisible();
    const lastCard = handCards(final).first();
    await lastCard.scrollIntoViewIfNeeded();
    const start = (await lastCard.boundingBox())!;
    const guest = (await final.locator('.guest-room-target').boundingBox())!;
    await final.mouse.move(start.x + start.width / 2, start.y + 25);
    await final.mouse.down();
    await final.mouse.move(guest.x + guest.width / 2, guest.y + guest.height / 2, { steps: 8 });
    await final.mouse.up();
    await expect(final.locator('#claim-dialog')).toBeVisible();
    await expect(final.locator('#claim-dialog')).toContainText('客房');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('pointer cancellation, projection updates and room closure clean up an active drag', async ({ browser }) => {
  const { pages, contexts } = await startRoom(browser, ['甲', '乙', '丙'], { viewport: { width: 1280, height: 1100 } });
  const page = pages[0];
  async function drag() {
    const card = handCards(page).first();
    const rect = (await card.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + 25);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + 50);
    await expect(page.locator('body > .is-pointer-dragging')).toHaveCount(1);
  }
  try {
    await drag();
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up();
    await expect(page.locator('.card-placeholder')).toHaveCount(0);
    await expect(page.locator('#claim-dialog')).toBeHidden();
    await drag();
    await page.evaluate(() => {
      const client = window.__NOW__!.client as unknown as { events: { onProjection(p: unknown): void }; getProjection(): unknown };
      client.events.onProjection(client.getProjection());
    });
    await page.mouse.up();
    await expect(page.locator('body > .is-pointer-dragging')).toHaveCount(0);
    await expect(page.locator('.card-placeholder')).toHaveCount(0);
    await drag();
    await page.evaluate(() => {
      const client = window.__NOW__!.client as unknown as { handleServerMessage(message: unknown, raw: unknown): void };
      const message = { type: 'room_closed', reason: 'test shutdown' };
      client.handleServerMessage(message, message);
    });
    await page.mouse.up();
    await expect(page.locator('#home-panel')).toBeVisible();
    await expect(page.locator('body > .is-pointer-dragging')).toHaveCount(0);
    await expect(page.locator('.card-placeholder')).toHaveCount(0);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('audio and mic controls live only in Menu and survive phase rerenders', async ({ browser }) => {
  const { pages, contexts } = await startRoom(browser, ['甲', '乙', '丙']);
  const page = pages[0];
  try {
    await completeDraft(pages);
    await expect(page.locator('.voice-menu-link')).toBeHidden();
    await openGameMenu(page);
    await expect(page.locator('#game-menu-content #btn-toggle-mic')).toBeVisible();
    await expect(page.locator('.table-action-dock #btn-toggle-mic')).toHaveCount(0);
    await page.locator('#btn-audio-settings').click();
    await page.locator('#settings-voice-output').fill('0.35');
    await page.locator('#settings-mic-gain').fill('1.3');
    await page.locator('#btn-voice-diagnostics').click();
    await expect(page.locator('#voice-diagnostics')).toContainText('inboundBytes');
    await closeGameMenu(page);
    await page.locator('#btn-advance-vote').click();
    await openGameMenu(page);
    await expect(page.locator('#audio-controls-shell')).toHaveCount(1);
    await expect(page.locator('#settings-voice-output')).toHaveValue('0.35');
    await expect(page.locator('#settings-mic-gain')).toHaveValue('1.3');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('home content centers vertically and short viewports scroll without clipping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  const bounds = await page.locator('#app').boundingBox();
  expect(Math.abs(bounds!.y + bounds!.height / 2 - 500)).toBeLessThan(20);
  await page.setViewportSize({ width: 375, height: 360 });
  await expect(page.locator('#home-panel h1')).toBeVisible();
  await page.locator('#btn-join-room').scrollIntoViewIfNeeded();
  await expect(page.locator('#btn-join-room')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an active drawer keeps its opener at the 768px boundary', async ({ browser }) => {
  const { pages, contexts } = await startRoom(browser, ['甲', '乙', '丙'], { viewport: { width: 375, height: 900 } });
  const page = pages[0];
  try {
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.locator('#btn-show-game-menu')).toBeVisible();
    await openGameMenu(page);
    expect(await page.locator('#game-menu-content').evaluate(element => getComputedStyle(element).position)).toBe('fixed');
    await expect(page.locator('#btn-show-game-menu')).toBeVisible();
    await closeGameMenu(page);
    await expect(page.locator('#game-menu')).toHaveAttribute('data-state', 'closed');
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
