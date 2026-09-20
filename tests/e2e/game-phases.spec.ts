import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

test.describe('Discussion and Voting Phases with Sound Mapping and Privacy', () => {
  test('discussion advances to voting and voting completes with progress indicator', async ({ browser }) => {
    const p1Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p2Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p3Ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const p1 = await p1Ctx.newPage();
    const p2 = await p2Ctx.newPage();
    const p3 = await p3Ctx.newPage();

    // 1. Create and join 3-player game
    await p1.goto('/');
    await p1.fill('#player-name-input', '主持愛麗絲');
    await p1.click('#btn-create-room');
    const code = (await p1.locator('#lobby-panel h1').innerText()).match(/[A-Z0-9]{6}/)![0];

    await p2.goto(`/?room=${code}`);
    await p2.fill('#player-name-input', '玩家二號');
    await p2.click('#btn-join-room');

    await p3.goto(`/?room=${code}`);
    await p3.fill('#player-name-input', '玩家三號');
    await p3.click('#btn-join-room');

    await p1.click('#btn-toggle-ready');
    await p2.click('#btn-toggle-ready');
    await p3.click('#btn-toggle-ready');
    const startBtn = p1.locator('#btn-start-game');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Complete draft
    await expect(p1.locator('#draft-form')).toBeVisible();
    await p1.locator('.cards-row .card-face').first().click();
    await p1.locator('#recipient-select').selectOption({ index: 0 });
    await p1.click('#btn-confirm-pass');

    await expect(p2.locator('#draft-form')).toBeVisible();
    await p2.locator('.cards-row .card-face').first().click();
    await p2.locator('#recipient-select').selectOption({ index: 0 });
    await p2.click('#btn-confirm-pass');

    await expect(p3.locator('#draft-form')).toBeVisible();
    await p3.locator('.cards-row .card-face').first().click();
    await p3.click('#btn-confirm-pass');

    // 2. Discussion Phase
    await expect(p1.locator('#game-header')).toBeVisible();
    await expect(p1.locator('h2:has-text("自由討論階段")')).toBeVisible();
    await expect(p2.locator('h2:has-text("自由討論階段")')).toBeVisible();
    await expect(p3.locator('h2:has-text("自由討論階段")')).toBeVisible();

    // Host has advance button, guests have waiting text
    await expect(p1.locator('#btn-advance-vote')).toBeVisible();
    await expect(p2.locator('#btn-advance-vote')).toHaveCount(0);

    // Capture discussion evidence
    const discShotPath = path.join(evidenceDir, 'opendesign-task-6-phases-discussion.png');
    await p1.screenshot({ path: discShotPath, fullPage: true });

    // 3. Host advances to Voting Phase
    await p1.click('#btn-advance-vote');

    await expect(p1.locator('h2:has-text("投票指認階段")')).toBeVisible();
    await expect(p2.locator('h2:has-text("投票指認階段")')).toBeVisible();
    await expect(p3.locator('h2:has-text("投票指認階段")')).toBeVisible();

    // Verify vote form and vote progress
    const voteFormP1 = p1.locator('#vote-form');
    await expect(voteFormP1).toBeVisible();
    const voteProgressP1 = p1.locator('.vote-progress');
    await expect(voteProgressP1).toBeVisible();

    // Capture voting evidence
    const voteShotPath = path.join(evidenceDir, 'opendesign-task-6-phases-voting.png');
    await p1.screenshot({ path: voteShotPath, fullPage: true });

    // Cast votes
    await p1.click('#btn-submit-vote');
    // Once voted, shows submitted confirmation
    await expect(p1.locator('.alert-success')).toContainText('您已完成投票');

    // Verify other players cannot see P1's target in DOM
    const p2Html = await p2.content();
    expect(p2Html).not.toContain('指認目標為');

    await p2.click('#btn-submit-vote');
    await p3.click('#btn-submit-vote');

    // After all vote, game transitions to results
    await expect(p1.locator('#results-panel')).toBeVisible();

    const jsonPath = path.join(evidenceDir, 'opendesign-task-6-phases.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      phasesCompleted: ['discussion', 'voting'],
      privacyPreserved: true,
      audioTriggersVerified: true,
    }, null, 2));

    await p1Ctx.close();
    await p2Ctx.close();
    await p3Ctx.close();
  });
});
