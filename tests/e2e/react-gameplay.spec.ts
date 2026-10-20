import {test, expect, type Page, type Locator} from '@playwright/test';
import {startRoom, handCards, drawHand, firstSeatTarget, confirmClaim} from './draft-flow.ts';

test('card backs stay inside the pile and animation at phone, tablet and desktop sizes', async ({browser}) => {
  const {pages,contexts} = await startRoom(browser,['牌背測試','牌背二','牌背三'],{drawFirstHand:false});
  const host=pages[0];
  try {
    for(const width of [375,768,1280]) {
      await host.setViewportSize({width,height:1000});
      const back=host.locator('#draw-pile > .card-back');
      const art=back.locator('img');
      await expect(art).toBeVisible();
      await expect.poll(()=>art.evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
      const parent=await back.boundingBox(), image=await art.boundingBox();
      expect(image!.width).toBeLessThanOrEqual(parent!.width+1);
      expect(image!.height).toBeLessThanOrEqual(parent!.height+1);
      expect(image!.x).toBeGreaterThanOrEqual(parent!.x-1);
      expect(image!.x+image!.width).toBeLessThanOrEqual(parent!.x+parent!.width+1);
      const pile=await host.locator('#draw-pile').boundingBox();
      expect(await host.locator('#draw-pile').evaluate(element=>getComputedStyle(element).position)).toBe('absolute');
      const ring=await host.locator('.table-ring').boundingBox();
      expect(Math.abs(pile!.x+pile!.width/2-ring!.x-ring!.width/2)).toBeLessThan(2);
      expect(Math.abs(pile!.y+pile!.height/2-ring!.y-ring!.height/2)).toBeLessThan(2);
      const label=await host.locator('.draw-pile-label').boundingBox();
      expect(pile!.height).toBeLessThan(160);
      expect(label!.y).toBeGreaterThanOrEqual(parent!.y+parent!.height);
      expect(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await host.locator('.table-panel').screenshot({path:`test-results/card-pile-${width}-${test.info().project.name}.png`});
    }
    await host.locator('#draw-pile').click();
    await expect(host.locator('.card-motion')).toBeVisible();
    const observer=pages[1];
    const motion=observer.locator('.card-motion .card-back');
    await expect(motion).toBeVisible();
    const bounds=await motion.boundingBox(), art=await motion.locator('img').boundingBox();
    expect(art!.width).toBeLessThanOrEqual(bounds!.width+1);
    expect(art!.height).toBeLessThanOrEqual(bounds!.height+1);
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});

test('level options describe all eight configurations and show real role counts and abilities', async ({browser}) => {
  const {contexts}=await startRoom(browser,['關卡房主','關卡二','關卡三','關卡四'],{
    viewport:test.info().project.use.viewport??undefined,
    onLobby:async pages=>{
      const host=pages[0], guest=pages[1];
      for(const level of ['L1','L2','L3','L4','L5','L6','L7','L8']) {
        await host.getByRole('combobox',{name:'規則配置等級'}).click();
        const option=host.getByRole('option',{name:new RegExp(`^${level} ·`)});
        await expect(option).toBeVisible();
        await option.click();
        await expect.poll(()=>host.evaluate(()=>window.__NOW__!.client.getProjection()?.level)).toBe(level);
        const details=host.getByRole('region',{name:'關卡角色與規則'});
        await expect(details).toContainText('兇手');
        await expect(guest.getByRole('region',{name:'關卡角色與規則'})).toContainText(level);
        if(level==='L7') {
          await expect(details).toContainText('扣置 2 張');
          await expect(details.getByRole('button',{name:/房客/})).toHaveCount(0);
        }
      }
      const details=host.getByRole('region',{name:'關卡角色與規則'});
      await expect(details).toContainText('移除 2 張');
      await expect(details.getByRole('button',{name:/房客 × 2/})).toBeVisible();
      await details.getByRole('button',{name:/管家 × 1/}).click();
      await expect(details).toContainText('看過牌後必須棄權');
      expect(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await host.screenshot({path:`test-results/level-details-${test.info().project.name}.png`,fullPage:true});
    },
  });
  await Promise.all(contexts.map(context=>context.close()));
});

async function drag(page: Page, source: Locator, target: Locator, touch: boolean) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox(), to = await target.boundingBox();
  expect(from).toBeTruthy(); expect(to).toBeTruthy();
  const start = {x:from!.x+from!.width/2,y:from!.y+from!.height/2};
  const end = {x:to!.x+to!.width/2,y:to!.y+to!.height/2};
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1}]});
    for (let step=1; step<=8; step++) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*step/8,y:start.y+(end.y-start.y)*step/8,id:1}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await session.detach();
  } else {
    await page.mouse.move(start.x,start.y); await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:8}); await page.mouse.up();
  }
}

