import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  passToFirstEligible,
  passToGuestRoom,
  openGameMenu,
  closeGameMenu,
  startRoom,
  playToResults,
  installRevealProbe,
} from './draft-flow.ts';
import { getTableSeats } from '../../src/client/views/game-seating.ts';
import { FACTIONS, ROLES } from '../../src/shared/rules.ts';

const revealEvidenceDir = path.resolve(process.cwd(), '.omo/evidence');

function writeRevealEvidence(fileName: string, payload: unknown): void {
  if (!fs.existsSync(revealEvidenceDir)) fs.mkdirSync(revealEvidenceDir, { recursive: true });
  fs.writeFileSync(path.join(revealEvidenceDir, fileName), JSON.stringify(payload, null, 2));
}

function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

function resultsColumnCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layout = document.querySelector('.results-layout');
    return layout ? getComputedStyle(layout).gridTemplateColumns.split(' ').length : 0;
  });
}

test.describe('Results, Loading, Empty and Recovery States', () => {
  test('three-player complete round to results, edge cases and rematch', async ({ browser }) => {
    const ctxAlice = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxBob = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const ctxCharlie = await browser.newContext({ viewport: { width: 375, height: 667 } });

    const pAlice = await ctxAlice.newPage();
    const pBob = await ctxBob.newPage();
    const pCharlie = await ctxCharlie.newPage();

    // 1. Join room and start L1 game
    await pAlice.goto('/');
    await pAlice.locator('#player-name-input').fill('AliceHost');
    await pAlice.locator('#btn-create-room').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible();

    const roomHeader = await pAlice.locator('#lobby-panel header h1').textContent();
    const roomCode = roomHeader?.replace('房間代碼：', '').trim()!;
    expect(roomCode.length).toBe(6);

    for (const [page, name] of [[pBob, 'BobGuest'], [pCharlie, 'CharlieGuest']] as const) {
      await page.goto(`/?room=${roomCode}`);
      await page.locator('#player-name-input').fill(name);
      await page.locator('#btn-join-room').click();
      await expect(page.locator('#lobby-panel')).toBeVisible();
    }

    await pAlice.locator('#btn-toggle-ready').click();
    await pBob.locator('#btn-toggle-ready').click();
    await pCharlie.locator('#btn-toggle-ready').click();

    await expect(pAlice.locator('#btn-start-game')).toBeEnabled();
    await pAlice.locator('#btn-start-game').click();

    // 2. Draft phase; the table surface is the visible signal on drawer viewports.
    await expect(pAlice.locator('#game-header')).toBeVisible();
    await expect(pBob.locator('#game-header')).toBeVisible();
    await expect(pCharlie.locator('.table-panel')).toBeVisible();

    // Alice passes to Bob, Bob to Charlie, Charlie's leftover goes to the Guest Room.
    await openGameMenu(pAlice);
    await expect(pAlice.locator('#draft-controls')).toBeVisible();
    await closeGameMenu(pAlice);
    await passToFirstEligible(pAlice);

    await openGameMenu(pBob);
    await expect(pBob.locator('#draft-controls')).toBeVisible();
    await closeGameMenu(pBob);
    await passToFirstEligible(pBob);

    await openGameMenu(pCharlie);
    await expect(pCharlie.locator('#draft-controls')).toBeVisible();
    await closeGameMenu(pCharlie);
    await passToGuestRoom(pCharlie);

    // 3. Discussion to Voting; phase controls live in the table action dock.
    await expect(pAlice.locator('.table-action-dock #btn-advance-vote')).toBeVisible({ timeout: 10000 });
    await pAlice.locator('.table-action-dock #btn-advance-vote').click();

    await expect(pAlice.locator('.table-action-dock #vote-form')).toBeVisible({ timeout: 10000 });
    await expect(pBob.locator('.table-action-dock #vote-form')).toBeVisible();
    await expect(pCharlie.locator('.table-action-dock #vote-form')).toBeVisible();

    // Submit votes from the dock; it survives the projection rerender after each ballot.
    await pAlice.locator('.table-action-dock #btn-submit-vote').click();
    await pBob.locator('.table-action-dock #btn-submit-vote').click();
    await pCharlie.locator('.table-action-dock #btn-submit-vote').click();

    // 4. Results Screen Verification
    await expect(pAlice.locator('#results-panel')).toBeVisible({ timeout: 10000 });
    await expect(pBob.locator('#results-panel')).toBeVisible();
    await expect(pCharlie.locator('#results-panel')).toBeVisible();

    // Winner banner heading
    const aliceWinner = await pAlice.locator('.winner-banner, #results-panel h2').first().textContent();
    const bobWinner = await pBob.locator('.winner-banner, #results-panel h2').first().textContent();
    expect(aliceWinner).toBe(bobWinner);

    // Responsive table wrapper existence and no page overflow
    const tableWrapper = pAlice.locator('.results-table-wrapper');
    await expect(tableWrapper).toBeVisible();

    // Check no horizontal overflow at 1280 (Alice), 768 (Bob), 375 (Charlie)
    for (const [p, label] of [[pAlice, 'desktop'], [pBob, 'tablet'], [pCharlie, 'mobile']] as const) {
      const overflow = await p.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflow, `Page-level overflow detected on ${label}`).toBe(false);
    }

    // 360px viewport check on Charlie
    await pCharlie.setViewportSize({ width: 360, height: 667 });
    const overflow360 = await pCharlie.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow360, 'Page-level overflow detected at 360px').toBe(false);

    // Capture screenshots for evidence
    const evidenceDir = path.resolve(process.cwd(), '.omo/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    await pAlice.screenshot({
      path: path.join(evidenceDir, 'opendesign-task-7-results-desktop.png'),
      fullPage: true,
    });
    await pCharlie.screenshot({
      path: path.join(evidenceDir, 'opendesign-task-7-results-mobile.png'),
      fullPage: true,
    });

    // 5. Host Rematch back to Lobby
    await pAlice.locator('#btn-rematch').click();
    await expect(pAlice.locator('#lobby-panel')).toBeVisible({ timeout: 10000 });
    await expect(pBob.locator('#lobby-panel')).toBeVisible();
    await expect(pCharlie.locator('#lobby-panel')).toBeVisible();

    // Write evidence JSON
    fs.writeFileSync(
      path.join(evidenceDir, 'opendesign-task-7-results.json'),
      JSON.stringify(
        {
          task: 'opendesign-task-7',
          status: 'passed',
          winnerBanner: aliceWinner?.trim(),
          verifiedViewports: [1280, 768, 375, 360],
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await ctxAlice.close();
    await ctxBob.close();
    await ctxCharlie.close();
  });
});

