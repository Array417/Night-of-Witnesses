/**
 * Active game shell with a narrow collapsible menu and the shared responsive table.
 *
 * Interaction mode follows input capability (`pointer: coarse`); media queries only
 * decide the page-frame layout. The desktop collapse boolean persists for the browser
 * session under `night-of-witnesses.game-menu-collapsed.v1`, so a projection rerender,
 * reconnect, or reload never reopens the menu. On coarse-pointer/narrow viewports the
 * same menu becomes a closed-by-default drawer with a persistent opener.
 */
import { el } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import {
  PLAYER_LOCATIONS,
  ROLES,
} from '../../shared/rules.ts';
import { renderGameTable } from './game-table.ts';
import { createDraftCoordinator, renderDraftWaiting } from './game-draft.ts';
import { renderDiscussionAction, renderVotingAction } from './game-phases.ts';

const GAME_MENU_STATE_KEY = 'night-of-witnesses.game-menu-collapsed.v1';
/** Kept in sync with the `max-width: 767px` drawer media query in styles.css. */
const MOBILE_MENU_MAX_WIDTH = 767;

export function renderGame(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  // A projection rerender must not slam the drawer shut while the viewer is using it;
  // the previous view's state is the only memory, so it resets when the view unmounts.
  const wasDrawerOpen =
    container.querySelector<HTMLElement>('#game-menu')?.dataset.state === 'open';
  container.innerHTML = '';

  const me = projection.players.find((p) => p.playerId === projection.viewerId);
  const myLocation = me?.locationId ? PLAYER_LOCATIONS[me.locationId]?.label : '未知';

  const phaseLabels: Record<string, string> = {
    draft: '抽牌傳遞階段',
    discussion: '自由討論階段',
    voting: '投票指認階段',
  };

  // Input capability decides interaction mode; media queries decide the page frame.
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const drawerMode =
    coarsePointer || window.matchMedia(`(max-width: ${MOBILE_MENU_MAX_WIDTH}px)`).matches;

  // Outer responsive layout container
  const layout = el('div', { class: 'layout' });

  // Menu: narrow collapsible sidebar on desktop, closed-by-default drawer on mobile.
  const menu = el('nav', { id: 'game-menu', 'aria-label': '遊戲選單' });

  const showMenuLabel = el('span', { class: 'game-menu-label' }, ['選單']);
  const showMenuButton = el(
    'button',
    {
      type: 'button',
      id: 'btn-show-game-menu',
      class: 'game-menu-item game-menu-show',
      'aria-expanded': 'false',
      'aria-controls': 'game-menu-content',
      'aria-label': '顯示遊戲選單',
    },
    [el('span', { class: 'game-menu-badge', 'aria-hidden': 'true' }, ['選']), showMenuLabel]
  );

  const toggleMenuLabel = el('span', { class: 'game-menu-label' }, ['收合選單']);
  const toggleMenuButton = el(
    'button',
    {
      type: 'button',
      id: 'btn-toggle-game-menu',
      class: 'game-menu-item game-menu-toggle',
      'aria-expanded': 'true',
      'aria-controls': 'game-menu-content',
      'aria-label': '收合遊戲選單',
    },
    [el('span', { class: 'game-menu-badge', 'aria-hidden': 'true' }, ['選']), toggleMenuLabel]
  );

  const menuContent = el('div', { id: 'game-menu-content', class: 'game-menu-content stack' });

  // 1. Header panel
  const header = el('header', { class: 'panel', id: 'game-header' }, [
    el(
      'div',
      {
        style:
          'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; flex-wrap: wrap;',
      },
      [
        el('span', { class: 'connection', id: 'room-info' }, [`房間：${projection.roomCode}`]),
        el('span', { class: 'connection', id: 'phase-info' }, [
          `階段：${phaseLabels[projection.phase] || projection.phase}`,
        ]),
      ]
    ),
    el('p', { id: 'my-location-indicator', style: 'font-size: 1.15rem; font-weight: 700; color: #fff3d7; margin-bottom: 0;' }, [
      `您的身處地點：【${myLocation}】`,
    ]),
  ]);
  menuContent.appendChild(header);

  // 2. Private Role Drawer
  const rolePanel = el('div', { class: 'panel', id: 'private-role-panel' });
  const revealBtn = el(
    'button',
    {
      id: 'btn-toggle-role',
      type: 'button',
      class: 'role-button btn-block',
      'aria-expanded': 'false',
      'aria-controls': 'secret-role-content',
    },
    ['👁️ 查看我的秘密角色']
  );

  const roleContent = el(
    'div',
    {
      id: 'secret-role-content',
      style: 'display: none; margin-top: 12px; text-align: center;',
    },
    [
      projection.ownRole
        ? el('div', { class: 'secret-role' }, [
            el('h3', { style: 'color: var(--parchment-ink); margin-bottom: 4px; font-size: 1.25rem;' }, [
              `您的角色：${projection.ownRole.label}`,
            ]),
            el('p', { style: 'color: #53331b; margin-bottom: 0; font-size: 0.95rem;' }, [
              `陣營：${
                ROLES[projection.ownRole.role]?.faction === 'murderer_faction'
                  ? '兇手陣營'
                  : ROLES[projection.ownRole.role]?.faction === 'bomber_faction'
                  ? '炸彈魔（獨自獲勝）'
                  : '目擊者陣營'
              }`,
            ]),
          ])
        : el('p', { class: 'label-hint' }, ['尚未取得角色卡']),
    ]
  );

  let isRevealed = false;
  revealBtn.addEventListener('click', () => {
    isRevealed = !isRevealed;
    revealBtn.setAttribute('aria-expanded', String(isRevealed));
    revealBtn.textContent = isRevealed ? '🔒 隱藏我的秘密角色' : '👁️ 查看我的秘密角色';
    roleContent.style.display = isRevealed ? 'block' : 'none';
  });

  rolePanel.appendChild(revealBtn);
  rolePanel.appendChild(roleContent);
  menuContent.appendChild(rolePanel);

  // 3. Phase Action Panel — draft transfer controls only. Discussion and voting
  // controls render into the table's `.table-action-dock` via the table options.
  const actionPanel = el('div', { class: 'panel', id: 'phase-action-panel' });

  // One transfer coordinator owns card/target/claim state for the draft actor; the
  // table forwards drops and target activations into its single confirmation path.
  const draft =
    projection.phase === 'draft' &&
    projection.currentActorId === projection.viewerId &&
    (projection.ownCards?.length ?? 0) === 2
      ? createDraftCoordinator({
          root: container,
          panel: actionPanel,
          projection,
          client,
          tapSelect: coarsePointer,
        })
      : null;

  // Table surface (right column): the dominant active-game area.
  const tablePanel = renderGameTable({
    projection,
    onSelectRecipient: draft?.onSelectRecipient,
    onDropCard: draft?.onDropCard,
    onSelectGuestRoom: draft?.onSelectGuestRoom,
    renderPhaseActions: (host) => {
      if (projection.phase === 'discussion') {
        renderDiscussionAction(host, projection, client);
      } else if (projection.phase === 'voting') {
        renderVotingAction(host, projection, client);
      }
    },
  });

  // Coarse-pointer tap selection: tapping an own card selects/replaces it. The
  // `[data-action="view-card"]` trigger stays the only tap path to card details.
  if (draft !== null && coarsePointer) {
    tablePanel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-action="view-card"]')) return;
      const card = target.closest<HTMLElement>('.card-face[data-hand="viewer"][data-card-id]');
      const cardId = card?.dataset.cardId;
      if (cardId !== undefined && cardId !== '') draft.onSelectCard(cardId);
    });
  }

  // Draft waiting/status stays in the menu panel; other phases render in the dock.
  if (projection.phase === 'draft') {
    if (draft === null) renderDraftWaiting(actionPanel, projection);
    menuContent.appendChild(actionPanel);
  }

  // 4. Public Testimony Trail Panel
  const testimonyPanel = el('div', { class: 'panel', id: 'testimony-panel' }, [
    el('h3', { style: 'margin-bottom: 12px;' }, ['公開目擊者證詞記錄']),
    projection.testimonyTrail.length === 0
      ? el('p', { class: 'label-hint' }, ['尚無傳遞記錄'])
      : el(
          'ul',
          { style: 'list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 6px;' },
          projection.testimonyTrail.map((t, idx) => {
            const fromName =
              projection.players.find((p) => p.playerId === t.fromPlayerId)?.playerName || '未知';
            const toName = t.toPlayerId
              ? projection.players.find((p) => p.playerId === t.toPlayerId)?.playerName || '未知'
              : '客房（扣置）';
            const claim = t.testimonyRole
              ? ROLES[t.testimonyRole]?.label || t.testimonyRole
              : '無聲明';
            return el(
              'li',
              {
                style:
                  'padding: 8px 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--r-sm); font-size: 0.9rem; color: #fff0d2;',
              },
              [`#${idx + 1} ${fromName} 傳給了 ${toName}，聲稱卡片為：【${claim}】`]
            );
          })
        ),
  ]);
  menuContent.appendChild(testimonyPanel);

  // Collapsed boolean persists for the browser session: a rerender, reconnect, or reload
  // must not reopen the menu. The drawer state stays transient and closed by default.
  function setMenuCollapsed(collapsed: boolean): void {
    menu.dataset.state = collapsed ? 'collapsed' : 'expanded';
    toggleMenuButton.setAttribute('aria-expanded', String(!collapsed));
    toggleMenuLabel.textContent = collapsed ? '展開選單' : '收合選單';
    toggleMenuButton.setAttribute('aria-label', collapsed ? '展開遊戲選單' : '收合遊戲選單');
    try {
      window.sessionStorage.setItem(GAME_MENU_STATE_KEY, String(collapsed));
    } catch {
      // Storage unavailable: the menu still works, it just does not persist.
    }
  }

  function setDrawerOpen(open: boolean): void {
    menu.dataset.state = open ? 'open' : 'closed';
    showMenuButton.setAttribute('aria-expanded', String(open));
    showMenuLabel.textContent = open ? '收合選單' : '選單';
    showMenuButton.setAttribute('aria-label', open ? '收合遊戲選單' : '顯示遊戲選單');
  }

  function readStoredCollapsed(): boolean {
    try {
      return window.sessionStorage.getItem(GAME_MENU_STATE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  if (drawerMode) {
    setDrawerOpen(wasDrawerOpen);
  } else {
    setMenuCollapsed(readStoredCollapsed());
  }

  toggleMenuButton.addEventListener('click', () => {
    setMenuCollapsed(menu.dataset.state === 'expanded');
  });
  showMenuButton.addEventListener('click', () => {
    setDrawerOpen(menu.dataset.state !== 'open');
  });
  // Escape is scoped to the menu element, so the listener dies with the view; focus
  // always starts on the persistent opener, which is inside the menu.
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menu.dataset.state !== 'open') return;
    setDrawerOpen(false);
    showMenuButton.focus();
  });

  menu.appendChild(showMenuButton);
  menu.appendChild(toggleMenuButton);
  menu.appendChild(menuContent);

  layout.appendChild(menu);
  layout.appendChild(tablePanel);
  container.appendChild(layout);
}
