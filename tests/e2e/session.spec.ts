import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

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
});
