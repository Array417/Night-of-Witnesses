import { el, announce, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import {
  PLAYER_LOCATIONS,
  ROLES,
  type PlayerLocationId,
  type RoleId,
} from '../../shared/rules.ts';

export function renderGame(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.innerHTML = '';

  const me = projection.players.find((p) => p.playerId === projection.viewerId);
  const myLocation = me?.locationId ? PLAYER_LOCATIONS[me.locationId]?.label : '未知';
  const isHost = projection.isHost;

  const phaseLabels: Record<string, string> = {
    draft: '抽牌傳遞階段',
    discussion: '自由討論階段',
    voting: '投票指認階段',
  };

  const header = el('header', { class: 'panel', id: 'game-header' }, [
    el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;' }, [
      el('span', { class: 'badge', id: 'room-info' }, [`房間：${projection.roomCode}`]),
      el('span', { class: 'badge', id: 'phase-info' }, [`階段：${phaseLabels[projection.phase] || projection.phase}`]),
    ]),
    el('p', { id: 'my-location-indicator', style: 'font-size: 1.1rem; font-weight: 700;' }, [
      `您的身處地點：【${myLocation}】`,
    ]),
  ]);

  // Private Role Drawer / Secret Card (Hidden until explicit reveal button click)
  const rolePanel = el('div', { class: 'panel', id: 'private-role-panel' });
  const revealBtn = el(
    'button',
    {
      id: 'btn-toggle-role',
      type: 'button',
      class: 'btn btn-secondary btn-block',
      'aria-expanded': 'false',
      'aria-controls': 'secret-role-content',
    },
    ['👁️ 查看我的秘密角色']
  );

  const roleContent = el(
    'div',
    {
      id: 'secret-role-content',
      style: 'display: none; margin-top: 1rem; padding: 1rem; background-color: var(--color-bg-canvas); border-radius: var(--radius-sm); border: 1px dashed var(--color-border); text-align: center;',
    },
    [
      projection.ownRole
        ? el('div', {}, [
            el('h3', { style: 'color: var(--color-primary); margin-bottom: 0.25rem;' }, [
              `您的角色：${projection.ownRole.label}`,
            ]),
            el('p', { class: 'text-secondary', style: 'margin-bottom: 0;' }, [
              `陣營：${ROLES[projection.ownRole.role]?.faction === 'murderer_faction' ? '兇手陣營' : ROLES[projection.ownRole.role]?.faction === 'bomber_faction' ? '炸彈魔（獨自獲勝）' : '目擊者陣營'}`,
            ]),
          ])
        : el('p', { class: 'text-secondary' }, ['尚未取得角色卡']),
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

  // Phase Actions
  const actionPanel = el('div', { class: 'panel', id: 'phase-action-panel' });

  if (projection.phase === 'draft') {
    renderDraftSection(actionPanel, projection, client);
  } else if (projection.phase === 'discussion') {
    renderDiscussionSection(actionPanel, projection, client);
  } else if (projection.phase === 'voting') {
    renderVotingSection(actionPanel, projection, client);
  }

  // Public Testimony Trail
  const testimonyPanel = el('div', { class: 'panel', id: 'testimony-panel' }, [
    el('h3', {}, ['公開目擊者證詞記錄']),
    projection.testimonyTrail.length === 0
      ? el('p', { class: 'text-muted' }, ['尚無傳遞記錄'])
      : el(
          'ul',
          { style: 'list-style: none; padding-left: 0;' },
          projection.testimonyTrail.map((t, idx) => {
            const fromName = projection.players.find((p) => p.playerId === t.fromPlayerId)?.playerName || '未知';
            const toName = t.toPlayerId
              ? projection.players.find((p) => p.playerId === t.toPlayerId)?.playerName || '未知'
              : '客房（扣置）';
            const claim = t.testimonyRole ? ROLES[t.testimonyRole]?.label || t.testimonyRole : '無聲明';
            return el('li', { style: 'padding: 0.25rem 0; font-size: 0.95rem;' }, [
              `#${idx + 1} ${fromName} 傳給了 ${toName}，聲稱卡片為：【${claim}】`,
            ]);
          })
        ),
  ]);

  container.appendChild(header);
  container.appendChild(rolePanel);
  container.appendChild(actionPanel);
  container.appendChild(testimonyPanel);
}

function renderDraftSection(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  const isMyTurn = projection.currentActorId === projection.viewerId;
  const currentActorName =
    projection.players.find((p) => p.playerId === projection.currentActorId)?.playerName || '未知';

  if (!isMyTurn) {
    container.appendChild(
      el('div', { class: 'alert alert-warning' }, [
        `等待 【${currentActorName}】 選擇並傳遞卡片中...`,
      ])
    );
    return;
  }

  container.appendChild(el('h2', {}, ['輪到您的回合：抽牌與傳遞']));
  container.appendChild(
    el('p', { class: 'text-secondary' }, [
      '請從以下兩張卡片中，秘密保留一張，並將另一張傳遞給未曾拿過牌的玩家。',
    ])
  );

  const ownCards = projection.ownCards || [];
  if (ownCards.length !== 2) {
    container.appendChild(el('p', {}, ['正在等待手牌發送...']));
    return;
  }

  const isFinalPlayer = projection.servedPlayerIds.length === projection.players.length;

  const form = el('form', { id: 'draft-form' }, [
    el('fieldset', { style: 'border: 1px solid var(--color-border); padding: 1rem; margin-bottom: 1.25rem; border-radius: var(--radius-sm);' }, [
      el('legend', { style: 'font-weight: 700; padding: 0 0.5rem;' }, ['選擇要保留的角色卡']),
      ...ownCards.map((card, idx) =>
        el('div', { class: 'form-group', style: 'flex-direction: row; align-items: center; margin-bottom: 0.5rem;' }, [
          el('input', {
            type: 'radio',
            id: `keep-card-${idx}`,
            name: 'keepCardId',
            value: card.id,
            checked: idx === 0,
            style: 'width: auto; min-height: 24px; min-width: 24px; margin-right: 0.5rem;',
          }),
          el('label', { for: `keep-card-${idx}`, style: 'font-size: 1.1rem; cursor: pointer;' }, [
            `【${card.label}】`,
          ]),
        ])
      ),
    ]),
  ]);

  if (!isFinalPlayer) {
    // Recipient selector: players not in servedPlayerIds
    const unservedPlayers = projection.players.filter(
      (p) => !projection.servedPlayerIds.includes(p.playerId)
    );

    const recipientGroup = el('div', { class: 'form-group' }, [
      el('label', { for: 'recipient-select' }, ['選擇傳遞對象']),
      el(
        'select',
        { id: 'recipient-select', required: true },
        unservedPlayers.map((p) =>
          el('option', { value: p.playerId }, [
            `${p.playerName}（${p.locationId ? PLAYER_LOCATIONS[p.locationId]?.label : ''}）`,
          ])
        )
      ),
    ]);

    // Optional testimony claim
    const testimonyGroup = el('div', { class: 'form-group' }, [
      el('label', { for: 'testimony-select' }, ['公開聲稱傳遞的角色（可誠實亦可說謊）']),
      el('select', { id: 'testimony-select' }, [
        el('option', { value: '' }, ['（不特別聲明）']),
        ...projection.publicRoleRoster.map((r) =>
          el('option', { value: r }, [ROLES[r]?.label || r])
        ),
      ]),
    ]);

    form.appendChild(recipientGroup);
    form.appendChild(testimonyGroup);
  } else {
    form.appendChild(
      el('div', { class: 'alert alert-warning' }, [
        '您是最後一位選牌玩家，剩餘的一張卡片將秘密扣置於【客房】中。',
      ])
    );
  }

  const submitBtn = el(
    'button',
    { id: 'btn-confirm-pass', type: 'submit', class: 'btn btn-primary btn-block' },
    ['確認保留並傳遞']
  );
  form.appendChild(submitBtn);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const checkedRadio = form.querySelector('input[name="keepCardId"]:checked') as HTMLInputElement;
    if (!checkedRadio) return;

    const keepCardId = checkedRadio.value;
    let passToPlayerId: string | undefined = undefined;
    let testimonyRole: RoleId | undefined = undefined;

    if (!isFinalPlayer) {
      const recipientSelect = form.querySelector('#recipient-select') as HTMLSelectElement;
      passToPlayerId = recipientSelect?.value;
      const testimonySelect = form.querySelector('#testimony-select') as HTMLSelectElement;
      if (testimonySelect?.value) {
        testimonyRole = testimonySelect.value as RoleId;
      }
    }

    client.dispatchAction({
      type: 'choose_and_pass',
      keepCardId,
      passToPlayerId,
      testimonyRole,
    });
  });

  container.appendChild(form);
}