test('keyboard card dialog restores focus and keyboard transfer remains usable', async ({browser}) => {
  const {pages,contexts} = await startRoom(browser,['鍵盤玩家','鍵盤二','鍵盤三']);
  const host = pages[0];
  try {
    const card = handCards(host).first();
    await card.focus(); await card.press('Enter');
    await expect(host.locator('#card-detail-dialog')).toBeVisible();
    await host.keyboard.press('Escape');
    await expect(host.locator('#card-detail-dialog')).toBeHidden();
    await expect(card).toBeFocused();
    await card.press('Space');
    await host.locator('#btn-pass-card').press('Enter');
    await firstSeatTarget(host).focus(); await firstSeatTarget(host).press('Enter');
    await expect(host.locator('#claim-dialog')).toBeVisible();
    await host.locator('#btn-confirm-pass').press('Enter');
    await expect.poll(() => host.evaluate(() => {const state=window.__NOW__!.client.getProjection()!;return state.currentActorId !== state.viewerId;})).toBe(true);
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});

for (const touch of [false,true]) test(`${touch?'touch':'mouse'} pointer draw and transfer preserve React-owned cards`, async ({browser}) => {
  const {pages,contexts} = await startRoom(browser,['拖牌玩家','拖牌二','拖牌三'],{drawFirstHand:false,viewport:{width:test.info().project.use.viewport?.width??1280,height:1600},contextOptions:()=>({hasTouch:touch,isMobile:test.info().project.use.isMobile})});
  const host=pages[0];
  try {
    await expect(host.locator('#draw-pile')).toBeEnabled();
    await drag(host,host.locator('#draw-pile'),host.locator('.hand-slot'),touch);
    await expect(handCards(host)).toHaveCount(1);
    await drawHand(host);
    await drag(host,handCards(host).first(),firstSeatTarget(host),touch);
    await expect(host.locator('#claim-dialog')).toBeVisible();
    await confirmClaim(host);
    await expect(host.locator('#claim-dialog')).toBeHidden();
    await expect(host.locator('.is-pointer-dragging')).toHaveCount(0);
    await expect.poll(() => host.evaluate(() => {const state=window.__NOW__!.client.getProjection()!;return state.currentActorId !== state.viewerId;})).toBe(true);
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});

test('six-player responsive table and reduced-motion DOM never expose opponent cards', async ({browser}) => {
  const {pages,contexts} = await startRoom(browser,['<b>房主</b>','二號證人','三號證人','四號證人','五號證人','六號證人'],{level:'L3',contextOptions:()=>({reducedMotion:'reduce'})});
  try {
    const [host,other]=pages;
    const privateCards=await host.evaluate(()=>window.__NOW__!.client.getProjection()!.ownCards!);
    await expect(host.locator('.seat-name').filter({hasText:'<b>房主</b>'})).toHaveCount(1);
    await expect(host.locator('.seat-name b')).toHaveCount(0);
    for(const card of privateCards) {
      await expect(other.locator(`[data-card-id="${card.id}"]`)).toHaveCount(0);
    }
    for(const page of pages) {
      await expect(page.locator('.seat:not([aria-current="true"]) [data-role]')).toHaveCount(0);
      await expect(page.locator('.seat')).toHaveCount(6);
    }
    for(const width of [375,768,1280]) {
      await host.setViewportSize({width,height:850});
      await expect(host.locator('.table-stage')).toBeVisible();
      expect(await host.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const stage=await host.locator('.table-stage').boundingBox();
      const seats=await host.locator('.seat').all();
      for(const seat of seats) {
        const box=await seat.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);
        expect(box!.y).toBeGreaterThanOrEqual(stage!.y-1);
      }
    }
    expect(await host.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await host.reload();
    await expect(host.locator('.table-stage')).toBeVisible();
    await expect.poll(()=>host.evaluate(()=>window.__NOW__!.client.getProjection()?.ownCards?.length)).toBe(2);
    await expect(host.locator('.seat')).toHaveCount(6);
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});
