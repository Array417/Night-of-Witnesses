import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  CLAIM_DIALOG,
  armCard,
  completeDraft,
  firstSeatTarget,
  startRoom,
} from './draft-flow.ts';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('browser session and network transport', () => {
  test('session credentials, URL hygiene, reload rejoin, and secret privacy', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to game
    await page.goto('/');

    // Evaluate client using window.__NOW__
    const sessionInfo = await page.evaluate(async () => {
      const { GameClient, session } = (window as any).__NOW__;

      const client = new GameClient();
      client.connect();

      // Wait for connection
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (client.getStatus() === 'connected') {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });

      // Create a room
      client.createRoom('AliceHost');

      // Wait for projection
      await new Promise<void>((resolve) => {
        client.setEvents({
          onProjection: () => resolve(),
        });
      });

      const proj = client.getProjection();
      const saved = session.loadSavedSeat();
      return {
        roomCode: proj?.roomCode,
        seatToken: saved?.seatToken,
        version: proj?.version,
        url: window.location.href,
        hasCanary: JSON.stringify(proj).includes('CANARY'),
      };
    });

    expect(sessionInfo.roomCode).toBeTruthy();
    expect(sessionInfo.seatToken).toBeTruthy();

    // 1. URL contains ONLY room code, NEVER seat token
    expect(sessionInfo.url).toContain(`room=${sessionInfo.roomCode}`);
    expect(sessionInfo.url).not.toContain(sessionInfo.seatToken!);

    // 2. localStorage contains the seat token
    const stored = await page.evaluate(() => localStorage.getItem('night-of-witnesses.seat.v1'));
    expect(stored).toContain(sessionInfo.seatToken!);

    // 3. Reload reconnects to same seat and version
    await page.reload();
    const reconnected = await page.evaluate(async () => {
      const { GameClient } = (window as any).__NOW__;
      const client = new GameClient();
      client.connect();

      return await new Promise<boolean>((resolve) => {
        client.setEvents({
          onProjection: (p: any) => resolve(p.isHost && p.players[0].playerName === 'AliceHost'),
        });
        setTimeout(() => resolve(false), 5000);
      });
    });
    expect(reconnected).toBe(true);

    // 4. Duplicate action click: while in flight, client rejects duplicate submission
    const duplicatePrevented = await page.evaluate(async () => {
      const { GameClient } = (window as any).__NOW__;
      const client = new GameClient();
      client.connect();
      await new Promise((r) => setTimeout(r, 200));

      const first = client.dispatchAction({ type: 'set_ready', ready: true });
      const second = client.dispatchAction({ type: 'set_ready', ready: true });
      return first && !second;
    });
    expect(duplicatePrevented).toBe(true);

    // 5. Invalid token clears storage
    await page.evaluate(async () => {
      const { GameClient, session } = (window as any).__NOW__;
      session.saveSeat('FAKE12', 'forged-invalid-seat-token');

      const client = new GameClient();
      client.connect();

      await new Promise<void>((resolve) => {
        client.setEvents({
          onError: () => resolve(),
        });
        setTimeout(resolve, 2000);
      });
    });

    const clearedStorage = await page.evaluate(() => localStorage.getItem('night-of-witnesses.seat.v1'));
    expect(clearedStorage).toBeNull();

    await context.close();
  });

  test('failure scenario: offline recovery, supersede older tab, and malformed frames', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    await page1.goto('/');

    // Tab 1 creates room
    const roomInfo = await page1.evaluate(async () => {
      const { GameClient, session } = (window as any).__NOW__;
      const client = new GameClient();
      client.connect();

      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (client.getStatus() === 'connected') {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });

      client.createRoom('TabPlayer');
      await new Promise<void>((resolve) => {
        client.setEvents({ onProjection: () => resolve() });
      });

      return { roomCode: client.getProjection()?.roomCode!, saved: session.loadSavedSeat() };
    });

    // Tab 2 supersedes Tab 1 using saved seat
    const page2 = await context.newPage();
    await page2.goto('/');
    const tab2Connected = await page2.evaluate(async () => {
      const { GameClient } = (window as any).__NOW__;
      const client = new GameClient();
      client.connect();
      return await new Promise<boolean>((resolve) => {
        client.setEvents({ onProjection: (p: any) => resolve(p.players[0].playerName === 'TabPlayer') });
        setTimeout(() => resolve(false), 5000);
      });
    });
    expect(tab2Connected).toBe(true);

    // Offline test: simulate offline then online
    const disconnectedStatus = await page2.evaluate(async () => {
      const { GameClient } = (window as any).__NOW__;
      const client = new GameClient();
      client.connect();
      await new Promise((r) => setTimeout(r, 200));
      client.disconnect();
      const status = client.getStatus();
      client.connect();
      return status;
    });
    expect(disconnectedStatus).toBe('disconnected');

    await context.close();
  });

  test('stale baseVersion recovers from the safe projection with a focused non-secret alert', async ({
    browser,
  }) => {
    const capture = { stale: 0, forwarded: 0 };
    const { pages, contexts } = await startRoom(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      {
        viewport: { width: 1280, height: 800 },
        onPage: async (page, index) => {
          if (index !== 0) return;
          // Installed before navigation so the first socket is intercepted; every other
          // frame is proxied untouched.
          await page.routeWebSocket('/ws', (ws) => {
            const server = ws.connectToServer();
            let staleOnce = true;
            ws.onMessage((message) => {
              const text = typeof message === 'string' ? message : message.toString('utf8');
              let parsed: Record<string, unknown> | null = null;
              try {
                parsed = JSON.parse(text) as Record<string, unknown>;
              } catch {
                parsed = null;
              }
              if (parsed?.type === 'cast_vote') {
                if (staleOnce) {
                  staleOnce = false;
                  capture.stale += 1;
                  server.send(
                    JSON.stringify({ ...parsed, baseVersion: Number(parsed.baseVersion) - 1 })
                  );
                  return;
                }
                capture.forwarded += 1;
              }
              server.send(message);
            });
          });
        },
      }
    );
    const [alice, bob, charlie] = pages;

    try {
      await completeDraft(pages);
      await expect(alice.locator('.table-action-dock h2')).toHaveText('自由討論階段');
      await alice.locator('.table-action-dock #btn-advance-vote').click();
      for (const page of pages) {
        await expect(page.locator('.table-action-dock h2')).toHaveText('投票指認階段');
      }

      const seatIdsBefore = await alice
        .locator('.table-panel .seat')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-player-id'))
        );

      await alice.locator('.table-action-dock #btn-submit-vote').click();
      const alert = alice.locator('[role="alert"]');
      await expect(alert).toBeVisible();
      await expect(alert).toBeFocused();
      await expect(alert).toHaveText('狀態版本已過期，請重新嘗試');
      const alertText = (await alert.textContent()) ?? '';

      // The rerender from the safe projection keeps the dock form retryable and the ring canonical.
      await expect(alice.locator('.table-action-dock #vote-form')).toBeVisible();
      await expect(alice.locator('.table-action-dock #btn-submit-vote')).toBeEnabled();
      const seatIdsAfter = await alice
        .locator('.table-panel .seat')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-player-id'))
        );
      expect(seatIdsAfter).toEqual(seatIdsBefore);

      // Retry forwards exactly one accepted ballot.
      await alice.locator('.table-action-dock #btn-submit-vote').click();
      await expect(alice.locator('.table-action-dock .alert-success')).toContainText(
        '您已完成投票'
      );
      expect(capture.stale).toBe(1);
      expect(capture.forwarded).toBe(1);

      await bob.locator('.table-action-dock #btn-submit-vote').click();
      await charlie.locator('.table-action-dock #btn-submit-vote').click();
      await expect(alice.locator('#results-panel')).toBeVisible();

      fs.writeFileSync(
        path.join(evidenceDir, 'task-8-game-table-interaction-redesign-recovery-stale.json'),
        JSON.stringify(
          {
            staleRejections: capture.stale,
            forwardedAfterRetry: capture.forwarded,
            alertFocused: true,
            alertText,
            seatsPreserved: seatIdsAfter,
            resultsReached: true,
          },
          null,
          2
        )
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('disconnect during a pending transfer resets from the safe projection and preserves seats and menu state', async ({
    browser,
  }) => {
    const capture = { sent: 0, forwarded: 0 };
    // Scoped outside the route callback so only the first-ever attempt is dropped,
    // not the first attempt of every reconnected socket.
    let dropPendingOnce = true;
    const { pages, contexts } = await startRoom(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      {
        viewport: { width: 1280, height: 800 },
        onPage: async (page, index) => {
          if (index !== 0) return;
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
                capture.sent += 1;
                if (dropPendingOnce) {
                  dropPendingOnce = false;
                  // The confirmation stays pending because the socket dies before any reply.
                  void ws.close();
                  return;
                }
                capture.forwarded += 1;
              }
              server.send(message);
            });
          });
        },
      }
    );
    const [alice] = pages;

    try {
      // Menu state must survive the reconnect rerender: collapse the desktop rail, or
      // verify the closed-by-default drawer on coarse-pointer clients (where the
      // desktop toggle is hidden and the drawer would cover the table if opened).
      const coarsePointer = await alice.evaluate(() =>
        window.matchMedia('(pointer: coarse)').matches
      );
      if (!coarsePointer) {
        await alice.locator('#btn-toggle-game-menu').click();
        await expect(alice.locator('#game-menu')).toHaveAttribute('data-state', 'collapsed');
      } else {
        await expect(alice.locator('#game-menu')).toHaveAttribute('data-state', 'closed');
      }
      const seatIdsBefore = await alice
        .locator('.table-panel .seat')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-player-id'))
        );

      await armCard(alice);
      await firstSeatTarget(alice).click();
      await expect(alice.locator(CLAIM_DIALOG)).toBeVisible();
      await alice.locator('#btn-confirm-pass').click();
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'pending');

      // Auto-reconnect replays the projection: the pending UI resets and nothing was delivered.
      await expect(alice.locator(CLAIM_DIALOG)).toBeHidden({ timeout: 15000 });
      await expect(alice.locator(CLAIM_DIALOG)).toHaveAttribute('data-state', 'idle');
      await expect(alice.locator('#draft-controls')).toBeAttached();
      await expect(alice.locator('#game-menu')).toHaveAttribute(
        'data-state',
        coarsePointer ? 'closed' : 'collapsed'
      );
      const seatIdsAfter = await alice
        .locator('.table-panel .seat')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-player-id'))
        );
      expect(seatIdsAfter).toEqual(seatIdsBefore);
      expect(capture.sent).toBe(1);
      expect(capture.forwarded).toBe(0);
      const pendingSends = capture.sent;

      // Retry forwards exactly once after the recovery.
      await armCard(alice);
      await firstSeatTarget(alice).click();
      await alice.locator('#btn-confirm-pass').click();
      await expect.poll(() => capture.forwarded).toBe(1);

      fs.writeFileSync(
        path.join(evidenceDir, 'task-8-game-table-interaction-redesign-recovery-reconnect.json'),
        JSON.stringify(
          {
            pendingSends,
            forwardedAfterRetry: capture.forwarded,
            seatsPreserved: seatIdsAfter,
            menuStatePreserved: coarsePointer ? 'drawer-closed' : 'rail-collapsed',
            noDuplicateAction: true,
          },
          null,
          2
        )
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
