import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { getTableSeats } from '../../src/client/views/game-seating.ts';
import {
  CLAIM_DIALOG,
  CARD_DETAIL_DIALOG,
  DRAFT_CONTROLS,
  GAME_MENU,
  SHOW_GAME_MENU,
  armCard,
  closeGameMenu,
  confirmClaim,
  firstSeatTarget,
  guestRoomTarget,
  handCards,
  openGameMenu,
  passToFirstEligible,
  passToGuestRoom,
  seatTarget,
} from './draft-flow.ts';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

/** Role labels that must never appear inside opponent seat markup before resolution. */
const ROLE_LABELS = ['兇手', '共犯', '炸彈魔', '律師', '富豪', '偵探', '管家', '房客'] as const;

function findSecretLeaks(html: string): string[] {
  return ROLE_LABELS.filter((label) => html.includes(label));
}

interface StartedGame {
  pages: Page[];
  contexts: BrowserContext[];
  roomCode: string;
}

interface StartViewport {
  readonly width: number;
  readonly height: number;
  /** Emulates a coarse pointer so capability-based interaction modes apply. */
  readonly hasTouch?: boolean;
}

/** Creates one browser context per name, joins them into one room, and starts the draft. */
async function startGame(
  browser: Browser,
  names: readonly string[],
  viewport: StartViewport,
  onPage?: (page: Page, index: number) => Promise<void>
): Promise<StartedGame> {
  const contexts = await Promise.all(
    names.map(() =>
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.hasTouch === true,
      })
    )
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  if (onPage) {
    await Promise.all(pages.map((page, index) => onPage(page, index)));
  }
  const host = pages[0];
  const first = names[0];
  await host.goto('/');
  await host.fill('#player-name-input', first);
  await host.click('#btn-create-room');
  await expect(host.locator('#lobby-panel')).toBeVisible();
  const code = (await host.locator('#lobby-panel h1').innerText()).match(/[A-Z0-9]{6}/)?.[0];
  if (!code) throw new Error('room code missing');
  for (let index = 1; index < pages.length; index++) {
    const page = pages[index];
    await page.goto(`/?room=${code}`);
    await page.fill('#player-name-input', names[index]);
    await page.click('#btn-join-room');
    await expect(page.locator('#lobby-panel')).toBeVisible();
  }
  // L1 only seats 3 players; larger rooms need a 4-6 player level.
  if (pages.length > 3) {
    await host.locator('#level-select').selectOption('L3');
  }
  for (const page of pages) await page.click('#btn-toggle-ready');
  const startButton = host.locator('#btn-start-game');
  await expect(startButton).toBeEnabled();
  await startButton.click();
  // The table surface is visible on every viewport; menu panels may live in a closed drawer.
  for (const page of pages) await expect(page.locator('.table-panel')).toBeVisible();
  return { pages, contexts, roomCode: code };
}

/** Reads the canonical seat ids in DOM (canonical projection) order. */
async function seatIds(page: Page): Promise<string[]> {
  return page
    .locator('.table-panel .seat')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-player-id') ?? ''));
}

async function seatCoord(page: Page, playerId: string, axis: '--seat-x' | '--seat-y'): Promise<number> {
  const raw = await page
    .locator(`.table-panel .seat[data-player-id="${playerId}"]`)
    .evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), axis);
  return Number.parseFloat(raw);
}

/** Dispatches a synthetic HTML5 drop with an explicit drag payload on one seat. */
async function dropCard(page: Page, targetPlayerId: string, cardId: string): Promise<void> {
  await page.evaluate(
    ({ targetId, draggedId }) => {
      const seat = document.querySelector(`.table-panel .seat[data-player-id="${targetId}"]`);
      if (!seat) throw new Error(`seat ${targetId} not found`);
      const transfer = new DataTransfer();
      if (draggedId !== '') transfer.setData('text/plain', draggedId);
      seat.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    },
    { targetId: targetPlayerId, draggedId: cardId }
  );
}

interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(first: LayoutBox, second: LayoutBox, tolerance = 1): boolean {
  return (
    first.x + tolerance < second.x + second.width &&
    second.x + tolerance < first.x + first.width &&
    first.y + tolerance < second.y + second.height &&
    second.y + tolerance < first.y + first.height
  );
}

async function seatBoxes(page: Page): Promise<LayoutBox[]> {
  return page.locator('.table-panel .seat').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
  );
}

function expectNoSeatOverlap(boxes: readonly LayoutBox[]): void {
  for (let first = 0; first < boxes.length; first++) {
    for (let second = first + 1; second < boxes.length; second++) {
      expect(
        overlaps(boxes[first], boxes[second]),
        `seat ${first} overlaps seat ${second}`
      ).toBe(false);
    }
  }
}

interface TextMetrics {
  /** Rendered line count (box height / line height). */
  readonly lines: number;
  /** True when the text box overflows horizontally (clipped glyphs). */
  readonly clipped: boolean;
}

interface OpenerVsHeading {
  readonly opener: LayoutBox;
  readonly heading: LayoutBox;
  readonly headingText: TextMetrics;
  readonly labelText: TextMetrics;
  readonly pageOverflow: boolean;
}

