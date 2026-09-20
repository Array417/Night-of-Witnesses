/**
 * Draft phase action controls with interactive cards and drag & drop support.
 */
import { el, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { PLAYER_LOCATIONS, ROLES, type RoleId } from '../../shared/rules.ts';
import { audioManager } from '../audio/manager.ts';

export function renderDraftAction(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient,
  onTargetChanged?: (playerId: string) => void
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
    el('p', { class: 'label-hint', style: 'margin-bottom: 16px;' }, [
      '請從以下兩張卡片中，秘密保留一張，並將另一張傳遞給未曾拿過牌的玩家。',
    ])
  );

  const ownCards = projection.ownCards || [];
  if (ownCards.length !== 2) {
    container.appendChild(el('p', {}, ['正在等待手牌發送...']));
    return;
  }

  const isFinalPlayer = projection.servedPlayerIds.length === projection.players.length;
  let selectedKeepIndex = 0;

  // Cards Row
  const cardsRow = el('div', { class: 'cards-row' });
  const cardElements: HTMLElement[] = [];

  ownCards.forEach((card, idx) => {
    const isSelected = idx === selectedKeepIndex;
    const cardEl = el(
      'div',
      {
        class: `card-face ${isSelected ? 'is-selected' : ''}`,
        tabindex: '0',
        draggable: 'true',
        'data-card-id': card.id,
        'aria-label': `卡片 ${idx + 1}：${card.label}。${isSelected ? '已選取保留' : '點擊選取保留'}`,
        style: 'min-height: 120px; min-width: 110px;',
      },
      [
        el('span', { class: 'card-kicker' }, [isSelected ? '已選取保留' : `卡片 ${idx + 1}`]),
        el('span', { class: 'card-role' }, [card.label]),
        el('span', { class: 'card-action' }, ['點擊保留 / 拖曳傳遞']),
      ]
    );

    const selectThisCard = () => {
      selectedKeepIndex = idx;
      audioManager.playCue('card_select');
      cardElements.forEach((c, i) => {
        if (i === idx) {
          c.classList.add('is-selected');
          c.querySelector('.card-kicker')!.textContent = '已選取保留';
        } else {
          c.classList.remove('is-selected');
          c.querySelector('.card-kicker')!.textContent = `卡片 ${i + 1}`;
        }
      });
      const radio = container.querySelector(`#keep-card-${idx}`) as HTMLInputElement | null;
      if (radio) radio.checked = true;
    };

    cardEl.addEventListener('click', selectThisCard);
    cardEl.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        selectThisCard();
      }
    });

    // Drag start
    cardEl.addEventListener('dragstart', (e: Event) => {
      const de = e as DragEvent;
      if (de.dataTransfer) {
        de.dataTransfer.setData('text/plain', card.id);
        de.dataTransfer.effectAllowed = 'move';
      }
    });

    cardElements.push(cardEl);
    cardsRow.appendChild(cardEl);
  });

  container.appendChild(cardsRow);

  // Draft Form
  const form = el('form', { id: 'draft-form' });

  // Fieldset keeping stable IDs #keep-card-0 and #keep-card-1
  const fieldset = el('fieldset', { class: 'sr-only' }, [
    el('legend', {}, ['保留卡片選項']),
    ...ownCards.map((card, idx) =>
      el('input', {
        type: 'radio',
        id: `keep-card-${idx}`,
        name: 'keepCardId',
        value: card.id,
        checked: idx === selectedKeepIndex,
      })
    ),
  ]);
  form.appendChild(fieldset);

  if (!isFinalPlayer) {
    const unservedPlayers = projection.players.filter(
      (p) => !projection.servedPlayerIds.includes(p.playerId) && p.playerId !== projection.viewerId
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

    const selectEl = recipientGroup.querySelector('#recipient-select') as HTMLSelectElement;
    if (selectEl && onTargetChanged) {
      selectEl.addEventListener('change', () => {
        onTargetChanged(selectEl.value);
      });
      // Initial target notify
      if (unservedPlayers.length > 0) {
        onTargetChanged(unservedPlayers[0].playerId);
      }
    }

    const testimonyGroup = el('div', { class: 'form-group' }, [
      el('label', { for: 'testimony-select' }, ['公開聲稱傳遞的角色（可誠實亦可說謊）']),
      el('select', { id: 'testimony-select' }, [
        el('option', { value: '' }, ['（不特別聲明）']),
        ...projection.publicRoleRoster.map((r) =>
          el('option', { value: r }, [ROLES[r]?.label || r])
        ),
      ]),
    ]);

    const transferBox = el('div', { class: 'transfer-box' }, [
      el('span', { class: 'transfer-status' }, ['點擊選取卡片保留，或拖曳卡片至目標玩家席位']),
    ]);

    form.appendChild(recipientGroup);
    form.appendChild(testimonyGroup);
    form.appendChild(transferBox);
  } else {
    form.appendChild(
      el('div', { class: 'alert alert-warning' }, [
        '您是最後一位選牌玩家，剩餘的一張卡片將秘密扣置於【客房】中。',
      ])
    );
  }

  const submitBtn = el(
    'button',
    { id: 'btn-confirm-pass', type: 'submit', class: 'primary-button btn-block' },
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
      if (!passToPlayerId) {
        showInlineAlert(container, '請選擇傳遞對象。');
        return;
      }
      const testimonySelect = form.querySelector('#testimony-select') as HTMLSelectElement;
      if (testimonySelect?.value) {
        testimonyRole = testimonySelect.value as RoleId;
      }
    }

    audioManager.playCue('card_pass');
    client.dispatchAction({
      type: 'choose_and_pass',
      keepCardId,
      passToPlayerId,
      testimonyRole,
    });
  });

  container.appendChild(form);
}
