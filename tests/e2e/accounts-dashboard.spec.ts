import { test, expect, type Page } from '@playwright/test';

declare global { interface Window { __releaseLobbyResponse?: () => void; } }

async function register(page: Page, name: string) {
  await page.goto(new URL('/register', process.env.BASE_URL ?? 'http://localhost:3000').toString());
  await page.getByLabel(/^玩家暱稱/).fill(name);
  const email = `player-${crypto.randomUUID()}@example.com`;
  await page.getByLabel(/^電郵/).fill(email);
  await page.getByLabel(/^密碼/).fill('Browser-Password123!');
  await page.getByLabel(/^確認密碼/).fill('Browser-Password123!');
  await page.getByRole('button', { name: '建立帳戶', exact: true }).click();
  await expect(page.getByRole('heading', { name: '公開大廳', exact: true })).toBeVisible();
  return email;
}

test('registration, real empty statistics and default private room', async ({ page }) => {
  await register(page, '測試目擊者');
  await expect(page.getByTestId('stat-participated')).toHaveText('0');
  await expect(page.getByTestId('stat-winrate')).toHaveText('—');
  await page.screenshot({ path: `test-results/dashboard-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '建立房間', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /公開房間/ })).not.toBeChecked();
  await page.getByRole('button', { name: '確認建立', exact: true }).click();
  await expect(page.locator('#lobby-panel')).toBeVisible();
  await expect(page.getByText('私人房間', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /返回大廳/ }).click();
  await expect(page.getByRole('heading', { name: '公開大廳', exact: true })).toBeVisible();
});

test('public room is discoverable and another authenticated player can join', async ({ browser }) => {
  const options = { baseURL: process.env.BASE_URL ?? 'http://localhost:3000', viewport: test.info().project.use.viewport, isMobile: test.info().project.use.isMobile, hasTouch: test.info().project.use.hasTouch };
  const hostContext = await browser.newContext(options);
  const guestContext = await browser.newContext(options);
  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    await register(host, '公開房主');
    await host.getByRole('button', { name: '建立房間', exact: true }).click();
    await host.getByRole('checkbox', { name: /公開房間/ }).check();
    await host.getByRole('button', { name: '確認建立', exact: true }).click();
    await expect(host.locator('#lobby-panel')).toBeVisible();
    await register(guest, '加入玩家');
    await guest.getByRole('button', { name: '加入公開房主的房間' }).click();
    await expect(guest.locator('#player-roster')).toContainText('公開房主');
    await expect(host.locator('#player-roster')).toContainText('加入玩家');
    await guest.reload();
    await expect(guest.locator('#lobby-panel')).toBeVisible();
  } finally { await hostContext.close(); await guestContext.close(); }
});

test('login, register and forgot-password are accessible from the login page', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: `test-results/login-${test.info().project.name}.png`, fullPage: true });
  await expect(page.locator('.auth-form').getByRole('link', { name: '建立帳戶', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '忘記密碼？' }).click();
  await page.getByLabel(/^電郵/).fill('absent@example.com');
  await page.getByRole('button', { name: '傳送重設連結' }).click();
  await expect(page.locator('.auth-form [role="status"]')).toContainText('如電郵已註冊');
});

test('an older public-room response cannot overwrite a manual refresh', async ({page}) => {
  await register(page,'列表更新玩家');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const original=window.fetch.bind(window);
    let requests=0;
    window.fetch=(input,options)=>{
      if(input!=='/api/rooms/public') return original(input,options);
      const first=++requests===1;
      const response=()=>new Response(JSON.stringify({rooms:[{roomCode:first?'OLD234':'NEW234',hostName:first?'過時房主':'最新房主',level:'L1',playerCount:1,maxPlayers:6,createdAt:new Date().toISOString()}]}),{headers:{'Content-Type':'application/json'}});
      return first ? new Promise(resolve=>{window.__releaseLobbyResponse=()=>resolve(response());}) : Promise.resolve(response());
    };
  });
  try {
    await page.getByRole('button',{name:'重新整理',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>Boolean(window.__releaseLobbyResponse))).toBe(true);
    await page.getByRole('button',{name:'重新整理',exact:true}).click();
    await expect(page.getByRole('button',{name:'加入最新房主的房間'})).toBeVisible();
    await page.evaluate(()=>window.__releaseLobbyResponse!());
    await page.waitForTimeout(200);
    await expect(page.getByRole('button',{name:'加入最新房主的房間'})).toBeVisible();
    await expect(page.getByRole('button',{name:'加入過時房主的房間'})).toHaveCount(0);
  } finally {await page.evaluate(()=>window.__releaseLobbyResponse?.());}
});

test('three authenticated players finish a real game and save one result per player', async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all(Array.from({length:3}, () => browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:3000', viewport: test.info().project.use.viewport, isMobile: test.info().project.use.isMobile, hasTouch: test.info().project.use.hasTouch })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  try {
    for (let index=0; index<pages.length; index++) await register(pages[index], `實戰玩家${index+1}`);
    const host = pages[0];
    await host.getByRole('button', {name:'建立房間',exact:true}).click();
    await host.getByRole('button', {name:'確認建立',exact:true}).click();
    await expect(host.locator('#lobby-panel')).toBeVisible();
    const code = await host.evaluate(() => window.__NOW__!.client.getProjection()!.roomCode);
    for (const page of pages.slice(1)) {
      await page.getByLabel('6 碼房間代碼').fill(code);
      await page.getByRole('button', {name:'加入房間',exact:true}).click();
      await expect(page.locator('#lobby-panel')).toBeVisible();
    }
    for (const page of pages) {
      await page.locator('#btn-toggle-ready').click();
      await expect(page.locator('#btn-toggle-ready')).toHaveText('取消準備');
    }
    await host.locator('#btn-start-game').click();
    await expect.poll(() => host.evaluate(() => window.__NOW__!.client.getProjection()?.phase)).toBe('draft');
    const byIdentity = new Map<string, Page>();
    for (const page of pages) byIdentity.set(await page.evaluate(() => window.__NOW__!.client.getProjection()!.viewerId), page);
    for (let round=0; round<6; round++) {
      const state = await host.evaluate(() => window.__NOW__!.client.getProjection()!);
      if (state.phase !== 'draft') break;
      const actor = byIdentity.get(state.currentActorId!)!;
      await expect.poll(() => actor.evaluate(() => Boolean(window.__NOW__!.client.getProjection()?.cardMotion))).toBe(false);
      for (let draw=0; draw<2; draw++) {
        const count = await actor.evaluate(() => window.__NOW__!.client.getProjection()!.ownCards?.length ?? 0);
        if (count >= 2) break;
        await actor.locator('#draw-pile').click();
        await expect.poll(() => actor.evaluate(() => Boolean(window.__NOW__!.client.getProjection()?.cardMotion))).toBe(false);
        await expect.poll(() => actor.evaluate(() => window.__NOW__!.client.getProjection()!.ownCards?.length ?? 0)).toBe(count+1);
      }
      await actor.locator('.hand-slot .card-face').first().click();
      await expect(actor.locator('#card-detail-dialog')).toBeVisible();
      await actor.locator('#btn-pass-card').click();
      const target = actor.locator('.seat-target').first();
      if (await target.count()) await target.click(); else await actor.locator('.guest-room-target').click();
      await actor.locator('#btn-confirm-pass').click();
      await expect.poll(() => actor.evaluate(() => window.__NOW__!.client.isActionPending())).toBe(false);
      await expect.poll(() => host.evaluate(() => Boolean(window.__NOW__!.client.getProjection()?.cardMotion))).toBe(false);
    }
    await expect.poll(() => host.evaluate(() => window.__NOW__!.client.getProjection()?.phase)).toBe('discussion');
    for (const page of pages) {
      await page.locator('#btn-consent-vote').click();
      await expect.poll(() => page.evaluate(() => window.__NOW__!.client.isActionPending())).toBe(false);
    }
    for (const page of pages) {
      await page.getByRole('combobox', {name:'投票目標地點'}).click();
      await page.getByRole('option').first().click();
      await page.locator('#btn-submit-vote').click();
      await expect.poll(() => page.evaluate(() => window.__NOW__!.client.isActionPending())).toBe(false);
    }
    await expect(host.getByText('戰績已保存，可在「我的戰績」查看。')).toBeVisible();
    await host.screenshot({path:`test-results/result-${test.info().project.name}.png`,fullPage:true});
    for (const page of pages) {
      const stats = await (await page.request.get('/api/me/stats')).json();
      expect(stats.participated).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.wins + stats.losses + stats.noWinner).toBe(1);
      expect((await (await page.request.get('/api/me/matches')).json()).total).toBe(1);
    }
    await host.locator('#btn-rematch').click();
    for (const page of pages) {
      await expect(page.locator('#lobby-panel')).toBeVisible();
      await page.locator('#btn-toggle-ready').click();
      await expect(page.locator('#btn-toggle-ready')).toHaveText('取消準備');
    }
    await host.locator('#btn-start-game').click();
    await expect.poll(() => host.evaluate(() => window.__NOW__!.client.getProjection()?.phase)).toBe('draft');
    await expect.poll(async () => (await (await host.request.get('/api/me/matches')).json()).total).toBe(2);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('password reset email works once and the old session is revoked', async ({ page }) => {
  const email = await register(page, '重設密碼玩家');
  await page.goto('/forgot-password');
  await page.getByLabel(/^電郵/).fill(email);
  await page.getByRole('button', {name:'傳送重設連結'}).click();
  await expect(page.locator('.auth-form [role="status"]')).toContainText('如電郵已註冊');
  const mailbox = await (await page.request.get('http://mailpit:8025/api/v1/messages')).json();
  const message = mailbox.messages.find((entry: {To:Array<{Address:string}>}) => entry.To.some(recipient => recipient.Address === email));
  expect(message).toBeTruthy();
  const mail = await (await page.request.get(`http://mailpit:8025/api/v1/message/${message.ID}`)).json();
  const resetUrl = String(mail.Text).match(/http:\/\/localhost:3000\/reset-password\?token=[\w-]+/)?.[0];
  expect(resetUrl).toBeTruthy();
  await page.goto(resetUrl!);
  await page.getByLabel(/^密碼/).fill('Changed-BrowserPassword123!');
  await page.getByLabel(/^確認密碼/).fill('Changed-BrowserPassword123!');
  await page.getByRole('button', {name:'更新密碼'}).click();
  await expect(page.locator('.auth-form [role="status"]')).toContainText('密碼已更新');
  expect(page.url()).not.toContain('token=');
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.goto('/login');
  await page.getByLabel(/^電郵/).fill(email);
  await page.getByLabel(/^密碼/).fill('Changed-BrowserPassword123!');
  await page.getByRole('button', {name:'登入',exact:true}).click();
  await expect(page.getByRole('heading', {name:'公開大廳',exact:true})).toBeVisible();
});

test('shared login detects admin permission and retains it after reload', async ({ page }) => {
  test.skip(!process.env.SEED_ADMIN_PASSWORD, 'Initial admin password must be configured and seed applied');
  await page.goto('/login');
  await expect(page.getByRole('link', {name:'管理員入口'})).toHaveCount(0);
  await page.getByLabel(/^電郵/).fill(process.env.SEED_ADMIN_EMAIL ?? 'admin@now.com');
  await page.getByLabel(/^密碼/).fill(process.env.SEED_ADMIN_PASSWORD!);
  await page.getByRole('button', {name:'登入',exact:true}).click();
  await expect(page.getByRole('heading', {name:'管理總覽',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', {name:'管理總覽',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'管理員登出'}).click();
  await expect(page.getByRole('heading', {name:'歡迎回到酒館',exact:true})).toBeVisible();
  expect((await page.request.get('/api/admin/overview')).status()).toBe(401);
  await page.goto('/admin/login');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', {name:'歡迎回到酒館',exact:true})).toBeVisible();
});

test('ordinary accounts cannot open management and have no admin entry', async ({page}) => {
  await register(page, '一般玩家');
  expect((await page.request.get('/api/admin/overview')).status()).toBe(401);
  await expect(page.getByRole('link', {name:'管理員入口'})).toHaveCount(0);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', {name:'歡迎回到酒館',exact:true})).toBeVisible();
});
