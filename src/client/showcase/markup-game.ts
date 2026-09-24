/**
 * Tavern Design System: interaction-oriented showcase sections.
 * Pure markup builders for the menu, canonical ring, privacy cards,
 * dialogs, transfer states, and the simultaneous result reveal.
 */

import { ROLES } from '../../shared/rules.ts';
import { getTableSeats } from '../views/game-seating.ts';
import type { SeatPosition } from '../views/game-seating.ts';
import {
  renderCardDetailDialog,
  renderOpponentBack,
  renderOwnCard,
  renderResultCard,
} from '../views/game-cards.ts';

interface SampleSeat {
  readonly playerId: string;
  readonly name: string;
  readonly location: string;
  readonly state: string;
  readonly seatClass: string;
  readonly current?: boolean;
}

const SAMPLE_SEATS: readonly SampleSeat[] = [
  { playerId: 'p1', name: '我（觀看者）', location: '書房', state: '等待出牌', seatClass: '', current: true },
  { playerId: 'p2', name: '玩家 B', location: '交誼廳', state: '當前回合', seatClass: 'is-active' },
  { playerId: 'p3', name: '玩家 C', location: '玄關', state: '離線', seatClass: 'is-offline' },
  { playerId: 'p4', name: '玩家 D', location: '撞球室', state: '可傳牌目標', seatClass: 'is-targeted' },
  { playerId: 'p5', name: '玩家 E', location: '餐廳', state: '拖曳放置', seatClass: 'is-drop-ready' },
];

const RESULT_ROLE_IDS = ['murderer', 'accomplice', 'detective', 'guest'] as const;

function renderSeat(sample: SampleSeat, position: SeatPosition): string {
  const current = sample.current === true ? ' aria-current="true"' : '';
  return `
            <button type="button" class="seat ${sample.seatClass}" data-player-id="${sample.playerId}" data-relative-index="${position.relativeIndex}" style="--seat-x: ${position.x}; --seat-y: ${position.y}"${current}>
              <span class="seat-name">${sample.name}</span>
              <span class="seat-location">${sample.location}</span>
              <span class="seat-state">${sample.state}</span>
            </button>`;
}

function renderRingSeats(): string {
  const positions = getTableSeats(
    SAMPLE_SEATS.map((seat) => ({ playerId: seat.playerId })),
    'p1'
  );
  return SAMPLE_SEATS.map((sample, index) => renderSeat(sample, positions[index])).join('');
}

export function renderMenuSection(): string {
  return `
      <section class="panel">
        <h2>6. 遊戲選單：展開與收合 (Game Menu: Expanded / Collapsed)</h2>
        <p>桌面側欄展開寬度 <code>clamp(240px, 22vw, 300px)</code>，收合為 <code>64px</code> 圖示列；行動版為預設關閉的抽屜，由 <code>#btn-show-game-menu</code> 開啟。</p>
        <div class="showcase-menu-frame">
          <nav id="game-menu" data-state="expanded" aria-label="遊戲選單">
            <button type="button" id="btn-toggle-game-menu" class="game-menu-item game-menu-toggle" aria-expanded="true" aria-controls="game-menu-content">
              <span class="game-menu-badge" aria-hidden="true">選</span>
              <span class="sr-only">切換遊戲選單</span>
              <span class="game-menu-label">切換側欄</span>
            </button>
            <div id="game-menu-content" class="game-menu-content">
              <button type="button" class="game-menu-item"><span class="game-menu-badge" aria-hidden="true">房</span><span class="game-menu-label">房間資訊</span></button>
              <button type="button" class="game-menu-item"><span class="game-menu-badge" aria-hidden="true">角</span><span class="game-menu-label">我的身分</span></button>
              <button type="button" class="game-menu-item"><span class="game-menu-badge" aria-hidden="true">證</span><span class="game-menu-label">證詞紀錄</span></button>
            </div>
          </nav>
          <div class="showcase-menu-table">流動木桌主要活動區</div>
        </div>
      </section>`;
}

export function renderRingSection(): string {
  return `
      <section class="panel table-panel">
        <h2>7. 遊戲桌：標準座次與客房目標 (Canonical Ring &amp; Guest Room)</h2>
        <p>座標由 <code>getTableSeats</code> 依 <code>relativeIndex = (canonicalIndex - viewerIndex + count) % count</code> 計算，橢圓半徑為 45×38；觀看者位於底部中央，下一位順時針玩家在右側，客房固定於桌面中央 <code>(x=50, y=50)</code>。</p>
        <div class="showcase-ring" id="showcase-ring">
          <div class="table-oval" aria-hidden="true"></div>
          <div class="showcase-ring-seats">${renderRingSeats()}
          </div>
          <button type="button" class="guest-room-target" data-target-id="guest-room">
            <span class="guest-room-name">客房</span>
            <span class="guest-room-hint">最終傳牌目標</span>
          </button>
        </div>
        <div class="table-action-dock" aria-label="桌面操作列">
          <button type="button" class="secondary-button">管家能力</button>
          <button type="button" class="secondary-button">進入投票</button>
          <span class="dock-status">傳牌階段：請選擇手牌與目標</span>
        </div>
      </section>`;
}

