/**
 * Shared Todo 6 transfer-coordinator helpers.
 *
 * Every helper here drives the non-drag canonical path: card detail dialog →
 * `#btn-pass-card` → target activation → mandatory claim dialog. Desktop drag
 * stays a spec-local progressive enhancement because HTML5 drag is not
 * available on touch devices.
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';

export const CLAIM_DIALOG = '#claim-dialog';
export const CARD_DETAIL_DIALOG = '#card-detail-dialog';
export const DRAFT_CONTROLS = '#draft-controls';
export const GAME_MENU = '#game-menu';
export const SHOW_GAME_MENU = '#btn-show-game-menu';

/** Opens the mobile drawer when this viewport/pointer exposes it; no-op on expanded desktop menus. */
export async function openGameMenu(page: Page): Promise<void> {
  const show = page.locator(SHOW_GAME_MENU);
  if (!(await show.isVisible())) return;
  if ((await page.locator(GAME_MENU).getAttribute('data-state')) === 'open') return;
  await show.click();
  await expect(page.locator(GAME_MENU)).toHaveAttribute('data-state', 'open');
}

/** Closes the mobile drawer so table-level clicks are not covered; no-op when already closed. */
export async function closeGameMenu(page: Page): Promise<void> {
  const menu = page.locator(GAME_MENU);
  if ((await menu.count()) === 0) return;
  if ((await menu.getAttribute('data-state')) !== 'open') return;
  await page.locator(SHOW_GAME_MENU).click();
  await expect(menu).toHaveAttribute('data-state', 'closed');
}

export function handCards(page: Page): Locator {
  return page.locator('.table-panel .hand-slot .card-face[data-hand="viewer"]');
}

export function seatTarget(page: Page, playerId: string): Locator {
  return page.locator(`.table-panel .seat[data-player-id="${playerId}"] button.seat-target`);
}

export function firstSeatTarget(page: Page): Locator {
  return page.locator('.table-panel .seats button.seat-target').first();
}

export function guestRoomTarget(page: Page): Locator {
  return page.locator('.table-panel [data-target-id="guest-room"]');
}

/** Opens one hand card's detail dialog and arms it for passing. */
export async function armCard(page: Page, index = 0): Promise<void> {
  await expect(handCards(page)).toHaveCount(2);
  await handCards(page).nth(index).locator('[data-action="view-card"]').click();
  await expect(page.locator(CARD_DETAIL_DIALOG)).toBeVisible();
  await page.locator('#btn-pass-card').click();
  await expect(page.locator(CARD_DETAIL_DIALOG)).toBeHidden();
}

/** Confirms the mandatory claim dialog; `role === undefined` keeps 「不特別聲明」. */
export async function confirmClaim(page: Page, role?: string): Promise<void> {
  await expect(page.locator(CLAIM_DIALOG)).toBeVisible();
  if (role !== undefined && role !== '') {
    await page.locator('#claim-role-select').selectOption(role);
  }
  await page.locator('#btn-confirm-pass').click();
}

/** Full non-drag flow onto whichever seat is the first eligible target. */
export async function passToFirstEligible(page: Page, role?: string): Promise<void> {
  await armCard(page);
  await firstSeatTarget(page).click();
  await confirmClaim(page, role);
}

/** Full non-drag flow for the final actor: leftover card goes to the Guest Room. */
export async function passToGuestRoom(page: Page, role?: string): Promise<void> {
  await armCard(page);
  await guestRoomTarget(page).click();
  await confirmClaim(page, role);
}

export interface StartedRoom {
  readonly pages: Page[];
  readonly contexts: BrowserContext[];
  readonly roomCode: string;
}

export interface StartRoomOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Runs before navigation so `page.routeWebSocket` can intercept the first socket. */
  readonly onPage?: (page: Page, index: number) => Promise<void>;
  /** Extra context options per client, e.g. `reducedMotion` or `recordVideo`. */
  readonly contextOptions?: (index: number) => BrowserContextOptions;
  /** Host-selected level; required by the server for >3 players (e.g. 'L3'). */
  readonly level?: string;
}

