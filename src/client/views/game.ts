/**
 * Active game shell with shared responsive table and phase-specific action panels.
 */
import { el } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import {
  PLAYER_LOCATIONS,
  ROLES,
} from '../../shared/rules.ts';
import { renderGameTable } from './game-table.ts';
import { renderDraftAction } from './game-draft.ts';
import { renderDiscussionAction, renderVotingAction } from './game-phases.ts';

export function renderGame(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.innerHTML = '';

  const me = projection.players.find((p) => p.playerId === projection.viewerId);
  const myLocation = me?.locationId ? PLAYER_LOCATIONS[me.locationId]?.label : '未知';

  const phaseLabels: Record<string, string> = {
    draft: '抽牌傳遞階段',
    discussion: '自由討論階段',
    voting: '投票指認階段',
  };

  // Outer responsive layout container
  const layout = el('div', { class: 'layout' });

  // Left Column: Menu & Actions
  const leftCol = el('div', { class: 'menu stack' });

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
  leftCol.appendChild(header);

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
  leftCol.appendChild(rolePanel);

  // 3. Phase Action Panel
  const actionPanel = el('div', { class: 'panel', id: 'phase-action-panel' });
  let selectedRecipientId: string | undefined = undefined;

  // Right Column: Shared Witness Table (instantiate first so draft action can reference it)
  const tablePanel = renderGameTable({
    projection,
    selectedRecipientId,
    onSelectRecipient: (pid: string) => {
      const select = actionPanel.querySelector('#recipient-select') as HTMLSelectElement | null;
      if (select) {
        select.value = pid;
        select.dispatchEvent(new Event('change'));
      }
    },
  });

  const onTargetChanged = (pid: string) => {
    selectedRecipientId = pid;
    tablePanel.querySelectorAll('.seat').forEach((s) => {
      if (s.getAttribute('data-player-id') === pid) {
        s.classList.add('is-targeted');
      } else {
        s.classList.remove('is-targeted');
      }
    });
  };

  if (projection.phase === 'draft') {
    renderDraftAction(actionPanel, projection, client, onTargetChanged);
  } else if (projection.phase === 'discussion') {
    renderDiscussionAction(actionPanel, projection, client);
  } else if (projection.phase === 'voting') {
    renderVotingAction(actionPanel, projection, client);
  }
  leftCol.appendChild(actionPanel);

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
  leftCol.appendChild(testimonyPanel);

  layout.appendChild(leftCol);
  layout.appendChild(tablePanel);
  container.appendChild(layout);
}