export function renderCardsSection(): string {
  const ownCards = [
    renderOwnCard(
      { id: 'own-card-1', role: 'detective', label: ROLES.detective.label },
      { kicker: '自己的手牌 1', actionHint: '可指認地點' }
    ),
    renderOwnCard(
      { id: 'own-card-2', role: 'butler', label: ROLES.butler.label },
      { kicker: '已選取', actionHint: '傳遞或查看詳情', selected: true }
    ),
  ]
    .map((card) => card.outerHTML)
    .join('\n          ');

  return `
      <section class="panel">
        <h2>8. 手牌隱私：自己的正面與對手的背面 (Own Face / Opponent Back)</h2>
        <p>自己的手牌由卡片模組以 <code>.card-face</code> 正面顯示，並各附一個獨立的 <code>[data-action="view-card"]</code> 詳情按鈕；對手座位只放 <code>.card-back</code>，其 DOM、無障礙名稱、<code>title</code>、<code>data-*</code> 與拖曳資料絕不含角色、卡牌 ID 或標籤。</p>
        <div class="cards-row">
          ${ownCards}
          ${renderOpponentBack().outerHTML}
        </div>
        <div class="transfer-box" role="status">
          <span class="transfer-status">宣稱狀態：尚未選擇手牌與目標</span>
        </div>
      </section>`;
}

export function renderDialogsSection(): string {
  const roleOptions = Object.entries(ROLES)
    .map(([, role]) => `<option value="${role.id}">${role.label}</option>`)
    .join('\n          ');

  return `
      <section class="panel">
        <h2>9. 對話框：卡牌詳情與必經宣稱確認 (Dialogs)</h2>
        <p>卡牌詳情使用原生 <code>&lt;dialog class="card-detail"&gt;</code>，標題、陣營、目標與能力由 <code>ROLES</code>、<code>FACTIONS</code> 與 <code>ROLE_DETAILS</code> 填入；可傳遞的卡片顯示 <code>#btn-pass-card</code>，僅供檢視的卡片則不顯示，Escape 關閉後焦點回到觸發卡片。宣稱對話框 <code>#claim-dialog</code> 必須經 <code>#btn-confirm-pass</code> 才會送出。</p>
        <div class="btn-group">
          <button type="button" class="secondary-button" id="btn-open-showcase-dialog">開啟示範對話框</button>
          <button type="button" class="secondary-button" data-action="view-card" data-card-id="own-card-1" data-card-role="detective" data-passable="true">開啟卡牌詳情（可傳遞）</button>
          <button type="button" class="secondary-button" id="btn-open-readonly-detail" data-action="view-card" data-card-id="guest_1" data-card-role="guest" data-passable="false">開啟卡牌詳情（僅檢視）</button>
          <button type="button" class="secondary-button" id="btn-open-claim-dialog">開啟宣稱確認</button>
        </div>

        <dialog id="showcase-dialog" class="claim-dialog">
          <h3>示範對話框 (Showcase Dialog)</h3>
          <p>原生對話框示範：開啟後焦點留在對話框內，Escape 或取消可關閉，關閉後焦點回到開啟按鈕。</p>
          <div class="btn-group" style="justify-content: flex-end;">
            <button type="button" class="secondary-button" id="btn-dialog-cancel">取消</button>
            <button type="button" class="primary-button" id="btn-dialog-confirm">確認</button>
          </div>
        </dialog>

        ${renderCardDetailDialog().outerHTML}

        <dialog id="claim-dialog" class="claim-dialog" data-state="idle" aria-labelledby="claim-dialog-title">
          <h3 id="claim-dialog-title">宣稱確認</h3>
          <p>選擇要公開宣稱的身分；變更選項不會送出，必須按下「確認傳遞」。</p>
          <div class="form-group">
            <label for="claim-role-select">公開宣稱</label>
            <select id="claim-role-select">
              <option value="">不特別聲明</option>
              ${roleOptions}
            </select>
          </div>
          <div class="btn-group">
            <button type="button" class="secondary-button" id="btn-cancel-pass">取消</button>
            <button type="button" class="primary-button" id="btn-confirm-pass" data-state="idle">確認傳遞</button>
          </div>
        </dialog>
      </section>`;
}

export function renderRevealSection(): string {
  const cards = RESULT_ROLE_IDS.map((roleId) => renderResultCard(roleId).outerHTML).join(
    '\n          '
  );

  return `
      <section class="panel">
        <h2>10. 結果揭示前後 (Result Reveal: Pre / Post)</h2>
        <p>揭示前所有結果卡為背面；按下切換後，單一 <code>.is-revealed</code> 類別讓所有卡片同時翻面，減少動態時立即顯示正面。結果卡正面只由 <code>projection.result</code> 的資料填入。</p>
        <button type="button" class="secondary-button" id="btn-showcase-reveal">切換揭示狀態</button>
        <div class="cards-row" id="showcase-result-table" data-reveal-state="pre">
          ${cards}
        </div>
      </section>`;
}

export function renderGameSections(): string {
  return [
    renderMenuSection(),
    renderRingSection(),
    renderCardsSection(),
    renderDialogsSection(),
    renderRevealSection(),
  ].join('\n');
}