/** One context per name, joined into one room, readied up, and started into the draft. */
export async function startRoom(
  browser: Browser,
  names: readonly string[],
  options: StartRoomOptions = {}
): Promise<StartedRoom> {
  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const contexts = await Promise.all(
    names.map((_, index) =>
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        ...options.contextOptions?.(index),
      })
    )
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const { onPage } = options;
  if (onPage) {
    await Promise.all(pages.map((page, index) => onPage(page, index)));
  }
  const host = pages[0];
  await host.goto('/');
  await host.fill('#player-name-input', names[0]);
  await host.click('#btn-create-room');
  await expect(host.locator('#lobby-panel')).toBeVisible();
  const code = (await host.locator('#lobby-panel h1').innerText()).match(/[A-Z0-9]{6}/)?.[0];
  if (!code) throw new Error('room code missing');
  for (let index = 1; index < pages.length; index += 1) {
    const page = pages[index];
    await page.goto(`/?room=${code}`);
    await page.fill('#player-name-input', names[index]);
    await page.click('#btn-join-room');
    await expect(page.locator('#lobby-panel')).toBeVisible();
  }
  if (options.level !== undefined) {
    await host.selectOption('#level-select', options.level);
  }
  for (const page of pages) await page.click('#btn-toggle-ready');
  const startButton = host.locator('#btn-start-game');
  await expect(startButton).toBeEnabled();
  await startButton.click();
  // The table surface is visible on every viewport; menu panels may live in a closed drawer.
  for (const page of pages) await expect(page.locator('.table-panel')).toBeVisible();
  return { pages, contexts, roomCode: code };
}

/**
 * Completes the draft in canonical join order. Each pass waits for that page's own
 * hand cards, so the loop self-synchronizes with the authoritative current actor.
 */
export async function completeDraft(pages: readonly Page[]): Promise<void> {
  for (let index = 0; index < pages.length; index += 1) {
    if (index === pages.length - 1) {
      await passToGuestRoom(pages[index]);
    } else {
      await passToFirstEligible(pages[index]);
    }
  }
}

/** Discussion → voting → ballots, then every page must show the results panel. */
export async function playToResults(pages: readonly Page[]): Promise<void> {
  await completeDraft(pages);
  const host = pages[0];
  await expect(host.locator('.table-action-dock h2')).toHaveText('自由討論階段');
  await host.locator('.table-action-dock #btn-advance-vote').click();
  for (const page of pages) {
    await expect(page.locator('.table-action-dock h2')).toHaveText('投票指認階段');
  }
  for (const page of pages) {
    await page.locator('.table-action-dock #btn-submit-vote').click();
  }
  for (const page of pages) {
    await expect(page.locator('#results-panel')).toBeVisible({ timeout: 15000 });
  }
}

export interface RevealProbeSnapshot {
  readonly revealed: boolean;
  readonly cards: number;
  readonly faces: ReadonlyArray<{
    readonly transform: string;
    readonly visibility: string;
    readonly backface: string;
  }>;
  readonly backs: ReadonlyArray<{ readonly visibility: string }>;
}

export interface RevealTransitionRun {
  readonly time: number;
  readonly target: string;
}

declare global {
  interface Window {
    __NOW_REVEAL_PROBE__?: {
      snapshot: RevealProbeSnapshot | null;
      transitionRuns: RevealTransitionRun[];
    };
  }
}

/**
 * Records the results reveal without touching application code:
 * a MutationObserver captures the pre-reveal computed state in its microtask
 * (before the next animation frame may add `.is-revealed`), and a
 * `transitionrun` listener records every result-card flip start time.
 */
export async function installRevealProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: {
      snapshot: RevealProbeSnapshot | null;
      transitionRuns: RevealTransitionRun[];
    } = { snapshot: null, transitionRuns: [] };
    window.__NOW_REVEAL_PROBE__ = probe;

    const styleOf = (element: Element | null): CSSStyleDeclaration | null =>
      element ? getComputedStyle(element) : null;

    const observer = new MutationObserver(() => {
      if (probe.snapshot) return;
      const table = document.querySelector('.results-reveal');
      if (!table) return;
      const cards = Array.from(table.querySelectorAll('.result-card'));
      if (cards.length === 0) return;
      probe.snapshot = {
        revealed: table.classList.contains('is-revealed'),
        cards: cards.length,
        faces: cards.map((card) => {
          const style = styleOf(card.querySelector('.card-face'));
          return {
            transform: style?.transform ?? '',
            visibility: style?.visibility ?? '',
            backface: style?.backfaceVisibility ?? '',
          };
        }),
        backs: cards.map((card) => ({
          visibility: styleOf(card.querySelector('.card-back'))?.visibility ?? '',
        })),
      };
    });
    observer.observe(document, { childList: true, subtree: true });

    document.addEventListener(
      'transitionrun',
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('result-card')) return;
        probe.transitionRuns.push({
          time: performance.now(),
          target: target.dataset.playerId ?? target.dataset.targetId ?? 'unknown',
        });
      },
      true
    );
  });
}
