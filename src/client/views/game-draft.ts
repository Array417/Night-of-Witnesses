/**
 * Draft-phase transfer coordinator.
 *
 * One closure owns exactly `passedCardId`, `targetId`, and
 * `dialogState: idle | confirming | pending`. The transition table is:
 * - `idle → confirming` after a valid card + target (drag, dialog fallback, keyboard);
 * - `confirming → idle` on cancel/Escape (clears card, target, highlights, pending controls,
 *   and returns focus to the initiating card);
 * - `confirming → pending` on an accepted local dispatch (confirm disabled, `aria-busy`);
 * - `pending → idle` on the next projection or a server error (the view rerenders, or the
 *   error handler resets this closure);
 * - a synchronous `dispatchAction() === false` resets straight to `idle` with a focused alert.
 *
 * Every path converges on `beginConfirmation(cardId, targetId)` and never submits twice.
 * Escape and `#btn-cancel-pass` are the only dismissal paths and both reset explicitly; the
 * dialog's `close` event is deliberately not observed because it is queued and can arrive
 * after a newer confirmation has already started (a real race this module must not have).
 */
import { el, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { ROLES, type RoleId } from '../../shared/rules.ts';
import { audioManager } from '../audio/manager.ts';
import { renderCardDetailDialog, wireCardDetail } from './game-cards.ts';
import { renderClaimDialog } from './game-claim-dialog.ts';

const GUEST_ROOM_TARGET_ID = 'guest-room';

const IDLE_STATUS = '請點擊卡片查看詳情，或拖曳卡片至目標玩家席位。';

type DialogState = 'idle' | 'confirming' | 'pending';

export interface DraftCoordinator {
  /** Eligible-seat activation; stores a target chosen before the card, else confirms. */
  readonly onSelectRecipient: (playerId: string) => void;
  /** Validated own-card drop from the table. */
  readonly onDropCard: (playerId: string, cardId: string) => void;
  /** Final-actor Guest Room activation. */
  readonly onSelectGuestRoom: () => void;
  /** Coarse-pointer own-card tap: selects the card, or replaces the current selection. */
  readonly onSelectCard: (cardId: string) => void;
}

/** Non-actor or cards-not-yet-dealt panel content. */
export function renderDraftWaiting(panel: HTMLElement, projection: PlayerProjection): void {
  if (projection.currentActorId === projection.viewerId) {
    panel.appendChild(
      el('div', { id: 'draft-waiting', class: 'alert alert-warning' }, ['正在等待手牌發送...'])
    );
    return;
  }
  const currentActorName =
    projection.players.find((p) => p.playerId === projection.currentActorId)?.playerName || '未知';
  panel.appendChild(
    el('div', { id: 'draft-waiting', class: 'alert alert-warning' }, [
      `等待 【${currentActorName}】 選擇並傳遞卡片中...`,
    ])
  );
}

export interface DraftCoordinatorOptions {
  /** Game container that hosts the dialogs and delegated card-detail wiring. */
  readonly root: HTMLElement;
  /** Phase action panel that shows status and dispatch failures. */
  readonly panel: HTMLElement;
  readonly projection: PlayerProjection;
  readonly client: GameClient;
  /**
   * Coarse-pointer mode: card taps select/replace instead of opening the detail dialog.
   * The detail trigger stays the only tap path to card details.
   */
  readonly tapSelect: boolean;
}

export function createDraftCoordinator(options: DraftCoordinatorOptions): DraftCoordinator {
  const { root, panel, projection, client, tapSelect } = options;
  const ownCards = projection.ownCards ?? [];
  const isFinalPlayer = projection.servedPlayerIds.length === projection.players.length;
  const eligibleTargetIds = new Set(
    projection.players
      .filter(
        (player) =>
          player.playerId !== projection.viewerId &&
          player.connected &&
          !projection.servedPlayerIds.includes(player.playerId)
      )
      .map((player) => player.playerId)
  );

  let passedCardId: string | null = null;
  let targetId: string | null = null;
  let dialogState: DialogState = 'idle';

  const status = el(
    'p',
    { id: 'transfer-status', class: 'transfer-status', role: 'status', 'aria-live': 'polite' },
    [IDLE_STATUS]
  );
  const {
    dialog: claimDialog,
    summary: claimSummary,
    select: claimSelect,
    confirmButton,
    cancelButton,
  } = renderClaimDialog(projection.publicRoleRoster);
  const detailDialog = renderCardDetailDialog();
  root.appendChild(detailDialog);
  root.appendChild(claimDialog);

  function findOwnCard(cardId: string | null): HTMLElement | null {
    if (cardId === null) return null;
    for (const card of root.querySelectorAll<HTMLElement>(
      '.card-face[data-hand="viewer"][data-card-id]'
    )) {
      if (card.dataset.cardId === cardId) return card;
    }
    return null;
  }

  function otherOwnCardId(cardId: string): string | null {
    return ownCards.find((card) => card.id !== cardId)?.id ?? null;
  }

  function targetName(id: string): string {
    if (id === GUEST_ROOM_TARGET_ID) return '【客房】';
    const player = projection.players.find((p) => p.playerId === id);
    return `【${player?.playerName ?? '未知'}】`;
  }

  function isValidTarget(id: string): boolean {
    return isFinalPlayer ? id === GUEST_ROOM_TARGET_ID : eligibleTargetIds.has(id);
  }

  function syncHighlights(): void {
    for (const seat of root.querySelectorAll<HTMLElement>('.table-panel .seat[data-player-id]')) {
      seat.classList.toggle('is-targeted', targetId !== null && seat.dataset.playerId === targetId);
    }
    const guestRoom = root.querySelector<HTMLElement>('.table-panel [data-target-id="guest-room"]');
    guestRoom?.classList.toggle('is-targeted', targetId === GUEST_ROOM_TARGET_ID);
    for (const card of root.querySelectorAll<HTMLElement>(
      '.table-panel .hand-slot .card-face[data-hand="viewer"][data-card-id]'
    )) {
      card.classList.toggle(
        'is-selected',
        passedCardId !== null && card.dataset.cardId === passedCardId
      );
    }
  }

  function setStatus(message: string): void {
    status.textContent = message;
  }

  function clearPendingControls(): void {
    claimDialog.dataset.state = 'idle';
    confirmButton.dataset.state = 'idle';
    confirmButton.disabled = false;
    confirmButton.removeAttribute('aria-busy');
    confirmButton.textContent = '確認傳遞';
    claimSelect.value = '';
  }

  function resetToIdle(statusMessage: string): void {
    passedCardId = null;
    targetId = null;
    dialogState = 'idle';
    clearPendingControls();
    syncHighlights();
    setStatus(statusMessage);
  }

  function focusInitiatingCard(cardId: string | null): void {
    findOwnCard(cardId)?.focus();
  }

  function focusFirstTarget(): void {
    const target =
      root.querySelector<HTMLButtonElement>('.table-panel .seats button.seat-target') ??
      root.querySelector<HTMLButtonElement>('.table-panel [data-target-id="guest-room"]');
    target?.focus();
  }

  function cancelConfirmation(): void {
    if (dialogState === 'idle') return;
    const cardId = passedCardId;
    if (claimDialog.open) claimDialog.close();
    resetToIdle(IDLE_STATUS);
    focusInitiatingCard(cardId);
  }

  function beginConfirmation(cardId: string, nextTargetId: string): void {
    if (dialogState !== 'idle') return;
    const card = ownCards.find((candidate) => candidate.id === cardId);
    if (!card || !isValidTarget(nextTargetId)) return;
    passedCardId = cardId;
    targetId = nextTargetId;
    dialogState = 'confirming';
    syncHighlights();
    setStatus(`請選擇公開宣稱，然後按「確認傳遞」將${card.label}傳給${targetName(nextTargetId)}。`);
    claimSummary.textContent = `將「${card.label}」傳遞給${targetName(nextTargetId)}。`;
    claimDialog.dataset.state = 'confirming';
    if (!claimDialog.open) claimDialog.showModal();
    claimSelect.focus();
  }

  /** `#btn-pass-card` hand-off: arm the card, then wait for (or reuse) a target. */
  function chooseCard(cardId: string): void {
    if (dialogState !== 'idle') return;
    if (!ownCards.some((candidate) => candidate.id === cardId)) return;
    passedCardId = cardId;
    audioManager.playCue('card_select');
    syncHighlights();
    if (targetId !== null && isValidTarget(targetId)) {
      beginConfirmation(cardId, targetId);
      return;
    }
    setStatus(
      isFinalPlayer
        ? '已選擇要傳遞的卡片，請點擊桌面中央的【客房】。'
        : '已選擇要傳遞的卡片，請選擇目標玩家。'
    );
    focusFirstTarget();
  }

  function selectTarget(playerId: string): void {
    if (dialogState !== 'idle' || !isValidTarget(playerId)) return;
    if (passedCardId !== null) {
      beginConfirmation(passedCardId, playerId);
      return;
    }
    targetId = playerId;
    syncHighlights();
    setStatus(`已選擇${targetName(playerId)}，請點擊卡片後按「傳遞此卡」。`);
  }

  function selectGuestRoom(): void {
    if (dialogState !== 'idle' || !isFinalPlayer) return;
    if (passedCardId !== null) {
      beginConfirmation(passedCardId, GUEST_ROOM_TARGET_ID);
      return;
    }
    targetId = GUEST_ROOM_TARGET_ID;
    syncHighlights();
    setStatus('已選擇【客房】，請點擊卡片後按「傳遞此卡」。');
  }

  function confirm(): void {
    if (dialogState !== 'confirming') return;
    if (passedCardId === null || targetId === null) return;
    const keepCardId = otherOwnCardId(passedCardId);
    if (keepCardId === null) return;
    const testimonyValue = claimSelect.value;
    const testimonyRole =
      testimonyValue !== '' && Object.hasOwn(ROLES, testimonyValue)
        ? (testimonyValue as RoleId)
        : undefined;

    dialogState = 'pending';
    claimDialog.dataset.state = 'pending';
    confirmButton.dataset.state = 'pending';
    confirmButton.disabled = true;
    confirmButton.setAttribute('aria-busy', 'true');
    confirmButton.textContent = '傳遞中…';
    setStatus('傳遞中，請稍候…');
    audioManager.playCue('card_pass');

    const accepted = client.dispatchAction({
      type: 'choose_and_pass',
      keepCardId,
      passToPlayerId: isFinalPlayer ? undefined : targetId,
      testimonyRole,
    });

    if (!accepted) {
      if (claimDialog.open) claimDialog.close();
      resetToIdle(IDLE_STATUS);
      showInlineAlert(panel, '傳遞失敗：連線中斷或已有動作正在處理，請重新選擇後再試。');
    }
  }

  cancelButton.addEventListener('click', cancelConfirmation);
  confirmButton.addEventListener('click', confirm);
  claimDialog.addEventListener('cancel', cancelConfirmation);

  panel.appendChild(
    el('div', { id: 'draft-controls' }, [
      el('h2', {}, ['輪到您的回合：抽牌與傳遞']),
      el('p', { class: 'label-hint', style: 'margin-bottom: 16px;' }, [
        '點擊卡片查看詳情後按「傳遞此卡」，或直接拖曳卡片至目標玩家席位；確認公開宣稱後才會送出。',
      ]),
      status,
    ])
  );

  wireCardDetail(root, { onPassCard: chooseCard, activateCards: !tapSelect });

  return {
    onSelectRecipient: selectTarget,
    onDropCard: (playerId, cardId) => beginConfirmation(cardId, playerId),
    onSelectGuestRoom: selectGuestRoom,
    onSelectCard: chooseCard,
  };
}
