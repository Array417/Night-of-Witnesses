/**
 * Shared active-game table: the canonical clockwise ring from `getTableSeats`,
 * one generic back per opponent, the viewer's hand slot, the action dock, and a
 * final-actor-only Guest Room target at the table centre.
 *
 * Selection state stays with the caller. This module renders state and, for
 * eligible seats, forwards activation and drops — a drop fires only after the
 * drag payload matches one of the viewer's own card ids.
 */
import { el } from '../ui/dom.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { PLAYER_LOCATIONS, ROLES } from '../../shared/rules.ts';
import { getTableSeats } from './game-seating.ts';
import { renderOpponentBack, renderOwnCard } from './game-cards.ts';

export interface GameTableOptions {
  projection: PlayerProjection;
  /** Eligible-seat activation by click, Enter, or Space. */
  onSelectRecipient?: (playerId: string) => void;
  /** Own-card drop; receives both ids only when the dragged id is the viewer's own card. */
  onDropCard?: (playerId: string, cardId: string) => void;
  /** Final-actor Guest Room activation. */
  onSelectGuestRoom?: () => void;
  /** Phase controls (discussion/voting) rendered by the shell into the dock. */
  renderPhaseActions?: (host: HTMLElement) => void;
}

const PHASE_LABELS: Record<string, string> = {
  draft: '抽牌傳遞階段',
  discussion: '自由討論階段',
  voting: '投票指認階段',
};

function seatStateText(isActive: boolean, isServed: boolean, isOffline: boolean): string {
  if (isActive) return '行動中';
  if (isServed) return '已拿牌';
  if (isOffline) return '斷線中';
  return '等待中';
}