test.describe('results reveal table', () => {
  test('reveals every card simultaneously from back-facing canonical seats', async ({ browser }) => {
    const errors: string[] = [];
    const { pages, contexts } = await startRoom(browser, ['AliceHost', 'BobGuest', 'CharlieGuest'], {
      viewport: { width: 1280, height: 800 },
      contextOptions: (index) =>
        index === 0
          ? { recordVideo: { dir: path.join(revealEvidenceDir, 'task-9-videos') } }
          : {},
      onPage: async (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
        await installRevealProbe(page);
      },
    });
    const [alice, bob, charlie] = pages;
    try {
      await playToResults(pages);

      // Pre-reveal: the probe snapshots the DOM in its mutation microtask, before
      // the next animation frame applies the single table-level class.
      await expect
        .poll(async () => alice.evaluate(() => window.__NOW_REVEAL_PROBE__?.snapshot !== null))
        .toBe(true);
      const snapshot = await alice.evaluate(
        () => window.__NOW_REVEAL_PROBE__?.snapshot ?? null
      );
      expect(snapshot).not.toBeNull();
      if (!snapshot) throw new Error('reveal probe snapshot missing');
      expect(snapshot.revealed).toBe(false);
      expect(snapshot.cards).toBe(4);
      for (const face of snapshot.faces) {
        expect(face.backface).toBe('hidden');
        expect(face.transform).not.toBe('none');
      }
      for (const back of snapshot.backs) expect(back.visibility).toBe('visible');

      const reveal = alice.locator('.results-reveal');
      await expect(reveal).toHaveClass(/is-revealed/);
      await expect(reveal.locator('.seat')).toHaveCount(3);
      await expect(reveal.locator('.result-card[data-player-id]')).toHaveCount(3);
      await expect(reveal.locator('.results-guest-room .result-card')).toHaveCount(1);

      // Every card's flip starts within one animation frame of the others.
      await expect
        .poll(
          async () => alice.evaluate(() => window.__NOW_REVEAL_PROBE__?.transitionRuns.length ?? 0)
        )
        .toBe(4);
      const flipRuns = await alice.evaluate(
        () => window.__NOW_REVEAL_PROBE__?.transitionRuns ?? []
      );
      expect(
        flipRuns.map((run) => run.target).sort(),
        `flip transition targets: ${flipRuns.map((run) => run.target).join(', ')}`
      ).toHaveLength(4);
      const flipStarts = flipRuns.map((run) => run.time);
      const spread = Math.max(...flipStarts) - Math.min(...flipStarts);
      expect(spread, `flip start spread ${spread}ms`).toBeLessThanOrEqual(17);

      // Canonical ring: same viewer rotation and exact seat coordinates as active play.
      const domSeats = await reveal.locator('.seat').evaluateAll((elements) =>
        elements.map((element) => ({
          playerId: element.getAttribute('data-player-id') ?? '',
          relativeIndex: Number(element.getAttribute('data-relative-index')),
          x: Number((element as HTMLElement).style.getPropertyValue('--seat-x')),
          y: Number((element as HTMLElement).style.getPropertyValue('--seat-y')),
          isViewer: element.getAttribute('aria-current') === 'true',
        }))
      );
      const viewerId = domSeats.find((seat) => seat.isViewer)?.playerId ?? '';
      expect(viewerId).not.toBe('');
      const expectedSeats = getTableSeats(
        domSeats.map((seat) => ({ playerId: seat.playerId })),
        viewerId
      );
      expect(domSeats.map((seat) => seat.playerId)).toEqual(
        expectedSeats.map((seat) => seat.playerId)
      );
      domSeats.forEach((seat, index) => {
        expect(seat.relativeIndex).toBe(expectedSeats[index].relativeIndex);
        expect(seat.x).toBe(expectedSeats[index].x);
        expect(seat.y).toBe(expectedSeats[index].y);
      });
      const viewerSeat = domSeats.find((seat) => seat.isViewer);
      expect(viewerSeat?.x).toBe(50);
      expect(viewerSeat?.y).toBe(88);

      // Revealed fronts match the identity table rows for the same players.
      const identity = await alice
        .locator('#results-panel .results-table tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) => {
            if (!(row instanceof HTMLTableRowElement)) return { player: '', role: '' };
            return {
              player: row.cells[1]?.textContent?.trim() ?? '',
              role: row.cells[2]?.textContent?.trim() ?? '',
            };
          })
        );
      const seatCards = await reveal.locator('.result-card[data-player-id]').evaluateAll((cards) =>
        cards.map((card) => {
          const playerId = card.getAttribute('data-player-id') ?? '';
          const name =
            card
              .closest('.seats')
              ?.querySelector(`.seat[data-player-id="${playerId}"] .seat-name`)
              ?.textContent?.replace(' (我)', '')
              .trim() ?? '';
          return {
            playerId,
            name,
            role: card.querySelector('.card-face .card-role')?.textContent?.trim() ?? '',
          };
        })
      );
      expect(seatCards).toHaveLength(3);
      for (const card of seatCards) {
        const row = identity.find((entry) => entry.player === card.name);
        expect(row, `identity row for ${card.name}`).toBeDefined();
        expect(card.role).toBe(row?.role);
      }

      // Guest Room centre card matches the preserved summary information.
      const guestInfo = await alice.locator('#results-panel .guest-room-card-info').textContent();
      const guestLabel = guestInfo?.match(/【(.+?)】/)?.[1] ?? '';
      expect(guestLabel).not.toBe('');
      await expect(reveal.locator('.results-guest-room .card-role')).toHaveText(guestLabel);

      // Result backs stay generic: no card id, role, or drag payload.
      const backsHtml = await reveal
        .locator('.result-card .card-back')
        .evaluateAll((elements) => elements.map((element) => element.outerHTML).join('\n'));
      expect(backsHtml).not.toContain('data-card-id');
      expect(backsHtml).not.toContain('data-card-role');
      expect(backsHtml).not.toContain('draggable');
      for (const role of Object.values(ROLES)) {
        expect(backsHtml, `card back leaked ${role.label}`).not.toContain(role.label);
      }

      // Responsive: two columns on desktop, stacked below 1024, never overflowing.
      await bob.setViewportSize({ width: 768, height: 1024 });
      await charlie.setViewportSize({ width: 375, height: 667 });
      await expect.poll(async () => resultsColumnCount(alice)).toBe(2);
      await expect.poll(async () => resultsColumnCount(bob)).toBe(1);
      expect(await hasHorizontalOverflow(alice)).toBe(false);
      expect(await hasHorizontalOverflow(bob)).toBe(false);
      expect(await hasHorizontalOverflow(charlie)).toBe(false);
      await charlie.setViewportSize({ width: 360, height: 667 });
      expect(await hasHorizontalOverflow(charlie)).toBe(false);

      await alice.screenshot({
        path: path.join(
          revealEvidenceDir,
          'task-9-game-table-interaction-redesign-result-desktop-1280.png'
        ),
      });
      await alice.locator('.results-table-panel').screenshot({
        path: path.join(
          revealEvidenceDir,
          'task-9-game-table-interaction-redesign-result-table-desktop-1280.png'
        ),
      });
      await charlie.screenshot({
        path: path.join(
          revealEvidenceDir,
          'task-9-game-table-interaction-redesign-result-mobile-360.png'
        ),
      });
      writeRevealEvidence('task-9-game-table-interaction-redesign-result.json', {
        preReveal: snapshot,
        flipStartSpreadMs: spread,
        playerCards: seatCards,
        guestCardLabel: guestLabel,
        viewerSeat,
        columns: { desktop1280: 2, tablet768: 1 },
        overflowFreeViewports: [1280, 768, 375, 360],
      });
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('reduced motion renders the final faces instantly without a flip', async ({ browser }) => {
    const { pages, contexts } = await startRoom(browser, ['RedAlice', 'RedBob', 'RedCharlie'], {
      viewport: { width: 1280, height: 800 },
      contextOptions: () => ({ reducedMotion: 'reduce' }),
      onPage: async (page) => {
        await installRevealProbe(page);
      },
    });
    const [alice, bob, charlie] = pages;
    try {
      await playToResults(pages);
      await expect
        .poll(async () => alice.evaluate(() => window.__NOW_REVEAL_PROBE__?.snapshot !== null))
        .toBe(true);
      const snapshot = await alice.evaluate(
        () => window.__NOW_REVEAL_PROBE__?.snapshot ?? null
      );
      expect(snapshot?.revealed).toBe(false);
      for (const face of snapshot?.faces ?? []) expect(face.visibility).toBe('hidden');
      for (const back of snapshot?.backs ?? []) expect(back.visibility).toBe('visible');

      const reveal = alice.locator('.results-reveal');
      await expect(reveal).toHaveClass(/is-revealed/);
      const faces = reveal.locator('.result-card .card-face');
      const backs = reveal.locator('.result-card .card-back');
      await expect(faces).toHaveCount(4);
      for (let index = 0; index < 4; index += 1) {
        await expect(faces.nth(index)).toBeVisible();
        await expect(backs.nth(index)).toBeHidden();
      }
      // The reduced-motion override forces `transform: none`, so no flip ran.
      const transforms = await reveal
        .locator('.result-card')
        .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).transform));
      expect(transforms.every((transform) => transform === 'none')).toBe(true);
      const knownRoles = new Set(Object.values(ROLES).map((role) => role.label));
      const faceRoles = await faces.evaluateAll((elements) =>
        elements.map((element) => element.querySelector('.card-role')?.textContent?.trim() ?? '')
      );
      expect(faceRoles).toHaveLength(4);
      for (const label of faceRoles) expect(knownRoles.has(label)).toBe(true);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('missing Guest Room card leaves a graceful empty centre', async ({ browser }) => {
    interface ProjectionFrame {
      type?: string;
      projection?: { result?: { guestRoomCard?: unknown } };
    }
    const errors: string[] = [];
    const { pages, contexts } = await startRoom(
      browser,
      ['NoGuestAlice', 'NoGuestBob', 'NoGuestCharlie'],
      {
        viewport: { width: 1280, height: 800 },
        onPage: async (page, index) => {
          page.on('pageerror', (error) => errors.push(error.message));
          if (index !== 0) return;
          // Installed before navigation so the host's first socket is intercepted.
          await page.routeWebSocket('/ws', (ws) => {
            const server = ws.connectToServer();
            ws.onMessage((message) => server.send(message));
            server.onMessage((message) => {
              const text = typeof message === 'string' ? message : message.toString('utf8');
              let parsed: ProjectionFrame | null = null;
              try {
                parsed = JSON.parse(text) as ProjectionFrame;
              } catch {
                parsed = null;
              }
              if (parsed?.type === 'projection' && parsed.projection?.result) {
                parsed.projection.result.guestRoomCard = null;
                ws.send(JSON.stringify(parsed));
                return;
              }
              ws.send(message);
            });
          });
        },
      }
    );
    const [alice, bob, charlie] = pages;
    try {
      await playToResults(pages);
      const reveal = alice.locator('.results-reveal');
      await expect(reveal).toHaveClass(/is-revealed/);
      await expect(reveal.locator('.result-card')).toHaveCount(3);
      await expect(reveal.locator('.results-guest-room .result-card')).toHaveCount(0);
      await expect(reveal.locator('.results-guest-room .guest-room-hint')).toHaveText('無扣置卡牌');
      await expect(alice.locator('#results-panel .guest-room-card-info')).toHaveCount(0);
      expect(await hasHorizontalOverflow(alice)).toBe(false);
      writeRevealEvidence('task-9-game-table-interaction-redesign-result-edge.json', {
        missingGuestRoom: true,
        playerCards: 3,
        centreHint: '無扣置卡牌',
        overflowFree: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('long names, non-host authorization, and immediate rematch stay safe', async ({ browser }) => {
    const errors: string[] = [];
    const longNames = [
      '超級無敵長的玩家暱稱測試甲號ABCDEFGHIJ',
      '超級無敵長的玩家暱稱測試乙號ABCDEFGHIJ',
      '超級無敵長的玩家暱稱測試丙號ABCDEFGHIJ',
    ];
    expect(longNames[0]?.length).toBe(24);
    const { pages, contexts } = await startRoom(browser, longNames, {
      viewport: { width: 360, height: 800 },
      onPage: async (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
      },
    });
    const [alice, bob, charlie] = pages;
    try {
      await playToResults(pages);
      for (const page of pages) {
        expect(await hasHorizontalOverflow(page)).toBe(false);
      }
      await expect(alice.locator('.results-reveal .seat-name')).toHaveCount(3);
      const seatNames = await alice.locator('.results-reveal .seat-name').allTextContents();
      for (const name of longNames) {
        expect(seatNames.some((text) => text.replace(' (我)', '').trim() === name)).toBe(true);
      }
      // Non-host viewers hold no rematch control and see the waiting state.
      await expect(bob.locator('#btn-rematch')).toHaveCount(0);
      await expect(bob.locator('#results-panel')).toContainText('等待房主開啟下一局');
      expect(await resultsColumnCount(alice)).toBe(1);

      // Immediate rematch while the reveal may still be in flight leaves no stale table.
      await alice.locator('#btn-rematch').click();
      for (const page of pages) await expect(page.locator('#lobby-panel')).toBeVisible({ timeout: 15000 });
      for (const page of pages) await expect(page.locator('.results-reveal')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('six-player reveal keeps every card clear of the Guest Room centre at 360', async ({ browser }) => {
    const names = ['玩家一號', '玩家二號', '玩家三號', '玩家四號', '玩家五號', '玩家六號'];
    const { pages, contexts } = await startRoom(browser, names, {
      viewport: { width: 360, height: 800 },
      level: 'L3',
    });
    const alice = pages[0];
    try {
      await playToResults(pages);
      const reveal = alice.locator('.results-reveal');
      await expect(reveal).toHaveClass(/is-revealed/);
      await expect(reveal.locator('.seat')).toHaveCount(6);
      await expect(reveal.locator('.result-card')).toHaveCount(7);
      await expect(reveal.locator('.results-guest-room .result-card')).toHaveCount(1);

      // No player card may cover the Guest Room centre card at the tightest ring.
      const boxes = await reveal.evaluate((table) => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        };
        const guest = table.querySelector('.results-guest-room');
        return {
          guest: guest ? rect(guest) : null,
          cards: Array.from(table.querySelectorAll('.result-card[data-player-id]')).map(rect),
        };
      });
      expect(boxes.guest).not.toBeNull();
      const guest = boxes.guest;
      if (!guest) throw new Error('guest room box missing');
      const overlaps = boxes.cards.filter(
        (card) =>
          card.left < guest.right &&
          card.right > guest.left &&
          card.top < guest.bottom &&
          card.bottom > guest.top
      );
      expect(overlaps, `${overlaps.length} card(s) overlap the Guest Room centre`).toEqual([]);

      for (const page of pages) {
        expect(await hasHorizontalOverflow(page)).toBe(false);
      }
      await alice.locator('.results-table-panel').screenshot({
        path: path.join(
          revealEvidenceDir,
          'task-9-game-table-interaction-redesign-result-table-six-player-360.png'
        ),
      });
      writeRevealEvidence('task-9-game-table-interaction-redesign-result-six-player.json', {
        players: names,
        cards: 7,
        guestBox: guest,
        overlappingCards: overlaps.length,
        overflowFree: true,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

interface HeadingLineMetrics {
  readonly selector: string;
  readonly phrase: string;
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly textWrap: string;
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly clipped: boolean;
  readonly lineTexts: readonly string[];
  readonly lineTops: readonly number[];
  readonly phraseLineIndexes: readonly number[];
  readonly phraseIntact: boolean;
  readonly lastLineCharCount: number;
}

/**
 * Groups every glyph of a heading into visual lines from per-character `Range`
 * rects (real line geometry, not element height), then reports which line the
 * requested phrase occupies.
 */
async function measureHeadingLines(
  page: Page,
  selector: string,
  phrase: string
): Promise<HeadingLineMetrics> {
  return page.evaluate(
    ({ selector: target, phrase: needle }) => {
      const element = document.querySelector(target);
      if (!element) throw new Error(`heading not found: ${target}`);
      const lines: Array<{ top: number; chars: string[] }> = [];
      const chars: Array<{ char: string; line: number }> = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const node: Node = current;
        const data = node.textContent ?? '';
        let offset = 0;
        for (const char of data) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + char.length);
          const top = Math.round(range.getBoundingClientRect().top * 10) / 10;
          let lineIndex = lines.findIndex((line) => Math.abs(line.top - top) <= 1);
          if (lineIndex === -1) {
            lineIndex = lines.length;
            lines.push({ top, chars: [] });
          }
          lines[lineIndex].chars.push(char);
          chars.push({ char, line: lineIndex });
          offset += char.length;
        }
        current = walker.nextNode();
      }
      const text = chars.map((entry) => entry.char).join('');
      const phraseIndex = text.indexOf(needle);
      const phraseLineIndexes =
        phraseIndex === -1
          ? []
          : Array.from(
              new Set(
                chars
                  .slice(phraseIndex, phraseIndex + Array.from(needle).length)
                  .map((entry) => entry.line)
              )
            );
      const lastLine = lines[lines.length - 1];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector: target,
        phrase: needle,
        text,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        textWrap: style.textWrap,
        boxWidth: Math.round(rect.width * 10) / 10,
        boxHeight: Math.round(rect.height * 10) / 10,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clipped: element.scrollWidth > element.clientWidth + 1,
        lineTexts: lines.map((line) => line.chars.join('')),
        lineTops: lines.map((line) => line.top),
        phraseLineIndexes,
        phraseIntact: phraseLineIndexes.length === 1,
        lastLineCharCount: (lastLine?.chars ?? []).filter((char) => char.trim() !== '').length,
      };
    },
    { selector, phrase }
  );
}

test.describe('CJK heading line integrity', () => {
  test('CJK headings keep 傳遞 and 獲勝 whole at 375 coarse, fine and reduced motion', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    const evidenceDir = path.resolve(process.cwd(), '.omo/evidence/final-f3-visual-qa');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const project = test.info().project.name;
    const variants = ['375-coarse', '375-fine', '375-reduced-motion'] as const;
    const { pages, contexts } = await startRoom(browser, ['CoarseAlice', 'FineBob', 'ReducedCharlie'], {
      viewport: { width: 375, height: 812 },
      contextOptions: (index) =>
        index === 0 ? { hasTouch: true } : index === 2 ? { reducedMotion: 'reduce' } : {},
      onPage: async (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
      },
    });
    const draftMetrics: Record<string, { at375: HeadingLineMetrics; at360: HeadingLineMetrics }> = {};
    const resultsMetrics: Record<
      string,
      Record<string, { heading: HeadingLineMetrics; reason: HeadingLineMetrics }>
    > = {};
    try {
      // The draft heading exists only for the current actor, so each page measures on its own turn.
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const variant = variants[index] ?? `375-${index}`;
        // Under reduced motion the skip link used to sit on top of the drawer opener
        // (transform-based hiding is nullified by the global override), so prove the
        // opener is the real hit target before clicking it.
        const openerHittable = await page.evaluate(() => {
          const opener = document.querySelector('#btn-show-game-menu');
          if (!opener) return null;
          const rect = opener.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          );
          return hit !== null && (hit === opener || opener.contains(hit));
        });
        expect(openerHittable, `${variant} drawer opener must be the hit target`).toBe(true);
        await openGameMenu(page);
        await expect(page.locator('#draft-controls h2')).toBeVisible();
        // The drawer slides in over 0.15s; settle before capture so the PNG shows the heading.
        await expect
          .poll(async () =>
            page
              .locator('#game-menu-content')
              .evaluate((element) => Math.round(element.getBoundingClientRect().left))
          )
          .toBe(0);
        const at375 = await measureHeadingLines(page, '#draft-controls h2', '傳遞');
        await page.screenshot({
          path: path.join(evidenceDir, `f3s-fix-cjk-headings-drawer-${variant}-${project}.png`),
        });
        await page.setViewportSize({ width: 360, height: 812 });
        const at360 = await measureHeadingLines(page, '#draft-controls h2', '傳遞');
        expect(await hasHorizontalOverflow(page), `draft page overflow ${variant}@360`).toBe(false);
        await page.setViewportSize({ width: 375, height: 812 });
        draftMetrics[variant] = { at375, at360 };
        await closeGameMenu(page);
        if (index === pages.length - 1) {
          await passToGuestRoom(page);
        } else {
          await passToFirstEligible(page);
        }
      }

      // Discussion → voting → results, then measure the winner banner at every required width.
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

      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const variant = variants[index] ?? `375-${index}`;
        const perWidth: Record<
          string,
          { heading: HeadingLineMetrics; reason: HeadingLineMetrics }
        > = {};
        for (const width of [375, 360, 768, 1280]) {
          await page.setViewportSize({ width, height: 812 });
          perWidth[String(width)] = {
            heading: await measureHeadingLines(page, '#winner-heading', '獲勝'),
            reason: await measureHeadingLines(page, '.winner-reason', '獲勝'),
          };
          expect(await hasHorizontalOverflow(page), `results overflow ${variant}@${width}`).toBe(
            false
          );
        }
        await page.setViewportSize({ width: 375, height: 812 });
        await page.screenshot({
          path: path.join(evidenceDir, `f3s-fix-cjk-headings-results-${variant}-${project}.png`),
        });
        resultsMetrics[variant] = perWidth;
      }

      fs.writeFileSync(
        path.join(evidenceDir, `f3s-fix-cjk-headings-geometry-${project}.json`),
        JSON.stringify({ draft: draftMetrics, results: resultsMetrics }, null, 2)
      );

      for (const variant of variants) {
        const draft = draftMetrics[variant];
        expect(draft, `draft metrics missing for ${variant}`).toBeDefined();
        if (!draft) continue;
        for (const [width, metrics] of Object.entries({ '375': draft.at375, '360': draft.at360 })) {
          expect(metrics.text, `draft heading text ${variant}@${width}`).toContain('傳遞');
          expect(
            metrics.phraseIntact,
            `${variant}@${width} drawer heading splits 傳遞: ${metrics.lineTexts.join(' | ')}`
          ).toBe(true);
          expect(
            metrics.lastLineCharCount,
            `${variant}@${width} drawer heading orphan: ${metrics.lineTexts.join(' | ')}`
          ).toBeGreaterThanOrEqual(2);
          expect(metrics.clipped, `${variant}@${width} drawer heading clipped`).toBe(false);
        }

        const results = resultsMetrics[variant];
        expect(results, `results metrics missing for ${variant}`).toBeDefined();
        if (!results) continue;
        for (const [width, measured] of Object.entries(results)) {
          for (const [name, metrics] of Object.entries(measured)) {
            expect(metrics.text, `${variant}@${width} ${name} text`).toContain('獲勝');
            expect(
              metrics.phraseIntact,
              `${variant}@${width} ${name} splits 獲勝: ${metrics.lineTexts.join(' | ')}`
            ).toBe(true);
            expect(
              metrics.lastLineCharCount,
              `${variant}@${width} ${name} orphan: ${metrics.lineTexts.join(' | ')}`
            ).toBeGreaterThanOrEqual(2);
            expect(metrics.clipped, `${variant}@${width} ${name} clipped`).toBe(false);
          }
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

interface ShellClearanceProbe {
  readonly project: string;
  readonly variant: string;
  readonly width: number;
  readonly scrollY: number;
  readonly maxScroll: number;
  readonly atMaxScroll: boolean;
  readonly documentHeight: number;
  readonly card: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number };
  readonly faction: { readonly top: number; readonly bottom: number; readonly text: string } | null;
  readonly shell: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number };
  readonly cardClearance: number;
  readonly factionClearance: number | null;
  readonly cardHitTag: string | null;
  readonly cardHitInside: boolean;
  readonly factionHitTag: string | null;
  readonly factionHitInside: boolean;
  readonly shellLabel: string;
  readonly muteHittable: boolean;
  readonly pageOverflow: boolean;
}

/**
 * Waits until the reveal flip has settled (or is overridden under reduced motion)
 * before any geometry is read, so mid-transition projection cannot flake the
 * `elementFromPoint` hit tests on the bottom card.
 */
async function settleRevealFlip(page: Page): Promise<void> {
  await expect(page.locator('.results-reveal')).toHaveClass(/is-revealed/);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>('.results-reveal .result-card')
        );
        if (cards.length === 0) return false;
        const bottom = cards.reduce((lowest, card) =>
          card.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom ? card : lowest
        );
        const transform = getComputedStyle(bottom).transform;
        if (transform === 'none') return true;
        try {
          return Math.abs(new DOMMatrix(transform).m11) > 0.99;
        } catch {
          return true;
        }
      })
    )
    .toBe(true);
}

/**
 * At maximum scroll, reads the bottom-most result card (viewer card, which hangs
 * away from the ring centre) against the fixed audio shell: card/faction-row
 * clearance above the shell and real hit-testing at both points. The shell's own
 * mute button is probed the same way to prove the shell is still usable on top.
 */
async function probeShellClearance(
  page: Page,
  context: { variant: string; width: number; project: string }
): Promise<ShellClearanceProbe> {
  return page.evaluate(
    ({ variant, width, project }) => {
      const shell = document.getElementById('audio-controls-shell');
      const cards = Array.from(
        document.querySelectorAll<HTMLElement>('.results-reveal .result-card')
      );
      if (!shell) throw new Error('audio controls shell missing');
      if (cards.length === 0) throw new Error('result cards missing');
      const bottomCard = cards.reduce((lowest, card) =>
        card.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom ? card : lowest
      );
      const shellRect = shell.getBoundingClientRect();
      const cardRect = bottomCard.getBoundingClientRect();
      const faction = bottomCard.querySelector<HTMLElement>('.card-action');
      const factionRect = faction?.getBoundingClientRect() ?? null;
      const cardHit = document.elementFromPoint(
        cardRect.left + cardRect.width / 2,
        cardRect.bottom - 4
      );
      const factionHit = factionRect
        ? document.elementFromPoint(
            factionRect.left + factionRect.width / 2,
            factionRect.top + factionRect.height / 2
          )
        : null;
      const muteButton = document.getElementById('btn-audio-mute');
      const muteRect = muteButton?.getBoundingClientRect() ?? null;
      const muteHit = muteRect
        ? document.elementFromPoint(muteRect.left + muteRect.width / 2, muteRect.top + muteRect.height / 2)
        : null;
      const doc = document.documentElement;
      return {
        project,
        variant,
        width,
        scrollY: window.scrollY,
        maxScroll: doc.scrollHeight - doc.clientHeight,
        atMaxScroll: Math.abs(window.scrollY - (doc.scrollHeight - doc.clientHeight)) <= 1,
        documentHeight: doc.scrollHeight,
        card: { top: cardRect.top, bottom: cardRect.bottom, left: cardRect.left, right: cardRect.right },
        faction:
          faction && factionRect
            ? { top: factionRect.top, bottom: factionRect.bottom, text: faction.textContent?.trim() ?? '' }
            : null,
        shell: { top: shellRect.top, bottom: shellRect.bottom, left: shellRect.left, right: shellRect.right },
        cardClearance: shellRect.top - cardRect.bottom,
        factionClearance: factionRect ? shellRect.top - factionRect.bottom : null,
        cardHitTag: cardHit ? cardHit.tagName.toLowerCase() : null,
        cardHitInside: cardHit !== null && bottomCard.contains(cardHit),
        factionHitTag: factionHit ? factionHit.tagName.toLowerCase() : null,
        factionHitInside: factionHit !== null && bottomCard.contains(factionHit),
        shellLabel: shell.getAttribute('aria-label') ?? '',
        muteHittable: muteHit !== null && muteButton !== null && muteButton.contains(muteHit),
        pageOverflow: doc.scrollWidth > doc.clientWidth,
      };
    },
    context
  );
}

test.describe('audio shell scroll clearance', () => {
  test('bottom result card clears the fixed audio shell at max scroll (375/360, normal and reduced motion)', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    const evidenceDir = path.resolve(process.cwd(), '.omo/evidence/final-f3-visual-qa');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const project = test.info().project.name;
    const variants = ['coarse', 'reduced-motion'] as const;
    const { pages, contexts } = await startRoom(browser, ['ShellCoarse', 'ShellFine', 'ShellReduced'], {
      viewport: { width: 375, height: 812 },
      contextOptions: (index) =>
        index === 0 ? { hasTouch: true } : index === 2 ? { reducedMotion: 'reduce' } : {},
      onPage: async (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
      },
    });
    const metrics: Record<string, Record<string, ShellClearanceProbe>> = {};
    try {
      await playToResults(pages);
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const variant = variants[index];
        if (!variant) continue;
        const perWidth: Record<string, ShellClearanceProbe> = {};
        for (const [width, height] of [
          [375, 812],
          [360, 800],
        ] as const) {
          await page.setViewportSize({ width, height });
          await settleRevealFlip(page);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const probe = await probeShellClearance(page, { variant, width, project });
          perWidth[String(width)] = probe;
          await page.screenshot({
            path: path.join(evidenceDir, `f3s-shell-clearance-${variant}-${width}-${project}.png`),
          });
        }
        await page.setViewportSize({ width: 375, height: 812 });
        // The shell itself must stay usable: muting toggles aria-pressed without occlusion.
        const mute = page.locator('#btn-audio-mute');
        await expect(mute).toBeVisible();
        const pressedBefore = await mute.getAttribute('aria-pressed');
        await mute.click();
        await expect(mute).toHaveAttribute('aria-pressed', pressedBefore === 'true' ? 'false' : 'true');
        metrics[variant] = perWidth;
      }

      fs.writeFileSync(
        path.join(evidenceDir, `f3s-shell-clearance-geometry-${project}.json`),
        JSON.stringify(metrics, null, 2)
      );

      const knownFactions = new Set(Object.values(FACTIONS).map((faction) => faction.label));
      for (const variant of variants) {
        const perWidth = metrics[variant];
        expect(perWidth, `metrics missing for ${variant}`).toBeDefined();
        if (!perWidth) continue;
        for (const [width, probe] of Object.entries(perWidth)) {
          const where = `${variant}@${width}`;
          expect(probe.maxScroll, `${where} page must be scrollable`).toBeGreaterThan(0);
          expect(probe.atMaxScroll, `${where} not at maximum scroll`).toBe(true);
          expect(
            probe.cardClearance,
            `${where} bottom card clearance ${probe.cardClearance.toFixed(1)}px (card bottom ${probe.card.bottom.toFixed(1)}, shell top ${probe.shell.top.toFixed(1)})`
          ).toBeGreaterThanOrEqual(8);
          expect(
            probe.factionClearance,
            `${where} faction row clearance above shell`
          ).toBeGreaterThanOrEqual(8);
          expect(probe.cardHitInside, `${where} bottom card edge hit ${probe.cardHitTag}`).toBe(true);
          expect(probe.factionHitInside, `${where} faction row hit ${probe.factionHitTag}`).toBe(true);
          expect(probe.faction?.text ?? '', `${where} faction row text`).not.toBe('');
          expect(knownFactions.has(probe.faction?.text ?? ''), `${where} faction label`).toBe(true);
          expect(probe.shellLabel, `${where} audio shell label`).toBe('音訊設定');
          expect(probe.muteHittable, `${where} shell mute button must stay hittable`).toBe(true);
          expect(probe.pageOverflow, `${where} horizontal page overflow`).toBe(false);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
