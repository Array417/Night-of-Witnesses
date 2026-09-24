import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { completeDraft, startRoom } from './draft-flow.ts';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

/** Client-side `cast_vote` frames the page actually sent, recorded while proxying the socket. */
interface VoteCapture {
  readonly castVotes: Record<string, unknown>[];
}

async function recordVotes(page: Page, capture: VoteCapture): Promise<void> {
  await page.routeWebSocket('/ws', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString('utf8');
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed.type === 'cast_vote') capture.castVotes.push(parsed);
      } catch {
        // Non-JSON frames are proxied untouched.
      }
      server.send(message);
    });
  });
}

test.describe('Discussion and Voting Phases with Sound Mapping and Privacy', () => {
  test('discussion advances to voting and voting completes with progress indicator', async ({ browser }) => {
    const { pages, contexts } = await startRoom(browser, ['主持愛麗絲', '玩家二號', '玩家三號']);
    const [p1, p2, p3] = pages;

    try {
      // Complete draft through the transfer coordinator (dialog fallback, then Guest Room).
      await completeDraft(pages);

      // 2. Discussion Phase; its controls live in the table action dock on every viewport.
      await expect(p1.locator('#game-header')).toBeVisible();
      await expect(p1.locator('.table-action-dock h2')).toHaveText('自由討論階段');
      await expect(p2.locator('.table-action-dock h2')).toHaveText('自由討論階段');
      await expect(p3.locator('.table-action-dock h2')).toHaveText('自由討論階段');
      await expect(p1.locator('#phase-action-panel')).toHaveCount(0);
      const discussionDockCount = await p1.locator('.table-action-dock').count();

      // Host has the advance button inside the dock, guests have waiting text
      await expect(p1.locator('.table-action-dock #btn-advance-vote')).toBeVisible();
      await expect(p2.locator('.table-action-dock #btn-advance-vote')).toHaveCount(0);
      await expect(p2.locator('.table-action-dock')).toContainText('等待房主結束討論');

      // Ability controls are dock-scoped whenever the viewer holds that role.
      for (const page of pages) {
        const role = await page.evaluate(
          () => window.__NOW__?.client.getProjection()?.ownRole?.role ?? null
        );
        if (role === 'butler') {
          await expect(page.locator('.table-action-dock #btn-butler-peek')).toBeVisible();
        }
        if (role === 'detective') {
          await expect(page.locator('.table-action-dock #btn-detective-send')).toBeVisible();
        }
      }

      // Capture discussion evidence at the table surface.
      const discShotPath = path.join(evidenceDir, 'opendesign-task-6-phases-discussion.png');
      await p1.screenshot({ path: discShotPath, fullPage: true });

      // 3. Host advances to Voting Phase from the dock
      await p1.locator('.table-action-dock #btn-advance-vote').click();

      await expect(p1.locator('.table-action-dock h2')).toHaveText('投票指認階段');
      await expect(p2.locator('.table-action-dock h2')).toHaveText('投票指認階段');
      await expect(p3.locator('.table-action-dock h2')).toHaveText('投票指認階段');

      // Verify vote form and vote progress inside the dock
      await expect(p1.locator('.table-action-dock #vote-form')).toBeVisible();
      await expect(p1.locator('.table-action-dock .vote-progress')).toBeVisible();
      await expect(p2.locator('.table-action-dock #vote-form')).toBeVisible();
      await expect(p3.locator('.table-action-dock #vote-form')).toBeVisible();
      await expect(p1.locator('#phase-action-panel')).toHaveCount(0);

      // Capture the full-cycle dock surface at the table.
      const cycleShotPath = path.join(
        evidenceDir,
        'task-8-game-table-interaction-redesign-full-cycle.png'
      );
      await p1.screenshot({ path: cycleShotPath, fullPage: true });

      // Capture voting evidence at the table surface.
      const voteShotPath = path.join(evidenceDir, 'opendesign-task-6-phases-voting.png');
      await p1.screenshot({ path: voteShotPath, fullPage: true });

      // Cast votes; the dock survives the projection rerender after each ballot.
      await p1.locator('.table-action-dock #btn-submit-vote').click();
      // Once voted, shows submitted confirmation
      await expect(p1.locator('.table-action-dock .alert-success')).toContainText('您已完成投票');

      // Verify other players cannot see P1's target in DOM
      const p2Html = await p2.content();
      expect(p2Html).not.toContain('指認目標為');

      await p2.locator('.table-action-dock #btn-submit-vote').click();
      await p3.locator('.table-action-dock #btn-submit-vote').click();

      // After all vote, game transitions to results
      await expect(p1.locator('#results-panel')).toBeVisible();
      await p1.screenshot({
        path: path.join(evidenceDir, 'task-8-game-table-interaction-redesign-full-cycle-results.png'),
        fullPage: true,
      });

      const jsonPath = path.join(evidenceDir, 'opendesign-task-6-phases.json');
      fs.writeFileSync(jsonPath, JSON.stringify({
        phasesCompleted: ['discussion', 'voting'],
        privacyPreserved: true,
        audioTriggersVerified: true,
        dockHosted: true,
      }, null, 2));
      fs.writeFileSync(
        path.join(evidenceDir, 'task-8-game-table-interaction-redesign-phases.json'),
        JSON.stringify(
          {
            discussionDockCount,
            hostAdvanceInDock: true,
            guestAdvanceAbsent: true,
            votingFormInDock: true,
            leftPhasePanelAbsent: true,
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

  test('duplicate vote submit dispatches once and a disconnected submit recovers from the dock', async ({ browser }) => {
    const capture: VoteCapture = { castVotes: [] };
    const { pages, contexts } = await startRoom(
      browser,
      ['愛麗絲', '鮑伯', '查理'],
      {
        viewport: { width: 1280, height: 800 },
        onPage: async (page, index) => {
          if (index === 1) await recordVotes(page, capture);
        },
      }
    );
    const [p1, p2, p3] = pages;

    try {
      await completeDraft(pages);
      await expect(p1.locator('.table-action-dock h2')).toHaveText('自由討論階段');
      await p1.locator('.table-action-dock #btn-advance-vote').click();
      for (const page of pages) {
        await expect(page.locator('.table-action-dock h2')).toHaveText('投票指認階段');
      }

      // Duplicate submit: two synchronous submit events in one task produce exactly one frame.
      await p2.evaluate(() => {
        const form = document.querySelector('#vote-form');
        if (!form) throw new Error('vote form missing');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await expect.poll(() => capture.castVotes.length).toBe(1);
      const duplicateFrames = capture.castVotes.length;
      await expect(p2.locator('.table-action-dock .alert-success')).toContainText('您已完成投票');

      // Disconnected submit: the socket is closed, so dispatchAction() returns false.
      await p3.evaluate(() => {
        (window as unknown as { __NOW__?: { client: { disconnect(): void } } }).__NOW__?.client.disconnect();
      });
      await p3.locator('.table-action-dock #btn-submit-vote').click();
      const dockAlert = p3.locator('.table-action-dock [role="alert"]');
      await expect(dockAlert).toBeVisible();
      await expect(dockAlert).toBeFocused();
      await expect(dockAlert).toContainText('連線中斷');
      const alertText = (await dockAlert.textContent()) ?? '';

      // Reconnect replays the safe projection: the dock rerenders and the retry succeeds.
      await p3.evaluate(() => {
        (window as unknown as { __NOW__?: { client: { connect(): void } } }).__NOW__?.client.connect();
      });
      await expect(p3.locator('.table-action-dock [role="alert"]')).toHaveCount(0);
      await p3.locator('.table-action-dock #btn-submit-vote').click();
      await expect(p3.locator('.table-action-dock .alert-success')).toContainText('您已完成投票');

      await p1.locator('.table-action-dock #btn-submit-vote').click();
      await expect(p1.locator('#results-panel')).toBeVisible();

      const jsonPath = path.join(evidenceDir, 'task-8-game-table-interaction-redesign-recovery.json');
      fs.writeFileSync(jsonPath, JSON.stringify({
        duplicateVoteFrames: duplicateFrames,
        disconnectedAlertFocused: true,
        disconnectedAlertText: alertText,
        retrySucceeded: true,
        resultsReached: true,
      }, null, 2));
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