/** Rectangles of the fixed drawer opener and the table heading, in CSS pixels. */
async function openerVsHeading(page: Page): Promise<OpenerVsHeading> {
  return page.evaluate(() => {
    const rectOf = (selector: string): LayoutBox => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) throw new Error(`${selector} missing`);
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const textMetrics = (selector: string): TextMetrics => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) throw new Error(`${selector} missing`);
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      return {
        lines: Number((node.getBoundingClientRect().height / lineHeight).toFixed(2)),
        clipped: node.scrollWidth > node.clientWidth + 1,
      };
    };
    return {
      opener: rectOf('#btn-show-game-menu'),
      heading: rectOf('.table-panel .table-heading h2'),
      headingText: textMetrics('.table-panel .table-heading h2'),
      labelText: textMetrics('.table-panel .table-heading .label-hint'),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

/** The opener keeps its pinned corner; the heading must clear its box and its 8px shadow. */
function expectHeadingClearsOpener(
  measured: OpenerVsHeading,
  label: string,
  viewportWidth: number
): void {
  expect(
    overlaps(measured.opener, measured.heading, 0),
    `fixed opener overlaps the 證人圓桌 heading at ${label}`
  ).toBe(false);
  expect(measured.opener.x, 'opener stays pinned left').toBeLessThanOrEqual(16);
  expect(measured.opener.y, 'opener stays pinned top').toBeLessThanOrEqual(16);
  // A bare 1px touch still visually clips the heading: the opener carries
  // `box-shadow: 0 8px 20px`, so the heading must clear the box plus that offset.
  expect(
    measured.heading.y,
    `heading clears the fixed opener and its shadow at ${label}`
  ).toBeGreaterThanOrEqual(measured.opener.y + measured.opener.height + 8);
  expect(measured.heading.height, 'heading is rendered, not hidden').toBeGreaterThanOrEqual(20);
  // 證人圓桌 is a compound: wrapping the last glyph off (`證人圓` / `桌`) is a CJK
  // orphan, so the title stays on one line and is never clipped at any text size.
  expect(measured.headingText.lines, `證人圓桌 stays whole at ${label}`).toBeLessThanOrEqual(1.05);
  expect(measured.headingText.clipped, `heading is not clipped at ${label}`).toBe(false);
  // The count label may move to its own row, but must stay readable and unclipped.
  expect(measured.labelText.lines, `count label is readable at ${label}`).toBeGreaterThanOrEqual(1);
  expect(measured.labelText.clipped, `count label is not clipped at ${label}`).toBe(false);
  expect(measured.heading.x).toBeGreaterThanOrEqual(0);
  expect(measured.heading.x + measured.heading.width).toBeLessThanOrEqual(viewportWidth);
  expect(measured.pageOverflow, `page overflow at ${label}`).toBe(false);
}

interface OpponentSeatRects {
  readonly seat: LayoutBox;
  readonly card: LayoutBox;
  readonly target: LayoutBox | null;
  readonly name: LayoutBox;
  readonly location: LayoutBox;
  readonly state: LayoutBox;
  readonly texts: { readonly name: string; readonly location: string; readonly state: string };
  readonly cardVisible: boolean;
}

/** Rectangles of every opponent seat, its one card back, and its three metadata lines. */
async function opponentSeatRects(page: Page): Promise<OpponentSeatRects[]> {
  return page.locator('.table-panel .seat:not([aria-current="true"])').evaluateAll((seats) =>
    seats.map((seat) => {
      const rectOf = (node: Element): LayoutBox => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const query = (selector: string): HTMLElement => {
        const node = seat.querySelector(selector);
        if (!(node instanceof HTMLElement)) throw new Error(`${selector} missing`);
        return node;
      };
      const card = query('.seat-card');
      const cardStyle = getComputedStyle(card);
      const target = seat.querySelector('button.seat-target');
      const name = query('.seat-name');
      const location = query('.seat-location');
      const state = query('.seat-state');
      return {
        seat: rectOf(seat),
        card: rectOf(card),
        target: target instanceof HTMLElement ? rectOf(target) : null,
        name: rectOf(name),
        location: rectOf(location),
        state: rectOf(state),
        texts: {
          name: name.textContent ?? '',
          location: location.textContent ?? '',
          state: state.textContent ?? '',
        },
        cardVisible:
          cardStyle.display !== 'none' &&
          cardStyle.visibility !== 'hidden' &&
          Number.parseFloat(cardStyle.opacity) > 0,
      };
    })
  );
}

/**
 * The opponent back is decorative: it may sit over the seat frame, but its box
 * must never intersect the name/location/state line boxes, and it must stay
 * attached to the same seat (centred, hugging the lower edge).
 */
function expectOpponentSeatsClear(seats: readonly OpponentSeatRects[], label: string): void {
  expect(seats.length, `opponent seats at ${label}`).toBeGreaterThanOrEqual(2);
  for (const [index, seat] of seats.entries()) {
    const where = `${label} opponent seat ${index}`;
    expect(seat.texts.name.length, `name text present at ${where}`).toBeGreaterThan(0);
    expect(seat.texts.location.length, `location text present at ${where}`).toBeGreaterThan(0);
    expect(seat.texts.state.length, `state text present at ${where}`).toBeGreaterThan(0);
    expect(seat.name.height, `name rendered at ${where}`).toBeGreaterThan(0);
    expect(seat.location.height, `location rendered at ${where}`).toBeGreaterThan(0);
    expect(seat.state.height, `state rendered at ${where}`).toBeGreaterThan(0);
    expect(seat.cardVisible, `card back rendered at ${where}`).toBe(true);
    expect(overlaps(seat.card, seat.name, 0), `card back covers the name at ${where}`).toBe(false);
    expect(overlaps(seat.card, seat.location, 0), `card back covers the location at ${where}`).toBe(false);
    expect(overlaps(seat.card, seat.state, 0), `card back covers the state at ${where}`).toBe(false);
    const seatCentre = seat.seat.x + seat.seat.width / 2;
    const cardCentre = seat.card.x + seat.card.width / 2;
    expect(Math.abs(cardCentre - seatCentre), `card back centred on its seat at ${where}`).toBeLessThanOrEqual(2);
    const seatBottom = seat.seat.y + seat.seat.height;
    // The back hangs from the seat's lower edge: its top sits on the bottom
    // border (1px above the border box), never floating away from the seat.
    expect(seat.card.y, `card back hugs the lower seat edge at ${where}`).toBeGreaterThanOrEqual(seatBottom - 10);
    expect(seat.card.y, `card back stays attached to its seat at ${where}`).toBeLessThanOrEqual(seatBottom + 2);
    expect(seat.seat.width, `seat width at ${where}`).toBeGreaterThanOrEqual(44);
    expect(seat.seat.height, `seat height at ${where}`).toBeGreaterThanOrEqual(44);
    if (seat.target) {
      expect(overlaps(seat.target, seat.seat, 0), `seat overlay spans its seat at ${where}`).toBe(true);
      expect(seat.target.width, `drop target width at ${where}`).toBeGreaterThanOrEqual(44);
      expect(seat.target.height, `drop target height at ${where}`).toBeGreaterThanOrEqual(44);
    }
  }
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
      await expect(p1.locator('.table-panel')).toBeVisible();
      await expect(p1.locator('.table-oval')).toBeVisible();

      // Check overflow
      const overflow = await p1.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(overflow).toBe(true);

      // The menu keeps room/phase/role/testimony information; on drawer viewports it opens first.
      await openGameMenu(p1);
      await expect(p1.locator('#game-header')).toBeVisible();
      await expect(p1.locator('#draft-controls')).toBeVisible();
      await expect(p1.locator('.cards-row')).toHaveCount(0);
      await closeGameMenu(p1);
      await expect(p1.locator('.table-panel')).toBeVisible();

      // Verify seats exist and derive state
      const seats = p1.locator('.table-panel .seat');
      await expect(seats).toHaveCount(3);
      await expect(p1.locator('.table-panel .seat[aria-current="true"]')).toHaveCount(1);
      await expect(p1.locator('.table-panel .seat.is-active')).toHaveCount(1);

      // Canonical ring: every seat must match getTableSeats for this viewer.
      const ids = await seatIds(p1);
      const viewerId = await p1.locator('.table-panel .seat[aria-current="true"]').getAttribute('data-player-id');
      if (!viewerId) throw new Error('viewer seat id missing');
      const expectedSeats = getTableSeats(ids.map((playerId) => ({ playerId })), viewerId);
      for (const expected of expectedSeats) {
        const coords = await p1
          .locator(`.table-panel .seat[data-player-id="${expected.playerId}"]`)
          .evaluate((element) => ({
            x: getComputedStyle(element).getPropertyValue('--seat-x').trim(),
            y: getComputedStyle(element).getPropertyValue('--seat-y').trim(),
            relativeIndex: element.getAttribute('data-relative-index'),
          }));
        expect(coords.x).toBe(String(expected.x));
        expect(coords.y).toBe(String(expected.y));
        expect(coords.relativeIndex).toBe(String(expected.relativeIndex));
      }
      // Viewer is bottom-center; seats never rotate the canonical order.
      expect(await seatCoord(p1, viewerId, '--seat-x')).toBe(50);
      expect(await seatCoord(p1, viewerId, '--seat-y')).toBe(88);
      expect(await seatIds(p1)).toEqual(ids);

      // One generic opponent back per opponent seat, zero secrets on those nodes.
      const opponentSeats = p1.locator('.table-panel .seat:not([aria-current="true"])');
      await expect(opponentSeats).toHaveCount(2);
      await expect(opponentSeats.locator('.card-back[data-owner="opponent"]')).toHaveCount(2);
      expect(
        await opponentSeats
          .locator('.card-back')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')))
      ).toEqual(['玩家的隱藏卡牌', '玩家的隱藏卡牌']);
      const opponentHtml = await opponentSeats.evaluateAll((elements) =>
        elements.map((element) => element.outerHTML).join('\n')
      );
      expect(findSecretLeaks(opponentHtml)).toEqual([]);
      expect(opponentHtml).not.toContain('data-card-id');
      expect(opponentHtml).not.toContain('data-card-role');

      // The actor's own hand is face-up in the table hand slot.
      await expect(p1.locator('.table-panel .hand-slot .card-face[data-hand="viewer"]')).toHaveCount(2);

      // Only eligible players are pass targets, and each target meets the 44px floor.
      const targetButtons = p1.locator('.table-panel .seats button.seat-target');
      await expect(targetButtons).toHaveCount(2);
      const targetCount = await targetButtons.count();
      for (let index = 0; index < targetCount; index++) {
        const box = await targetButtons.nth(index).boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }

      // Seats stay inside the table panel and never collide with each other.
      const boxes = await seatBoxes(p1);
      expectNoSeatOverlap(boxes);
      const panelBox = await p1.locator('.table-panel').boundingBox();
      expect(panelBox).not.toBeNull();
      if (panelBox) {
        for (const box of boxes) {
          expect(box.x).toBeGreaterThanOrEqual(panelBox.x - 1);
          expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
          expect(box.y).toBeGreaterThanOrEqual(panelBox.y - 1);
          expect(box.y + box.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
        }
      }

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

  test('draft completes by the dialog pointer flow on every turn', async ({ browser }) => {
    const { pages, contexts } = await startGame(browser, ['玩家一', '玩家二', '玩家三'], {
      width: 1280,
      height: 800,
    });
    try {
      const [p1, p2, p3] = pages;

      // Player 1: detail dialog fallback for the second card, then target Player 2.
      await expect(p1.locator(DRAFT_CONTROLS)).toBeVisible();
      await armCard(p1, 1);
      await firstSeatTarget(p1).click();
      await confirmClaim(p1);
      await expect(p1.locator(DRAFT_CONTROLS)).toBeHidden();

      // Player 2 → Player 3.
      await expect(p2.locator(DRAFT_CONTROLS)).toBeVisible();
      await passToFirstEligible(p2);

      // Player 3 is final and uses the Guest Room centre target.
      await expect(p3.locator(DRAFT_CONTROLS)).toBeVisible();
      await passToGuestRoom(p3);

      // All transition to discussion phase.
      await expect(p1.locator('h2:has-text("自由討論階段")')).toBeVisible();
      await expect(p3.locator('h2:has-text("自由討論階段")')).toBeVisible();
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

test.describe('Canonical wooden table surface (Todo 5)', () => {
  test('two clients see reciprocal left/right neighbours on the same ring', async ({ browser }) => {
    const { pages, contexts } = await startGame(browser, ['愛麗絲', '鮑伯', '查理'], {
      width: 1280,
      height: 800,
    });
    try {
      const [alice, bob, charlie] = pages;
      const canonical = await seatIds(alice);
      expect(canonical).toHaveLength(3);
      // Canonical order is identical on every client; only the rotation differs.
      expect(await seatIds(bob)).toEqual(canonical);
      expect(await seatIds(charlie)).toEqual(canonical);

      const [aliceId, bobId, charlieId] = canonical;
      const players = canonical.map((playerId) => ({ playerId }));
      const xOf = (
        seats: readonly { playerId: string; x: number }[],
        playerId: string
      ): number => seats.find((seat) => seat.playerId === playerId)?.x ?? Number.NaN;

      const aliceSeats = getTableSeats(players, aliceId);
      const bobSeats = getTableSeats(players, bobId);
      const charlieSeats = getTableSeats(players, charlieId);

      // Exact shared-helper rotation per viewer.
      expect(await seatCoord(alice, bobId, '--seat-x')).toBe(xOf(aliceSeats, bobId));
      expect(await seatCoord(bob, aliceId, '--seat-x')).toBe(xOf(bobSeats, aliceId));
      expect(await seatCoord(alice, charlieId, '--seat-x')).toBe(xOf(aliceSeats, charlieId));
      expect(await seatCoord(charlie, aliceId, '--seat-x')).toBe(xOf(charlieSeats, aliceId));

      // Physical reciprocity: B right of A implies A left of B, and C mirrors it.
      expect(await seatCoord(alice, bobId, '--seat-x')).toBeGreaterThan(50);
      expect(await seatCoord(bob, aliceId, '--seat-x')).toBeLessThan(50);
      expect(await seatCoord(alice, charlieId, '--seat-x')).toBeLessThan(50);
      expect(await seatCoord(charlie, aliceId, '--seat-x')).toBeGreaterThan(50);

      // Every viewer is bottom-center on their own device.
      for (const [page, playerId] of [
        [alice, aliceId],
        [bob, bobId],
        [charlie, charlieId],
      ] as const) {
        expect(await seatCoord(page, playerId, '--seat-y')).toBe(88);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('six-player ring keeps canonical coordinates without overlap or overflow across widths', async ({
    browser,
  }) => {
    const longNameA = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';
    const longNameB = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑卯寅';
    // Two adjacent 24-character names are the worst case for ring collisions.
    const names = ['玩家一', longNameA, longNameB, '玩家四', '玩家五', '玩家六'];
    const { pages, contexts } = await startGame(browser, names, { width: 1280, height: 800 });
    try {
      const host = pages[0];
      const seats = host.locator('.table-panel .seat');
      await expect(seats).toHaveCount(6);
      const ids = await seatIds(host);
      const expected = getTableSeats(ids.map((playerId) => ({ playerId })), ids[0]);
      for (const seat of expected) {
        const coords = await host
          .locator(`.table-panel .seat[data-player-id="${seat.playerId}"]`)
          .evaluate((element) => ({
            x: getComputedStyle(element).getPropertyValue('--seat-x').trim(),
            y: getComputedStyle(element).getPropertyValue('--seat-y').trim(),
            relativeIndex: element.getAttribute('data-relative-index'),
          }));
        expect(coords.x).toBe(String(seat.x));
        expect(coords.y).toBe(String(seat.y));
        expect(coords.relativeIndex).toBe(String(seat.relativeIndex));
      }
      await expect(
        host.locator('.table-panel .seat:not([aria-current="true"]) .card-back[data-owner="opponent"]')
      ).toHaveCount(5);
      const opponentHtml = await host
        .locator('.table-panel .seat:not([aria-current="true"])')
        .evaluateAll((elements) => elements.map((element) => element.outerHTML).join('\n'));
      expect(findSecretLeaks(opponentHtml)).toEqual([]);

      for (const viewport of [
        { width: 360, height: 800 },
        { width: 375, height: 812 },
        { width: 768, height: 1024 },
        { width: 1280, height: 800 },
      ]) {
        await host.setViewportSize(viewport);
        expect(
          await host.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth
          ),
          `page overflow at ${viewport.width}`
        ).toBe(false);
        const boxes = await seatBoxes(host);
        expectNoSeatOverlap(boxes);
        const panelBox = await host.locator('.table-panel').boundingBox();
        expect(panelBox).not.toBeNull();
        if (panelBox) {
          for (const box of boxes) {
            expect(box.x).toBeGreaterThanOrEqual(panelBox.x - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
            expect(box.y).toBeGreaterThanOrEqual(panelBox.y - 1);
            expect(box.y + box.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
          }
        }
        for (const box of boxes) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('own-card drops open the claim dialog only for eligible seats and reject forged drops', async ({
    browser,
    isMobile,
  }) => {
    const { pages, contexts } = await startGame(browser, ['愛麗絲', '鮑伯', '查理'], {
      width: 1280,
      height: 800,
    });
    try {
      const [alice, bob] = pages;
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();

      const ids = await seatIds(alice);
      const [aliceId, bobId, charlieId] = ids;
      const seatOf = (page: Page, playerId: string) =>
        page.locator(`.table-panel .seat[data-player-id="${playerId}"]`);

      // The hand slot is the actor's only card surface and a real drag source.
      await expect(handCards(alice)).toHaveCount(2);
      const ownCardId = await handCards(alice).first().getAttribute('data-card-id');
      if (!ownCardId) throw new Error('own card id missing');
      const dragged = await handCards(alice).first().evaluate((element) => {
        const transfer = new DataTransfer();
        element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        return transfer.getData('text/plain');
      });
      expect(dragged).toBe(ownCardId);

      // Eligible seats are exactly the unserved, connected opponents.
      const targetIds = await alice
        .locator('.table-panel .seats button.seat-target')
        .evaluateAll((elements) =>
          elements.map((element) => element.closest('[data-player-id]')?.getAttribute('data-player-id') ?? '')
        );
      expect(targetIds).toEqual([bobId, charlieId]);
      // The viewer's own seat is never a target.
      await expect(seatOf(alice, aliceId).locator('button.seat-target')).toHaveCount(0);

      // Forged, empty, and own-seat drops never open the claim dialog or highlight a seat.
      await dropCard(alice, bobId, 'forged-card-000');
      await dropCard(alice, bobId, '');
      await dropCard(alice, aliceId, ownCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);

      // Valid drop: real HTML5 drag on desktop, validated synthetic drop on touch.
      if (isMobile) {
        await dropCard(alice, charlieId, ownCardId);
      } else {
        await handCards(alice).first().dragTo(seatOf(alice, charlieId));
      }
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await expect(seatOf(alice, charlieId)).toHaveClass(/is-targeted/);
      // Cancel clears card, target, and highlights without dispatching anything.
      await alice.locator('#btn-cancel-pass').click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);

      // Target activation by click and by keyboard Enter uses the same eligible set.
      await armCard(alice);
      await seatTarget(alice, charlieId).click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-cancel-pass').click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();

      await armCard(alice);
      await seatTarget(alice, bobId).focus();
      await alice.keyboard.press('Enter');
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await expect(seatOf(alice, bobId)).toHaveClass(/is-targeted/);
      await alice.locator('#btn-confirm-pass').click();

      // Advance the draft: p1 passes to p2, so p1 becomes a served non-target.
      await expect(alice.locator(DRAFT_CONTROLS)).toBeHidden();
      await expect(bob.locator(DRAFT_CONTROLS)).toBeVisible();

      const bobTargets = await bob
        .locator('.table-panel .seats button.seat-target')
        .evaluateAll((elements) =>
          elements.map((element) => element.closest('[data-player-id]')?.getAttribute('data-player-id') ?? '')
        );
      expect(bobTargets).toEqual([charlieId]);
      await expect(seatOf(bob, aliceId)).toHaveClass(/is-served/);
      await expect(seatOf(bob, aliceId).locator('button.seat-target')).toHaveCount(0);

      const bobCardId = await handCards(bob).first().getAttribute('data-card-id');
      if (!bobCardId) throw new Error('bob hand card missing');
      await dropCard(bob, aliceId, bobCardId);
      await expect(bob.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(bob.locator('.table-panel .seat.is-targeted')).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('final draft actor sees only the Guest Room centre target', async ({ browser }) => {
    const { pages, contexts } = await startGame(browser, ['愛麗絲', '鮑伯', '查理'], {
      width: 1280,
      height: 800,
    });
    try {
      const [alice, bob, charlie] = pages;

      // Alice -> Bob, Bob -> Charlie, leaving Charlie as the final actor.
      await passToFirstEligible(alice);
      await expect(bob.locator(DRAFT_CONTROLS)).toBeVisible();
      await passToFirstEligible(bob);
      await expect(charlie.locator(DRAFT_CONTROLS)).toBeVisible();

      // No seat is a pass target for the final actor.
      await expect(charlie.locator('.table-panel .seats button.seat-target')).toHaveCount(0);
      await expect(charlie.locator('.table-panel .hand-slot .card-face')).toHaveCount(2);

      const guestRoom = charlie.locator('.table-panel [data-target-id="guest-room"]');
      await expect(guestRoom).toBeVisible();
      const guestRoomBox = await guestRoom.boundingBox();
      expect(guestRoomBox).not.toBeNull();
      if (guestRoomBox) {
        expect(guestRoomBox.width).toBeGreaterThanOrEqual(44);
        expect(guestRoomBox.height).toBeGreaterThanOrEqual(44);
      }
      // The Guest Room target owns the table centre.
      const ringBox = await charlie.locator('.table-panel .table-ring').boundingBox();
      expect(ringBox).not.toBeNull();
      if (ringBox && guestRoomBox) {
        const centreX = ringBox.x + ringBox.width / 2;
        const centreY = ringBox.y + ringBox.height / 2;
        expect(Math.abs(guestRoomBox.x + guestRoomBox.width / 2 - centreX)).toBeLessThanOrEqual(4);
        expect(Math.abs(guestRoomBox.y + guestRoomBox.height / 2 - centreY)).toBeLessThanOrEqual(4);
      }
      // Non-final viewers never see a Guest Room target.
      await expect(alice.locator('.table-panel [data-target-id="guest-room"]')).toHaveCount(0);
      await expect(bob.locator('.table-panel [data-target-id="guest-room"]')).toHaveCount(0);
      await expect(charlie.locator('.table-panel .table-action-dock')).toBeAttached();

      // Completing the final pass removes the Guest Room target again.
      await passToGuestRoom(charlie);
      await expect(charlie.locator('h2:has-text("自由討論階段")')).toBeVisible();
      await expect(charlie.locator('.table-panel [data-target-id="guest-room"]')).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('long CJK names and 200% text keep seats inside the table without overlap', async ({ browser }) => {
    const longName = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';
    const { pages, contexts } = await startGame(browser, ['愛麗絲', longName, '查理'], {
      width: 375,
      height: 812,
    });
    try {
      const host = pages[0];
      for (const viewport of [
        { width: 375, height: 812 },
        { width: 360, height: 800 },
      ]) {
        await host.setViewportSize(viewport);
        expect(
          await host.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth
          ),
          `page overflow at ${viewport.width}`
        ).toBe(false);
        const panelHasOverflow = await host
          .locator('.table-panel')
          .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
        expect(panelHasOverflow).toBe(false);
        expectNoSeatOverlap(await seatBoxes(host));
      }

      const longSeat = host
        .locator('.table-panel .seat:not([aria-current="true"])')
        .filter({ hasText: longName });
      await expect(longSeat).toHaveCount(1);
      expect(
        await longSeat.evaluate((element) => element.scrollWidth > element.clientWidth + 1)
      ).toBe(false);

      // 200% text simulation keeps the same geometry guarantees.
      await host.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await host.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        )
      ).toBe(false);
      const panelHasOverflowAt200 = await host
        .locator('.table-panel')
        .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(panelHasOverflowAt200).toBe(false);
      expectNoSeatOverlap(await seatBoxes(host));
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('four-player coarse 375px 200% text keeps seats apart with CJK names intact', async ({
    browser,
  }) => {
    const names = ['春嬌', '建宏', '淑芬', '志明'];
    const { pages, contexts } = await startGame(browser, names, {
      width: 375,
      height: 812,
      hasTouch: true,
    });
    const evidenceDir200 = path.resolve('.omo/evidence/final-f3-visual-qa');
    fs.mkdirSync(evidenceDir200, { recursive: true });
    try {
      const host = pages[0];
      // The server assigns locations per room, so a natural room can hide the
      // collision behind short labels. Pinning the longest location/state labels
      // the product itself renders (交誼廳 / 行動中, both 3 glyphs) makes the
      // worst-case geometry deterministic and reproduces the F3 overlap exactly.
      await host.evaluate(() => {
        for (const seat of document.querySelectorAll('.table-panel .seat')) {
          const location = seat.querySelector('.seat-location');
          const state = seat.querySelector('.seat-state');
          if (location) location.textContent = '交誼廳';
          if (state) state.textContent = '行動中';
        }
      });
      await host.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const rootFontSize = await host.evaluate(
        () => getComputedStyle(document.documentElement).fontSize
      );
      expect(rootFontSize, '200% text emulation active').toBe('32px');

      // Geometry is written before asserting so a failing run still yields the
      // observed overlap rectangles for the evidence record.
      const boxes = await seatBoxes(host);
      const ids = await seatIds(host);
      const overlapPairs: string[] = [];
      for (let first = 0; first < boxes.length; first++) {
        for (let second = first + 1; second < boxes.length; second++) {
          if (overlaps(boxes[first], boxes[second])) {
            overlapPairs.push(`${ids[first]}~${ids[second]}`);
          }
        }
      }
      const pageOverflow = await host.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      const panelOverflow = await host
        .locator('.table-panel')
        .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      const seatMetrics = await host
        .locator('.table-panel .seat')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const span = (selector: string) => {
              const node = element.querySelector(selector);
              if (!(node instanceof HTMLElement)) return null;
              const style = getComputedStyle(node);
              return {
                text: node.textContent ?? '',
                lines: Number(
                  (node.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)).toFixed(2)
                ),
                clamp: style.webkitLineClamp,
              };
            };
            return { name: span('.seat-name'), location: span('.seat-location'), state: span('.seat-state') };
          })
        );
      await host.screenshot({
        path: path.join(evidenceDir200, 'f3s-fix-4p-text200-draft-375x812-coarse.png'),
      });
      fs.writeFileSync(
        path.join(evidenceDir200, 'f3s-fix-4p-text200-geometry.json'),
        JSON.stringify(
          {
            rootFontSize,
            pageOverflow,
            panelOverflow,
            overlapPairs,
            seats: ids.map((id, index) => ({ id, ...(boxes[index] ?? {}) })),
            seatMetrics,
          },
          null,
          2
        )
      );

      expect(overlapPairs, 'overlapping seat pairs at 375px/200%').toEqual([]);
      expect(pageOverflow, 'page horizontal overflow at 375px/200%').toBe(false);
      expect(panelOverflow, 'table panel horizontal overflow at 375px/200%').toBe(false);
      for (const [index, box] of boxes.entries()) {
        expect(box.width, `seat ${index} target width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `seat ${index} target height`).toBeGreaterThanOrEqual(44);
      }

      // The visible viewer name is clamped to two lines by design; the full name
      // stays in the seat's accessible label, so the clamp never hides semantic text.
      const viewerSeat = host.locator('.table-panel .seat[aria-current="true"]');
      expect(await viewerSeat.getAttribute('aria-label')).toContain('春嬌');
      const nameGeometry = await viewerSeat.locator('.seat-name').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          clamp: style.webkitLineClamp,
          lines: element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight),
        };
      });
      expect(nameGeometry.clamp).toBe('2');
      expect(nameGeometry.lines).toBeLessThanOrEqual(2.05);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('fixed drawer opener never occludes the table heading at 360/375', async ({ browser }) => {
    // Drawer mode is width- OR capability-triggered, so both pointer kinds must
    // clear the floating opener: coarse (the F3 blocker) and fine at the same widths.
    const openerEvidenceDir = path.resolve('.omo/evidence/final-f3-visual-qa');
    fs.mkdirSync(openerEvidenceDir, { recursive: true });
    const geometry: Record<string, unknown> = {};
    const writeGeometry = (): void => {
      fs.writeFileSync(
        path.join(openerEvidenceDir, 'f3s-fix-heading-opener-geometry.json'),
        JSON.stringify(geometry, null, 2)
      );
    };

    for (const hasTouch of [true, false]) {
      const pointerKind = hasTouch ? 'coarse' : 'fine';
      const { pages, contexts } = await startGame(browser, ['春嬌', '建宏', '淑芬', '志明'], {
        width: 375,
        height: 812,
        hasTouch,
      });
      try {
        const host = pages[0];
        await expect(host.locator('.table-panel')).toBeVisible();
        // Drawer mode: the persistent opener floats over the table as a fixed button.
        await expect(host.locator(SHOW_GAME_MENU)).toBeVisible();
        expect(await host.locator('.table-panel .table-heading h2').innerText()).toContain('證人圓桌');

        for (const viewport of [
          { width: 375, height: 812 },
          { width: 360, height: 800 },
        ]) {
          await host.setViewportSize(viewport);
          const state = `${viewport.width}x${viewport.height}-${pointerKind}`;
          // Geometry is written before asserting so a failing run still records the rectangles.
          const measured = await openerVsHeading(host);
          geometry[state] = measured;
          writeGeometry();
          await host.screenshot({
            path: path.join(openerEvidenceDir, `f3s-fix-heading-opener-${state}.png`),
          });
          expectHeadingClearsOpener(measured, state, viewport.width);

          // Same contract at 200% text, where the opener itself grows taller.
          await host.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
          });
          const zoomed = await openerVsHeading(host);
          geometry[`${state}-text200`] = zoomed;
          writeGeometry();
          await host.screenshot({
            path: path.join(openerEvidenceDir, `f3s-fix-heading-opener-${state}-text200.png`),
          });
          expectHeadingClearsOpener(zoomed, `${state} 200% text`, viewport.width);
          await host.evaluate(() => {
            document.documentElement.style.fontSize = '';
          });
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    }
  });

  test('opponent seat card backs never cover name, location, or state at any viewport', async ({
    browser,
  }) => {
    // F3 reviewer blocker: the 42px back tucked 32px into the seat painted over
    // the lower metadata lines at every width. Hard-bounded so a regression can
    // never hang the lane.
    test.setTimeout(90_000);
    const seatEvidenceDir = path.resolve('.omo/evidence/final-f3-visual-qa');
    fs.mkdirSync(seatEvidenceDir, { recursive: true });
    const { pages, contexts } = await startGame(browser, ['春嬌', '建宏', '淑芬', '志明'], {
      width: 360,
      height: 800,
    });
    try {
      const host = pages[0];
      // The server assigns locations per room, so pin the longest labels the
      // product renders (交誼廳 / 行動中, both three glyphs) for a deterministic
      // worst case before measuring.
      await host.evaluate(() => {
        for (const seat of document.querySelectorAll('.table-panel .seat')) {
          const location = seat.querySelector('.seat-location');
          const state = seat.querySelector('.seat-state');
          if (location) location.textContent = '交誼廳';
          if (state) state.textContent = '行動中';
        }
      });

      // Exactly one privacy-safe back per opponent seat, no role leak.
      const opponentSeats = host.locator('.table-panel .seat:not([aria-current="true"])');
      await expect(opponentSeats).toHaveCount(3);
      await expect(opponentSeats.locator('.seat-card')).toHaveCount(3);
      await expect(opponentSeats.locator('.card-back[data-owner="opponent"]')).toHaveCount(3);
      const opponentHtml = await opponentSeats.evaluateAll((elements) =>
        elements.map((element) => element.outerHTML)
      );
      for (const html of opponentHtml) {
        expect(findSecretLeaks(html), 'opponent seat leaks a role label').toEqual([]);
      }

      const geometry: Record<string, unknown> = {};
      const writeGeometry = (): void => {
        fs.writeFileSync(
          path.join(seatEvidenceDir, 'f3s-fix-seat-back-occlusion-geometry.json'),
          JSON.stringify(geometry, null, 2)
        );
      };

      for (const viewport of [
        { width: 360, height: 800 },
        { width: 375, height: 812 },
        { width: 768, height: 1024 },
        { width: 1280, height: 800 },
      ]) {
        await host.setViewportSize(viewport);
        const state = `${viewport.width}x${viewport.height}`;
        // Geometry is written before asserting so a red run still records rectangles.
        const measured = await opponentSeatRects(host);
        geometry[state] = measured;
        writeGeometry();
        if (viewport.width === 375 || viewport.width === 1280) {
          await host.screenshot({
            path: path.join(seatEvidenceDir, `f3s-fix-seat-back-occlusion-${state}.png`),
          });
        }
        expectOpponentSeatsClear(measured, state);
        expectNoSeatOverlap(await seatBoxes(host));
      }

      // 200% text at the F3 mobile width: the tallest seats must keep every line clear.
      await host.setViewportSize({ width: 375, height: 812 });
      await host.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const zoomed = await opponentSeatRects(host);
      geometry['375x812-text200'] = zoomed;
      writeGeometry();
      await host.screenshot({
        path: path.join(seatEvidenceDir, 'f3s-fix-seat-back-occlusion-375x812-text200.png'),
      });
      expectOpponentSeatsClear(zoomed, '375x812 200% text');
      expectNoSeatOverlap(await seatBoxes(host));

      // MUST DO: the hanging backs must never cover the centre Guest Room.
      // At 360 the top seat's back can poke under the target's box, so the
      // target keeps z-index 2 and every point inside it must still hit it.
      await host.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      await passToFirstEligible(pages[0]);
      await passToFirstEligible(pages[1]);
      await passToFirstEligible(pages[2]);
      const finalActor = pages[3];
      for (const viewport of [
        { width: 360, height: 800 },
        { width: 375, height: 812 },
      ]) {
        await finalActor.setViewportSize(viewport);
        const hits = await finalActor.evaluate(() => {
          const target = document.querySelector('.table-panel [data-target-id="guest-room"]');
          if (!(target instanceof HTMLElement)) throw new Error('guest room target missing');
          const box = target.getBoundingClientRect();
          const centreX = box.x + box.width / 2;
          const centreY = box.y + box.height / 2;
          const points: [number, number][] = [
            [centreX, centreY],
            [centreX, box.y + 4],
            [box.x + 4, centreY],
            [centreX, box.y + box.height - 4],
          ];
          return points.map(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return hit !== null && hit.closest('[data-target-id="guest-room"]') !== null;
          });
        });
        expect(hits, `guest room target stays on top at ${viewport.width}px`).toEqual([
          true,
          true,
          true,
          true,
        ]);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

interface SocketCapture {
  /** Every `choose_and_pass` the page actually sent. */
  readonly messages: Record<string, unknown>[];
  /** `choose_and_pass` messages actually forwarded to the real server. */
  forwarded: number;
  /** When true, the next `choose_and_pass` is answered with a forged error and dropped. */
  failChooseAndPass: boolean;
  /** Delay before the forged error so the transient pending state stays observable. */
  failDelayMs: number;
}

/** Records page → server actions while transparently proxying every other frame. */
async function captureSocket(page: Page, capture: SocketCapture): Promise<void> {
  await page.routeWebSocket('/ws', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString('utf8');
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      if (parsed?.type === 'choose_and_pass') {
        capture.messages.push(parsed);
        if (capture.failChooseAndPass) {
          capture.failChooseAndPass = false;
          const actionId = parsed.actionId;
          globalThis.setTimeout(() => {
            ws.send(
              JSON.stringify({
                type: 'error',
                code: 'INVALID_ACTION',
                message: 'transfer-coordinator test rejection',
                actionId,
              })
            );
          }, capture.failDelayMs);
          return;
        }
        capture.forwarded += 1;
      }
      server.send(message);
    });
  });
}

/** Merges one key into an evidence JSON file so parallel todos never overwrite each other. */
function recordEvidence(file: string, key: string, value: unknown): void {
  const target = path.join(evidenceDir, file);
  let data: Record<string, unknown> = {};
  if (fs.existsSync(target)) {
    try {
      data = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  data[key] = value;
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
}

const PAYLOAD_EVIDENCE = 'task-6-game-table-interaction-redesign-transfer-payloads.json';
const FAILURE_EVIDENCE = 'task-6-game-table-interaction-redesign-transfer-failures.json';

test.describe('Transfer coordinator (Todo 6)', () => {
  test('desktop drag confirms through the mandatory claim dialog with a byte-equivalent payload', async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, 'HTML5 drag is the desktop progressive-enhancement path');
    const capture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 1280, height: 800 },
      async (page, index) => {
        if (index === 0) await captureSocket(page, capture);
      }
    );
    try {
      const [alice, charlie] = [pages[0], pages[2]];
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();

      // The legacy draft widgets are gone: only the coordinator remains.
      for (const selector of [
        '#draft-form',
        '#recipient-select',
        '#testimony-select',
        '#keep-card-0',
        '#keep-card-1',
      ]) {
        await expect(alice.locator(selector)).toHaveCount(0);
      }

      const ids = await seatIds(alice);
      const charlieId = ids[2];
      const ownCardIds = await handCards(alice).evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-card-id') ?? '')
      );
      const [keptCardId, passedCardId] = ownCardIds;
      expect(passedCardId).not.toBe(keptCardId);

      // Real HTML5 drag of the second card onto Charlie's eligible seat.
      await handCards(alice).nth(1).dragTo(seatTarget(alice, charlieId));
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'confirming');
      await alice.screenshot({
        path: path.join(evidenceDir, 'task-6-claim-dialog-desktop-1280.png'),
        fullPage: true,
      });

      // Changing the claim never submits: two option changes send zero actions.
      const optionValues = await alice
        .locator('#claim-role-select option')
        .evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value));
      expect(optionValues[0]).toBe('');
      await alice.locator('#claim-role-select').selectOption('murderer');
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#claim-role-select').selectOption('');
      expect(capture.messages).toHaveLength(0);
      await expect(alice.locator('#btn-confirm-pass')).toBeEnabled();

      // Duplicate confirm: two synchronous clicks dispatch exactly one action.
      // The accepted projection can replace the pending dialog immediately, so the
      // observable contract is the action count and the advanced turn, not the
      // transient `data-state="pending"` (covered with a delayed rejection below).
      await alice.evaluate(() => {
        const confirm = document.querySelector<HTMLButtonElement>('#btn-confirm-pass');
        confirm?.click();
        confirm?.click();
      });
      await expect.poll(() => capture.messages.length).toBe(1);
      expect(capture.forwarded).toBe(1);

      const payload = capture.messages[0];
      expect(payload.type).toBe('choose_and_pass');
      expect(payload.keepCardId).toBe(keptCardId);
      expect(payload.passToPlayerId).toBe(charlieId);
      expect('testimonyRole' in payload).toBe(false);
      expect(typeof payload.baseVersion).toBe('number');
      expect(typeof payload.actionId).toBe('string');

      // The turn advanced after exactly one action; Charlie is the new actor.
      await expect(charlie.locator(DRAFT_CONTROLS)).toBeVisible();
      expect(capture.messages).toHaveLength(1);

      recordEvidence(PAYLOAD_EVIDENCE, 'desktopDrag', {
        keepCardId: payload.keepCardId,
        passedCardId,
        passToPlayerId: payload.passToPlayerId,
        testimonyRole: payload.testimonyRole ?? null,
        actionCount: capture.messages.length,
        forwarded: capture.forwarded,
        legacySelectorsAbsent: true,
        claimOptions: optionValues,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('keyboard-only pass, Escape cancel focus return, and role claim payload', async ({ browser }) => {
    const capture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 1280, height: 800 },
      async (page, index) => {
        if (index === 0) await captureSocket(page, capture);
      }
    );
    try {
      const alice = pages[0];
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();
      const ids = await seatIds(alice);
      const bobId = ids[1];
      const firstCard = handCards(alice).first();
      const passedCardId = await firstCard.getAttribute('data-card-id');
      if (!passedCardId) throw new Error('own card id missing');

      // Enter on the focused card opens its detail dialog.
      await firstCard.focus();
      await alice.keyboard.press('Enter');
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeVisible();

      // 傳遞此卡 by keyboard moves focus to the first eligible target.
      await alice.locator('#btn-pass-card').focus();
      await alice.keyboard.press('Enter');
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeHidden();
      await expect(seatTarget(alice, bobId)).toBeFocused();

      // Enter on the target opens the mandatory claim dialog with focus in it.
      await alice.keyboard.press('Enter');
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await expect(alice.locator('#claim-role-select')).toBeFocused();
      await alice.screenshot({
        path: path.join(evidenceDir, 'task-6-claim-dialog-keyboard-1280.png'),
        fullPage: true,
      });

      // Escape cancels: zero sends, focus returns to the initiating card.
      await alice.keyboard.press('Escape');
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(firstCard).toBeFocused();
      await expect(alice.locator('#btn-confirm-pass')).toBeEnabled();
      expect(capture.messages).toHaveLength(0);

      // Retry entirely by keyboard, this time confirming a claim.
      await alice.keyboard.press('Enter');
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeVisible();
      await alice.locator('#btn-pass-card').focus();
      await alice.keyboard.press('Enter');
      await alice.keyboard.press('Enter');
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      const optionValues = await alice
        .locator('#claim-role-select option')
        .evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value));
      await alice.keyboard.press('ArrowDown');
      await alice.keyboard.press('Tab');
      await alice.keyboard.press('Tab');
      await alice.keyboard.press('Enter');
      await expect.poll(() => capture.messages.length).toBe(1);

      const payload = capture.messages[0];
      expect(payload.keepCardId).not.toBe(passedCardId);
      expect(payload.passToPlayerId).toBe(bobId);
      expect(payload.testimonyRole).toBe(optionValues[1]);

      recordEvidence(PAYLOAD_EVIDENCE, 'keyboard', {
        keepCardId: payload.keepCardId,
        passedCardId,
        passToPlayerId: payload.passToPlayerId,
        testimonyRole: payload.testimonyRole,
        actionCount: capture.messages.length,
        escapeCancelFocusReturned: true,
        escapeCancelSends: 0,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('final actor passes to the Guest Room with passToPlayerId omitted', async ({ browser }) => {
    const capture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 1280, height: 800 },
      async (page, index) => {
        if (index === 2) await captureSocket(page, capture);
      }
    );
    try {
      const [alice, bob, charlie] = pages;
      await passToFirstEligible(alice);
      await expect(bob.locator(DRAFT_CONTROLS)).toBeVisible();
      await passToFirstEligible(bob);
      await expect(charlie.locator(DRAFT_CONTROLS)).toBeVisible();

      // No seat is a target for the final actor; the Guest Room is the only one.
      await expect(charlie.locator('.table-panel .seats button.seat-target')).toHaveCount(0);
      const ownCardIds = await handCards(charlie).evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-card-id') ?? '')
      );
      const passedCardId = ownCardIds[1];

      await armCard(charlie, 1);
      await expect(guestRoomTarget(charlie)).toBeFocused();
      await charlie.keyboard.press('Enter');
      await expect(charlie.locator(CLAIM_DIALOG)).toBeVisible();
      await charlie.screenshot({
        path: path.join(evidenceDir, 'task-6-guest-room-claim-1280.png'),
        fullPage: true,
      });
      await charlie.locator('#claim-role-select').selectOption('guest');
      await charlie.locator('#btn-confirm-pass').click();
      await expect.poll(() => capture.messages.length).toBe(1);

      const payload = capture.messages[0];
      expect(payload.type).toBe('choose_and_pass');
      expect('passToPlayerId' in payload).toBe(false);
      expect(payload.keepCardId).not.toBe(passedCardId);
      expect(payload.testimonyRole).toBe('guest');

      // The server advanced to discussion and recorded a Guest Room drop.
      await expect(charlie.locator('h2:has-text("自由討論階段")')).toBeVisible();
      await expect(charlie.locator('#testimony-panel')).toContainText('客房（扣置）');

      recordEvidence(PAYLOAD_EVIDENCE, 'guestRoom', {
        keepCardId: payload.keepCardId,
        passedCardId,
        passToPlayerId: payload.passToPlayerId ?? null,
        testimonyRole: payload.testimonyRole,
        actionCount: capture.messages.length,
        phase: 'discussion',
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('cancel clears card, target, and highlights; missing target and unknown ids stay idle', async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, 'Synthetic drop assertions run once on desktop; touch uses the dialog path');
    const capture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 1280, height: 800 },
      async (page, index) => {
        if (index === 0) await captureSocket(page, capture);
      }
    );
    try {
      const alice = pages[0];
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();
      const ids = await seatIds(alice);
      const [aliceId, bobId] = ids;
      const draggedCardId = await handCards(alice).nth(1).getAttribute('data-card-id');
      if (!draggedCardId) throw new Error('own card id missing');

      // Missing target: arming a card alone never opens the claim dialog.
      await armCard(alice, 1);
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('#transfer-status')).toContainText('目標');
      await expect(handCards(alice).nth(1)).toHaveClass(/is-selected/);

      // Unknown dragged id never arms anything and sends nothing.
      await dropCard(alice, bobId, 'forged-card-000');
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      expect(capture.messages).toHaveLength(0);

      // Selecting a target then cancel clears both selections and focus returns to the card.
      await dropCard(alice, bobId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-cancel-pass').click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'idle');
      await expect(alice.locator('#btn-confirm-pass')).toBeEnabled();
      await expect(alice.locator('#btn-confirm-pass')).not.toHaveAttribute('aria-busy', 'true');
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);
      await expect(alice.locator('.table-panel .hand-slot .card-face.is-selected')).toHaveCount(0);
      await expect(alice.locator('#transfer-status')).toHaveText(/點擊卡片|拖曳卡片/);
      await expect(handCards(alice).nth(1)).toBeFocused();
      expect(capture.messages).toHaveLength(0);

      // Stale selection: a drop on the viewer's own seat changes nothing.
      await dropCard(alice, aliceId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);

      // Retry after cancel still sends exactly one correct action.
      await dropCard(alice, bobId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-confirm-pass').click();
      await expect.poll(() => capture.messages.length).toBe(1);
      const payload = capture.messages[0];
      expect(payload.passToPlayerId).toBe(bobId);
      expect(payload.keepCardId).not.toBe(draggedCardId);

      recordEvidence(FAILURE_EVIDENCE, 'cancelAndStaleProbes', {
        cancelClearsSelection: true,
        cancelFocusReturned: true,
        cancelSends: 0,
        missingTargetOpensClaim: false,
        unknownDragIdOpensClaim: false,
        ownSeatDropOpensClaim: false,
        retrySends: capture.messages.length,
        retryPassToPlayerId: payload.passToPlayerId,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('dispatch false resets to idle with a focused alert and survives reconnect', async ({
    browser,
  }) => {
    const capture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 1280, height: 800 },
      async (page, index) => {
        if (index === 0) await captureSocket(page, capture);
      }
    );
    try {
      const alice = pages[0];
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();
      const ids = await seatIds(alice);
      const bobId = ids[1];
      const draggedCardId = await handCards(alice).nth(1).getAttribute('data-card-id');
      if (!draggedCardId) throw new Error('own card id missing');

      await dropCard(alice, bobId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();

      // Drop the socket so dispatchAction() returns false synchronously.
      await alice.evaluate(() => {
        (
          window as unknown as { __NOW__?: { client: { disconnect(): void } } }
        ).__NOW__?.client.disconnect();
      });
      await alice.locator('#btn-confirm-pass').click();

      const alert = alice.locator('#phase-action-panel [role="alert"]');
      await expect(alert).toBeVisible();
      await expect(alert).toBeFocused();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'idle');
      await expect(alice.locator('#btn-confirm-pass')).toBeEnabled();
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);
      expect(capture.messages).toHaveLength(0);
      const alertText = (await alert.textContent()) ?? '';

      // Reconnect replays the same projection; the rerender replaces the whole view,
      // so wait for the pre-reconnect DOM to be gone before retrying.
      await alice.evaluate(() =>
        document.querySelector('#draft-controls')?.setAttribute('data-stale-probe', 'true')
      );
      await alice.evaluate(() => {
        (window as unknown as { __NOW__?: { client: { connect(): void } } }).__NOW__?.client.connect();
      });
      await expect(alice.locator('#draft-controls[data-stale-probe]')).toHaveCount(0);
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();
      await dropCard(alice, bobId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-confirm-pass').click();
      await expect.poll(() => capture.messages.length).toBe(1);

      recordEvidence(FAILURE_EVIDENCE, 'dispatchFalse', {
        alertText,
        alertFocused: true,
        claimDialogReset: true,
        sendsBeforeRetry: 0,
        sendsAfterRetry: capture.messages.length,
        recoveredAfterReconnect: true,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('server rejection returns pending to idle and the retry succeeds', async ({ browser }) => {
    const capture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: true,
      failDelayMs: 400,
    };
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 1280, height: 800 },
      async (page, index) => {
        if (index === 0) await captureSocket(page, capture);
      }
    );
    try {
      const alice = pages[0];
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();
      const ids = await seatIds(alice);
      const bobId = ids[1];
      const draggedCardId = await handCards(alice).nth(1).getAttribute('data-card-id');
      if (!draggedCardId) throw new Error('own card id missing');

      await dropCard(alice, bobId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-confirm-pass').click();
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'pending');
      await expect(alice.locator('#btn-confirm-pass')).toBeDisabled();

      // The forged server error must replace the pending dialog with a focused alert.
      const alert = alice.locator('#app [role="alert"]');
      await expect(alert).toContainText('transfer-coordinator test rejection');
      await expect(alert).toBeFocused();
      await expect(alice.locator('#btn-confirm-pass')).toBeEnabled();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator(DRAFT_CONTROLS)).toBeVisible();
      await expect(handCards(alice)).toHaveCount(2);
      expect(capture.messages).toHaveLength(1);
      expect(capture.forwarded).toBe(0);

      // The UI is usable: the retry reaches the real server and advances the turn.
      await dropCard(alice, bobId, draggedCardId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-confirm-pass').click();
      await expect.poll(() => capture.messages.length).toBe(2);
      expect(capture.forwarded).toBe(1);
      await expect(pages[1].locator(DRAFT_CONTROLS)).toBeVisible();

      recordEvidence(FAILURE_EVIDENCE, 'serverError', {
        alertText: 'transfer-coordinator test rejection',
        alertFocused: true,
        pendingResetToIdle: true,
        rejectedActions: 1,
        forwardedBeforeRetry: 0,
        retryActions: 2,
        retryForwarded: 1,
        turnAdvanced: true,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

const SHELL_EVIDENCE = 'task-7-game-table-interaction-redesign-mobile.json';
const SHELL_FAILURE_EVIDENCE = 'task-7-game-table-interaction-redesign-mobile-failures.json';
const GAME_MENU_STATE_KEY = 'night-of-witnesses.game-menu-collapsed.v1';

/** Reads the exact persisted collapse boolean. */
function readMenuCollapsed(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.sessionStorage.getItem(key), GAME_MENU_STATE_KEY);
}

/** Drawer viewports report the content box off-canvas while the panel is closed. */
async function isOffCanvas(page: Page): Promise<boolean> {
  const box = await page.locator('#game-menu-content').boundingBox();
  return box === null || box.x + box.width <= 1;
}

/** Emits a small screenshot plus a merged evidence key for one shell scenario. */
async function captureShellEvidence(
  page: Page,
  file: string,
  name: string,
  extra: Record<string, unknown>
): Promise<void> {
  // Viewport capture only: fullPage capture re-lays-out fixed drawer elements and lies.
  await page.screenshot({ path: path.join(evidenceDir, file), fullPage: false });
  recordEvidence(SHELL_EVIDENCE, name, extra);
}

test.describe('Adaptive game shell (Todo 7)', () => {
  test('desktop menu collapses, persists across rerender/reconnect/reload, and keeps information available to assistive technology', async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, 'the fine-pointer shell runs once on chromium');
    const { pages, contexts } = await startGame(browser, ['愛麗絲', '鮑伯', '查理'], {
      width: 1280,
      height: 800,
    });
    try {
      const alice = pages[0];
      const menu = alice.locator(GAME_MENU);
      const toggle = alice.locator('#btn-toggle-game-menu');
      const content = alice.locator('#game-menu-content');

      // Fine-pointer fallback is untouched: clicking a card still opens its detail dialog.
      await expect(menu).toHaveAttribute('data-state', 'expanded');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toHaveAttribute('aria-controls', 'game-menu-content');
      await expect(alice.locator(SHOW_GAME_MENU)).toBeHidden();
      await handCards(alice).first().click();
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeVisible();
      await alice.keyboard.press('Escape');
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeHidden();

      // Collapsing persists the exact sessionStorage boolean and shrinks to the 64px rail.
      await toggle.click();
      await expect(menu).toHaveAttribute('data-state', 'collapsed');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect
        .poll(async () => menu.evaluate((node) => Math.round(node.getBoundingClientRect().width)))
        .toBe(64);
      expect(await readMenuCollapsed(alice)).toBe('true');

      // Visually collapsed information stays in the accessibility tree.
      await expect(content).toBeAttached();
      await expect(content).not.toHaveAttribute('aria-hidden', 'true');
      expect(await content.evaluate((node) => window.getComputedStyle(node).display)).not.toBe('none');
      await expect(content.locator('#room-info')).toHaveText(/房間/);
      await expect(content.locator('#phase-info')).toHaveText(/階段/);
      await expect(content.locator('#btn-toggle-role')).toBeAttached();
      await expect(content.locator('#testimony-panel')).toBeAttached();

      // A projection rerender (reconnect replay) must not reopen the menu.
      await alice.evaluate(() => document.querySelector('#game-menu')?.setAttribute('data-stale-probe', 'true'));
      await alice.evaluate(() => {
        (window as unknown as { __NOW__?: { client: { disconnect(): void } } }).__NOW__?.client.disconnect();
      });
      await alice.evaluate(() => {
        (window as unknown as { __NOW__?: { client: { connect(): void } } }).__NOW__?.client.connect();
      });
      await expect(alice.locator('#game-menu[data-stale-probe]')).toHaveCount(0);
      await expect(alice.locator(GAME_MENU)).toHaveAttribute('data-state', 'collapsed');
      expect(await readMenuCollapsed(alice)).toBe('true');

      // Reload keeps the collapsed boolean from sessionStorage.
      await alice.reload();
      await expect(alice.locator('.table-panel')).toBeVisible({ timeout: 15000 });
      await expect(alice.locator(GAME_MENU)).toHaveAttribute('data-state', 'collapsed');
      expect(await readMenuCollapsed(alice)).toBe('true');

      // Expanding restores the clamp(240px, 22vw, 300px) sidebar and writes false.
      await alice.locator('#btn-toggle-game-menu').click();
      await expect(alice.locator(GAME_MENU)).toHaveAttribute('data-state', 'expanded');
      await expect(alice.locator('#btn-toggle-game-menu')).toHaveAttribute('aria-expanded', 'true');
      await expect
        .poll(async () =>
          alice.locator(GAME_MENU).evaluate((node) => Math.round(node.getBoundingClientRect().width))
        )
        .toBeGreaterThanOrEqual(240);
      expect(await readMenuCollapsed(alice)).toBe('false');
      const expandedWidth = await alice
        .locator(GAME_MENU)
        .evaluate((node) => Math.round(node.getBoundingClientRect().width));
      expect(expandedWidth).toBeLessThanOrEqual(300);

      recordEvidence(SHELL_EVIDENCE, 'desktopPersistence', {
        key: GAME_MENU_STATE_KEY,
        collapsedWidth: 64,
        expandedWidth,
        survivesReconnect: true,
        survivesReload: true,
        atInformationPresent: true,
        finePointerDetailFallback: true,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('mobile drawer is closed by default, opens with body-scroll safety, and Escape restores focus', async ({
    browser,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the coarse-pointer drawer runs on the mobile project');
    const { pages, contexts } = await startGame(browser, ['愛麗絲', '鮑伯', '查理'], {
      width: 393,
      height: 851,
      hasTouch: true,
    });
    try {
      const alice = pages[0];
      const menu = alice.locator(GAME_MENU);
      const content = alice.locator('#game-menu-content');
      const show = alice.locator(SHOW_GAME_MENU);

      await expect(menu).toHaveAttribute('data-state', 'closed');
      await expect(show).toBeVisible();
      await expect(show).toHaveAttribute('aria-expanded', 'false');
      await expect(show).toHaveAttribute('aria-controls', 'game-menu-content');
      await expect(alice.locator('#btn-toggle-game-menu')).toBeHidden();
      const showBox = await show.boundingBox();
      expect(showBox).not.toBeNull();
      if (showBox) {
        expect(showBox.width).toBeGreaterThanOrEqual(44);
        expect(showBox.height).toBeGreaterThanOrEqual(44);
      }

      // Closed drawer is off-canvas: no stale overlay and no body scroll lock.
      await expect.poll(async () => isOffCanvas(alice)).toBe(true);
      expect(await alice.evaluate(() => window.getComputedStyle(document.body).overflow)).not.toBe('hidden');

      // No page-level overflow at any narrow viewport while closed.
      for (const width of [393, 375, 360]) {
        await alice.setViewportSize({ width, height: 851 });
        expect(
          await alice.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth
          ),
          `overflow at ${width} with the drawer closed`
        ).toBe(false);
      }
      await alice.setViewportSize({ width: 393, height: 851 });

      // Opening shows the panels and locks background scrolling.
      await show.click();
      await expect(menu).toHaveAttribute('data-state', 'open');
      await expect(show).toHaveAttribute('aria-expanded', 'true');
      await expect
        .poll(async () => alice.evaluate(() => window.getComputedStyle(document.body).overflow))
        .toBe('hidden');
      await expect.poll(async () => isOffCanvas(alice)).toBe(false);
      await expect(alice.locator('#game-header')).toBeVisible();
      await expect(alice.locator('#btn-toggle-role')).toBeVisible();
      await expect(alice.locator('#testimony-panel')).toBeAttached();
      await expect(alice.locator('#phase-action-panel')).toBeAttached();
      expect(
        await alice.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth
        ),
        'overflow at 360 with the drawer open'
      ).toBe(false);
      await captureShellEvidence(
        alice,
        'task-7-game-table-interaction-redesign-mobile-393.png',
        'mobileDrawer',
        {
          closedByDefault: true,
          showButtonVisible: true,
          drawerWidth: await content.evaluate((node) => Math.round(node.getBoundingClientRect().width)),
          bodyScrollLocked: true,
          atInformationPresent: true,
          viewportsChecked: [393, 375, 360],
        }
      );

      // Escape closes the drawer and returns focus to the persistent opener.
      await alice.keyboard.press('Escape');
      await expect(menu).toHaveAttribute('data-state', 'closed');
      await expect(show).toBeFocused();
      await expect
        .poll(async () => alice.evaluate(() => window.getComputedStyle(document.body).overflow))
        .not.toBe('hidden');
      await expect.poll(async () => isOffCanvas(alice)).toBe(true);

      // The opener toggles as well: open then close with the same button.
      await show.click();
      await expect(menu).toHaveAttribute('data-state', 'open');
      await show.click();
      await expect(menu).toHaveAttribute('data-state', 'closed');
      await expect.poll(async () => isOffCanvas(alice)).toBe(true);
      recordEvidence(SHELL_FAILURE_EVIDENCE, 'escapeDrawer', {
        escapeClosed: true,
        focusReturnedToOpener: true,
        bodyScrollRestored: true,
        toggleClosed: true,
        staleOverlay: false,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('coarse-pointer tap selection opens the mandatory claim for players and the Guest Room', async ({
    browser,
    isMobile,
  }) => {
    test.skip(!isMobile, 'tap selection requires a coarse pointer');
    const aliceCapture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const bobCapture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const charlieCapture: SocketCapture = {
      messages: [],
      forwarded: 0,
      failChooseAndPass: false,
      failDelayMs: 0,
    };
    const captures = [aliceCapture, bobCapture, charlieCapture];
    const { pages, contexts } = await startGame(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      { width: 393, height: 851, hasTouch: true },
      async (page, index) => {
        await captureSocket(page, captures[index]);
      }
    );
    try {
      const [alice, bob, charlie] = pages;
      const ids = await seatIds(alice);
      const [aliceId, bobId, charlieId] = ids;
      const cards = handCards(alice);
      const [firstCardId, secondCardId] = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-card-id') ?? '')
      );
      expect(firstCardId).not.toBe(secondCardId);

      // The detail button opens details without selecting and Escape restores its focus.
      await cards.nth(0).locator('[data-action="view-card"]').click();
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeVisible();
      await expect(cards.nth(0)).not.toHaveClass(/is-selected/);
      await alice.keyboard.press('Escape');
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeHidden();
      await expect(cards.nth(0)).not.toHaveClass(/is-selected/);
      await expect(cards.nth(0).locator('[data-action="view-card"]')).toBeFocused();

      // Tap selects, tapping the other card replaces the selection.
      await cards.nth(0).click();
      await expect(cards.nth(0)).toHaveClass(/is-selected/);
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeHidden();
      await cards.nth(1).click();
      await expect(cards.nth(1)).toHaveClass(/is-selected/);
      await expect(cards.nth(0)).not.toHaveClass(/is-selected/);
      await expect(alice.locator('#transfer-status')).toContainText('目標');

      // Self and non-target seats stay idle: no claim, no stale overlay, no action.
      await alice.locator(`.table-panel .seat[data-player-id="${aliceId}"]`).click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);
      expect(aliceCapture.messages).toHaveLength(0);

      // An eligible seat tap opens the mandatory claim dialog with focus inside.
      await seatTarget(alice, bobId).click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'confirming');
      await expect(alice.locator('#claim-role-select')).toBeFocused();

      // Cancel clears the card and target without dispatching.
      await alice.locator('#btn-cancel-pass').click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('.table-panel .hand-slot .card-face.is-selected')).toHaveCount(0);
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);
      expect(aliceCapture.messages).toHaveLength(0);

      // Retry by tap: card then target, confirmed through the claim dialog.
      await cards.nth(0).click();
      await expect(cards.nth(0)).toHaveClass(/is-selected/);
      await seatTarget(alice, bobId).click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-confirm-pass').click();
      await expect.poll(() => aliceCapture.messages.length).toBe(1);
      const payload = aliceCapture.messages[0];
      expect(payload.keepCardId).toBe(secondCardId);
      expect(payload.passToPlayerId).toBe(bobId);
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();

      // Served seats reject taps after the pass: no claim and no stale overlay.
      const bobSeat = alice.locator(`.table-panel .seat[data-player-id="${bobId}"]`);
      await expect(bobSeat).toHaveClass(/is-served/);
      await bobSeat.click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(alice.locator('.table-panel .seat.is-targeted')).toHaveCount(0);
      expect(aliceCapture.messages).toHaveLength(1);

      // Bob passes to Charlie by tap, then Charlie's Guest Room tap is the final path.
      await expect(bob.locator('.table-panel .seat[aria-current="true"].is-active')).toHaveCount(1);
      const bobCards = handCards(bob);
      await bobCards.nth(1).click();
      await expect(bobCards.nth(1)).toHaveClass(/is-selected/);
      await seatTarget(bob, charlieId).click();
      await expect(bob.locator(CLAIM_DIALOG)).toBeVisible();
      await bob.locator('#btn-confirm-pass').click();
      await expect.poll(() => bobCapture.messages.length).toBe(1);

      await expect(charlie.locator('.table-panel .seat[aria-current="true"].is-active')).toHaveCount(1);
      const charlieCards = handCards(charlie);
      await charlieCards.nth(0).click();
      await expect(charlieCards.nth(0)).toHaveClass(/is-selected/);
      await guestRoomTarget(charlie).click();
      await expect(charlie.locator(CLAIM_DIALOG)).toBeVisible();
      await expect(charlie.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'confirming');
      await charlie.locator('#btn-confirm-pass').click();
      await expect.poll(() => charlieCapture.messages.length).toBe(1);
      const guestPayload = charlieCapture.messages[0];
      expect(guestPayload.type).toBe('choose_and_pass');
      expect('passToPlayerId' in guestPayload).toBe(false);
      await expect(charlie.locator(CLAIM_DIALOG)).toBeHidden();
      await expect(charlie.locator('.table-panel [data-target-id="guest-room"]')).toHaveCount(0);

      recordEvidence(SHELL_EVIDENCE, 'tapSelection', {
        tapSelectsCard: true,
        tapReplacesSelection: true,
        detailButtonSelects: false,
        selfSeatOpensClaim: false,
        servedSeatOpensClaim: false,
        cancelSends: 0,
        claimIsMandatory: true,
        passToPlayerId: payload.passToPlayerId,
        keepCardId: payload.keepCardId,
        guestRoomOmitsPassToPlayerId: true,
      });
      recordEvidence(SHELL_FAILURE_EVIDENCE, 'tapProbes', {
        detailButtonSelects: false,
        selfSeatOpensClaim: false,
        servedSeatOpensClaim: false,
        cancelSends: 0,
        staleOverlayAfterConfirm: false,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('coarse pointer keeps the drawer and tap selection at a wide viewport', async ({
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, 'the explicit touch-context probe runs once on chromium');
    const { pages, contexts } = await startGame(browser, ['愛麗絲', '鮑伯', '查理'], {
      width: 1280,
      height: 800,
      hasTouch: true,
    });
    try {
      const alice = pages[0];
      await expect(alice.locator(GAME_MENU)).toHaveAttribute('data-state', 'closed');
      await expect(alice.locator(SHOW_GAME_MENU)).toBeVisible();
      await expect(alice.locator('#btn-toggle-game-menu')).toBeHidden();

      // Capability, not viewport width, chooses the interaction mode.
      const cards = handCards(alice);
      await cards.nth(0).click();
      await expect(cards.nth(0)).toHaveClass(/is-selected/);
      await expect(alice.locator(CARD_DETAIL_DIALOG)).toBeHidden();
      await captureShellEvidence(
        alice,
        'task-7-game-table-interaction-redesign-mobile-1280-coarse.png',
        'wideCoarsePointer',
        {
          viewport: { width: 1280, height: 800 },
          drawerState: 'closed',
          tapSelectsCard: true,
          detailDialogOpened: false,
        }
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
