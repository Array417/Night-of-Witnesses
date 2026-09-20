/**
 * Active game shell with shared responsive table and phase-specific action panels.
 */
import { el } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import {
  PLAYER_LOCATIONS,
  ROLES,
  type PlayerLocationId,
  type RoleId,
} from '../../shared/rules.ts';
import { renderGameTable } from './game-table.ts';
import { renderDraftAction } from './game-draft.ts';

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
    renderDiscussionSection(actionPanel, projection, client);
  } else if (projection.phase === 'voting') {
    renderVotingSection(actionPanel, projection, client);
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

function renderDiscussionSection(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.appendChild(el('h2', {}, ['自由討論階段']));
  container.appendChild(
    el('p', { class: 'label-hint', style: 'margin-bottom: 16px;' }, [
      '所有玩家已獲得角色卡，現在請自由進行發言與推理。特殊角色可於此階段發動能力。',
    ])
  );

  const me = projection.ownRole;

  // Butler ability control
  if (me?.role === 'butler') {
    const butlerBox = el(
      'div',
      {
        style:
          'margin-bottom: 20px; padding: 16px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--panel-2);',
      },
      [
        el('h3', {}, ['管家特殊能力']),
        el('p', { class: 'label-hint' }, [
          '管家可於討論階段秘密查看 2 張扣置卡牌。使用後本輪將無法參與指認投票。',
        ]),
      ]
    );

    if (projection.butlerPeek) {
      butlerBox.appendChild(
        el('div', { class: 'alert alert-success' }, [
          `您查看的 2 張扣置卡為：【${projection.butlerPeek.map((c) => c.label).join('、')}】（您本輪須棄權）`,
        ])
      );
    } else {
      const peekBtn = el('button', { id: 'btn-butler-peek', type: 'button', class: 'secondary-button' }, [
        '發動能力：查看 2 張扣置卡',
      ]);
      peekBtn.addEventListener('click', () => {
        client.dispatchAction({ type: 'butler_peek' });
      });
      butlerBox.appendChild(peekBtn);
    }
    container.appendChild(butlerBox);
  }

  // Detective ability control
  if (me?.role === 'detective') {
    const detectiveBox = el(
      'div',
      {
        style:
          'margin-bottom: 20px; padding: 16px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--panel-2);',
      },
      [
        el('h3', {}, ['偵探特殊能力']),
        el('p', { class: 'label-hint' }, [
          '偵探可指認一位在場玩家，並立即將其押送至鍋爐室，遊戲將直接進入結算！',
        ]),
        el('div', { class: 'form-group' }, [
          el('label', { for: 'detective-target-select' }, ['選擇要送入鍋爐室的地點']),
          el(
            'select',
            { id: 'detective-target-select' },
            projection.players
              .filter((p) => p.locationId !== null)
              .map((p) =>
                el('option', { value: p.locationId! }, [
                  `${PLAYER_LOCATIONS[p.locationId!]?.label}（${p.playerName}）`,
                ])
              )
          ),
        ]),
        el(
          'button',
          { id: 'btn-detective-send', type: 'button', class: 'danger-button' },
          ['立即逮捕送往鍋爐室']
        ),
      ]
    );

    const sendBtn = detectiveBox.querySelector('#btn-detective-send') as HTMLButtonElement;
    sendBtn.addEventListener('click', () => {
      const targetSelect = detectiveBox.querySelector('#detective-target-select') as HTMLSelectElement;
      if (targetSelect?.value) {
        client.dispatchAction({
          type: 'detective_send',
          targetLocation: targetSelect.value as PlayerLocationId,
        });
      }
    });

    container.appendChild(detectiveBox);
  }

  // Host advance button
  if (projection.isHost) {
    const hostAdvanceBtn = el(
      'button',
      {
        id: 'btn-advance-vote',
        type: 'button',
        class: 'primary-button btn-block',
        style: 'margin-top: 16px;',
      },
      ['討論結束，進入指認投票階段']
    );
    hostAdvanceBtn.addEventListener('click', () => {
      client.dispatchAction({ type: 'advance_to_vote' });
    });
    container.appendChild(hostAdvanceBtn);
  } else {
    container.appendChild(el('p', { class: 'label-hint' }, ['等待房主結束討論並開啟投票...']));
  }
}

function renderVotingSection(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.appendChild(el('h2', {}, ['投票指認階段']));

  const me = projection.ownRole;
  const isButlerPeeked = me?.role === 'butler' && Boolean(projection.butlerPeek);

  if (isButlerPeeked) {
    container.appendChild(
      el('div', { class: 'alert alert-warning' }, [
        '您已於討論階段查看扣置卡，依規則必須於投票階段棄權。等待其他玩家投票中...',
      ])
    );
    return;
  }

  if (projection.ownBallot) {
    container.appendChild(
      el('div', { class: 'alert alert-success' }, [
        `您已完成投票，指認目標為：【${PLAYER_LOCATIONS[projection.ownBallot]?.label}】。等待其他人完成投票...`,
      ])
    );
    return;
  }

  container.appendChild(
    el('p', { class: 'label-hint', style: 'margin-bottom: 16px;' }, [
      '請指認您懷疑是兇手（或欲送往鍋爐室）的玩家地點：',
    ])
  );

  const occupiedLocations = projection.players.filter((p) => p.locationId !== null);

  const form = el('form', { id: 'vote-form' }, [
    el('fieldset', { style: 'margin-bottom: 20px;' }, [
      el('legend', {}, ['請選擇投票目標地點']),
      ...occupiedLocations.map((p, idx) =>
        el(
          'label',
          {
            class: 'radio-option',
            style: 'display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer;',
          },
          [
            el('input', {
              type: 'radio',
              id: `vote-target-${idx}`,
              name: 'targetLocation',
              value: p.locationId!,
              checked: idx === 0,
              style: 'width: 20px; height: 20px; accent-color: var(--brass);',
            }),
            el('span', { style: 'font-size: 1rem;' }, [
              `【${PLAYER_LOCATIONS[p.locationId!]?.label}】（${p.playerName}）`,
            ]),
          ]
        )
      ),
    ]),
    el(
      'button',
      { id: 'btn-submit-vote', type: 'submit', class: 'primary-button btn-block' },
      ['送出投票']
    ),
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const checked = form.querySelector('input[name="targetLocation"]:checked') as HTMLInputElement;
    if (checked?.value) {
      client.dispatchAction({
        type: 'cast_vote',
        targetLocation: checked.value as PlayerLocationId,
      });
    }
  });

  container.appendChild(form);
}