export function renderGameTable(options: GameTableOptions): HTMLElement {
  const { projection, onSelectRecipient, onDropCard, onSelectGuestRoom, renderPhaseActions } =
    options;
  const isViewerActor = projection.currentActorId === projection.viewerId;
  const isFinalActor =
    isViewerActor && projection.servedPlayerIds.length === projection.players.length;
  const ownCardIds = new Set((projection.ownCards ?? []).map((card) => card.id));
  const hasTargetCallbacks = onSelectRecipient !== undefined || onDropCard !== undefined;

  const tablePanel = el('div', { class: 'panel table-panel' }, [
    el(
      'header',
      {
        class: 'table-heading',
        style:
          'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;',
      },
      [
        el('h2', { style: 'font-size: 1.25rem; margin-bottom: 0;' }, ['證人圓桌']),
        el('span', { class: 'label-hint' }, [`共 ${projection.players.length} 位在場`]),
      ]
    ),
  ]);

  const seatsContainer = el('div', { class: 'seats' });
  const seats = getTableSeats(projection.players, projection.viewerId);

  projection.players.forEach((player, index) => {
    const seatPosition = seats[index];
    const isViewer = player.playerId === projection.viewerId;
    const isActive = player.playerId === projection.currentActorId;
    const isOffline = !player.connected;
    const isServed = projection.servedPlayerIds.includes(player.playerId);
    const canTarget =
      hasTargetCallbacks && isViewerActor && !isFinalActor && !isViewer && !isServed && !isOffline;

    const classNames = ['seat'];
    if (isActive) classNames.push('is-active');
    if (isOffline) classNames.push('is-offline');
    if (isServed) classNames.push('is-served');

    const stateText = seatStateText(isActive, isServed, isOffline);
    const locationLabel = player.locationId
      ? PLAYER_LOCATIONS[player.locationId]?.label || '未知地點'
      : '未分配';
    const latestTestimony = [...projection.testimonyTrail]
      .reverse()
      .find((entry) => entry.fromPlayerId === player.playerId);

    // Public claim only: render the zh-Hant label, never the raw role id. The
    // claim is part of the seat's accessible name; the badge's 聲稱： prefix is
    // decorative and may drop on seats too narrow for the whole badge
    // (styles.css), so the role itself is never truncated.
    const claimLabel = latestTestimony?.testimonyRole
      ? ROLES[latestTestimony.testimonyRole]?.label || latestTestimony.testimonyRole
      : null;
    const seatLabel = `${player.playerName}，地點：${locationLabel}，狀態：${stateText}`;

    const seatChildren: (Node | string)[] = [
      el('span', { class: 'seat-name' }, [player.playerName + (isViewer ? ' (我)' : '')]),
      el('span', { class: 'seat-location' }, [locationLabel]),
      el('span', { class: 'seat-state' }, [stateText]),
    ];
    if (claimLabel) {
      seatChildren.push(
        el('span', { class: 'claim-badge' }, [
          el('span', { class: 'claim-badge-prefix' }, ['聲稱：']),
          el('span', { class: 'claim-badge-role' }, [claimLabel]),
        ])
      );
    }
    if (!isViewer) {
      seatChildren.push(el('div', { class: 'seat-card' }, [renderOpponentBack()]));
    }

    let target: HTMLButtonElement | null = null;
    if (canTarget) {
      target = el('button', {
        type: 'button',
        class: 'seat-target',
        'aria-label': `選擇傳牌對象：${player.playerName}，地點：${locationLabel}，狀態：${stateText}`,
      });
      seatChildren.push(target);
    }

    const seatAttrs: Record<string, string> = {
      class: classNames.join(' '),
      'data-player-id': player.playerId,
      'data-relative-index': String(seatPosition.relativeIndex),
      style: `--seat-x: ${seatPosition.x}; --seat-y: ${seatPosition.y}`,
      'aria-label': claimLabel ? `${seatLabel}，聲稱：${claimLabel}` : seatLabel,
    };
    if (isViewer) seatAttrs['aria-current'] = 'true';

    const seat = el('div', seatAttrs, seatChildren);

    if (target && onSelectRecipient) {
      target.addEventListener('click', () => onSelectRecipient(player.playerId));
    }
    // Drag handlers live on the seat box so drops land exactly like clicks,
    // including on the opponent card that peeks below the seat edge.
    if (target && onDropCard) {
      seat.addEventListener('dragover', (event) => {
        const dragEvent = event as DragEvent;
        dragEvent.preventDefault();
        if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = 'move';
        seat.classList.add('is-drop-ready');
      });
      seat.addEventListener('dragleave', () => seat.classList.remove('is-drop-ready'));
      seat.addEventListener('drop', (event) => {
        const dragEvent = event as DragEvent;
        dragEvent.preventDefault();
        seat.classList.remove('is-drop-ready');
        const cardId = dragEvent.dataTransfer?.getData('text/plain') ?? '';
        if (cardId === '' || !ownCardIds.has(cardId)) return;
        onDropCard(player.playerId, cardId);
      });
    }

    seatsContainer.appendChild(seat);
  });

  const ringChildren: (Node | string)[] = [
    el('div', { class: 'table-oval', 'aria-hidden': 'true' }),
    seatsContainer,
  ];

  if (isFinalActor) {
    const guestRoom = el(
      'button',
      {
        type: 'button',
        class: 'guest-room-target',
        'data-target-id': 'guest-room',
        'aria-label': '客房：最終傳牌目標',
      },
      [
        el('span', { class: 'guest-room-name' }, ['客房']),
        el('span', { class: 'guest-room-hint' }, ['最終傳牌目標']),
      ]
    );
    if (onSelectGuestRoom) guestRoom.addEventListener('click', () => onSelectGuestRoom());
    ringChildren.push(guestRoom);
  }

  const stage = el('div', { class: 'table-stage' }, [
    el('div', { class: 'table-ring' }, ringChildren),
  ]);

  const ownCards = projection.ownCards ?? [];
  if (ownCards.length > 0) {
    const handSlot = el('div', { class: 'hand-slot', role: 'group', 'aria-label': '我的手牌' });
    ownCards.forEach((card, index) => {
      const cardElement = renderOwnCard(card, {
        kicker: `手牌 ${index + 1}`,
        actionHint: '點擊保留 / 拖曳傳遞',
      });
      cardElement.setAttribute('draggable', 'true');
      cardElement.addEventListener('dragstart', (event) => {
        const dragEvent = event as DragEvent;
        if (!dragEvent.dataTransfer) return;
        dragEvent.dataTransfer.setData('text/plain', card.id);
        dragEvent.dataTransfer.effectAllowed = 'move';
      });
      handSlot.appendChild(cardElement);
    });
    stage.appendChild(handSlot);
  }

  tablePanel.appendChild(stage);

  const dock = el('div', { class: 'table-action-dock', 'aria-label': '桌面操作列' });
  if (renderPhaseActions) {
    const phaseActions = el('div', { class: 'dock-phase-actions' });
    renderPhaseActions(phaseActions);
    if (phaseActions.childNodes.length > 0) dock.appendChild(phaseActions);
  }
  // Draft keeps a status indicator only; discussion/voting fill the dock with controls.
  if (dock.childNodes.length === 0) {
    const phaseLabel = PHASE_LABELS[projection.phase];
    if (phaseLabel) {
      dock.appendChild(el('span', { class: 'dock-status' }, [`目前階段：${phaseLabel}`]));
    }
  }
  tablePanel.appendChild(dock);

  return tablePanel;
}