function renderDiscussionSection(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.appendChild(el('h2', {}, ['自由討論階段']));
  container.appendChild(
    el('p', { class: 'text-secondary' }, [
      '所有玩家已獲得角色卡，現在請自由進行發言與推理。特殊角色可於此階段發動能力。',
    ])
  );

  const me = projection.ownRole;

  // Butler ability control
  if (me?.role === 'butler') {
    const butlerBox = el('div', { style: 'margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--color-primary); border-radius: var(--radius-sm);' }, [
      el('h3', {}, ['管家特殊能力']),
      el('p', { class: 'text-secondary' }, [
        '管家可於討論階段秘密查看 2 張扣置卡牌。使用後本輪將無法參與指認投票。',
      ]),
    ]);

    if (projection.butlerPeek) {
      butlerBox.appendChild(
        el('div', { class: 'alert alert-success' }, [
          `您查看的 2 張扣置卡為：【${projection.butlerPeek.map((c) => c.label).join('、')}】（您本輪須棄權）`,
        ])
      );
    } else {
      const peekBtn = el('button', { id: 'btn-butler-peek', type: 'button', class: 'btn btn-secondary' }, [
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
    const detectiveBox = el('div', { style: 'margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--color-primary); border-radius: var(--radius-sm);' }, [
      el('h3', {}, ['偵探特殊能力']),
      el('p', { class: 'text-secondary' }, [
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
        { id: 'btn-detective-send', type: 'button', class: 'btn btn-danger' },
        ['立即逮捕送往鍋爐室']
      ),
    ]);

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
      { id: 'btn-advance-vote', type: 'button', class: 'btn btn-primary btn-block', style: 'margin-top: 1rem;' },
      ['討論結束，進入指認投票階段']
    );
    hostAdvanceBtn.addEventListener('click', () => {
      client.dispatchAction({ type: 'advance_to_vote' });
    });
    container.appendChild(hostAdvanceBtn);
  } else {
    container.appendChild(el('p', { class: 'text-muted' }, ['等待房主結束討論並開啟投票...']));
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
    el('p', { class: 'text-secondary' }, ['請指認您懷疑是兇手（或欲送往鍋爐室）的玩家地點：'])
  );

  const occupiedLocations = projection.players.filter((p) => p.locationId !== null);

  const form = el('form', { id: 'vote-form' }, [
    el('fieldset', { style: 'border: 1px solid var(--color-border); padding: 1rem; margin-bottom: 1.25rem; border-radius: var(--radius-sm);' }, [
      el('legend', { style: 'font-weight: 700; padding: 0 0.5rem;' }, ['請選擇投票目標地點']),
      ...occupiedLocations.map((p, idx) =>
        el('div', { class: 'form-group', style: 'flex-direction: row; align-items: center; margin-bottom: 0.5rem;' }, [
          el('input', {
            type: 'radio',
            id: `vote-target-${idx}`,
            name: 'targetLocation',
            value: p.locationId!,
            checked: idx === 0,
            style: 'width: auto; min-height: 24px; min-width: 24px; margin-right: 0.5rem;',
          }),
          el('label', { for: `vote-target-${idx}`, style: 'font-size: 1.1rem; cursor: pointer;' }, [
            `【${PLAYER_LOCATIONS[p.locationId!]?.label}】（${p.playerName}）`,
          ]),
        ])
      ),
    ]),
    el(
      'button',
      { id: 'btn-submit-vote', type: 'submit', class: 'btn btn-primary btn-block' },
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
