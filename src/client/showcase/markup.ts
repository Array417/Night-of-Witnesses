/**
 * Tavern Design System: primitive showcase markup.
 * Static primitive sections plus the interaction sections from markup-game.
 */

import { renderGameSections } from './markup-game.ts';

function renderStaticSections(): string {
  return `
      <!-- 1. Panels & Headings -->
      <section class="panel">
        <h2>1. 面板與排版 (Panels &amp; Typography)</h2>
        <p>深色胡桃木與皮革漸層面板，內嵌古銅雙層邊框。</p>
        <div class="panel-inner" style="padding: 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--r-sm);">
          <h3>內部面板 (Elevated Surface)</h3>
          <p>次要內容與背景說明文字，字體使用 Noto Sans TC 與 Iowan Old Style 襯線字體。</p>
        </div>
      </section>

      <!-- 2. Buttons -->
      <section class="panel">
        <h2>2. 操作按鈕 (Buttons)</h2>
        <div class="btn-group" style="margin-bottom: 12px;">
          <button type="button" class="primary-button" id="btn-showcase-primary">主要操作 (黃銅)</button>
          <button type="button" class="secondary-button" id="btn-showcase-secondary">次要操作 (胡桃木)</button>
          <button type="button" class="danger-button" id="btn-showcase-danger">危險操作 (深紅)</button>
          <button type="button" class="role-button" id="btn-showcase-role">秘密身分 (摺疊)</button>
          <button type="button" class="primary-button" disabled>已停用按鈕</button>
        </div>
      </section>

      <!-- 3. Form Controls -->
      <section class="panel">
        <h2>3. 表單與輸入欄位 (Form Controls)</h2>
        <div class="form-group">
          <label for="showcase-input-text">玩家暱稱 (支援 24 字元繁體中文)</label>
          <input type="text" id="showcase-input-text" value="福爾摩斯大偵探" placeholder="請輸入姓名" />
        </div>
        <div class="form-group">
          <label for="showcase-select-room">地點選擇 (權威伺服器地點)</label>
          <select id="showcase-select-room">
            <option value="living_room">交誼廳</option>
            <option value="gallery">畫廊</option>
            <option value="billiards_room">撞球室</option>
            <option value="study">書房</option>
            <option value="entrance">玄關</option>
            <option value="dining_room">餐廳</option>
          </select>
        </div>
        <fieldset>
          <legend>證詞選擇 (Radio Option)</legend>
          <div style="display: flex; gap: 16px; margin-top: 8px;">
            <label class="radio-option" style="display: flex; align-items: center; gap: 8px; min-height: 44px; min-width: 44px; cursor: pointer;">
              <input type="radio" name="claim-group" value="witness" checked style="width: 20px; height: 20px; accent-color: var(--brass);" />
              <span>目擊者 (Witness)</span>
            </label>
            <label class="radio-option" style="display: flex; align-items: center; gap: 8px; min-height: 44px; min-width: 44px; cursor: pointer;">
              <input type="radio" name="claim-group" value="bystander" style="width: 20px; height: 20px; accent-color: var(--brass);" />
              <span>路人 (Bystander)</span>
            </label>
          </div>
        </fieldset>
      </section>

      <!-- 4. Alerts -->
      <section class="panel">
        <h2>4. 訊息與提示橫幅 (Alert Banners)</h2>
        <div class="alert alert-danger" role="alert" data-state="error">連線逾時，正在嘗試重新建立房間對話。</div>
        <div class="alert alert-warning" role="alert">請注意：管家本輪無法參與投票。</div>
        <div class="alert alert-success" role="alert">房間建立成功！房間代碼：W8K9M2</div>
      </section>

      <!-- 5. Connection Badges -->
      <section class="panel">
        <h2>5. 連線狀態標記 (Connection Badges)</h2>
        <div style="display: flex; flex-wrap: wrap; gap: 12px;">
          <div class="connection" data-status="connected"><span>已連線 (Connected)</span></div>
          <div class="connection" data-status="connecting"><span>連線中 (Connecting)</span></div>
          <div class="connection" data-status="reconnecting"><span>重新連線中 (Reconnecting)</span></div>
          <div class="connection" data-status="disconnected"><span>已中斷 (Disconnected)</span></div>
          <div class="connection" data-status="error"><span>連線錯誤 (Error)</span></div>
        </div>
      </section>`;
}

function renderStateSections(): string {
  return `
      <!-- 11. Empty & Loading States -->
      <section class="panel">
        <h2>11. 空白與載入狀態 (Empty &amp; Loading States)</h2>
        <div class="state-loading">
          <div class="spinner"></div>
          <p>正在同步房間狀態，請稍候...</p>
        </div>
        <div class="state-empty">
          <p>目前尚無任何證詞紀錄</p>
          <button type="button" class="secondary-button">重新整理</button>
        </div>
      </section>`;
}

export function renderShowcaseMarkup(): string {
  return `
    <div id="design-showcase" class="page">
      <h1>酒館設計系統元件展示 (Tavern Primitive Showcase)</h1>
      <p>涵蓋所有基礎元件、顏色標記、排版、響應式互動狀態，以及桌面座次、對話框與結果揭示流程。</p>
${renderStaticSections()}
${renderGameSections()}
${renderStateSections()}
    </div>`;
}
