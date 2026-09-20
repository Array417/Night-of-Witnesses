/**
 * Shared active-game table component with dimensional oval and 3-6 dynamic seats.
 */
import { el } from '../ui/dom.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { PLAYER_LOCATIONS } from '../../shared/rules.ts';

export interface GameTableOptions {
  projection: PlayerProjection;
  selectedRecipientId?: string;
  onSelectRecipient?: (playerId: string) => void;
}

export function renderGameTable(options: GameTableOptions): HTMLElement {
  const { projection, selectedRecipientId, onSelectRecipient } = options;

  const tablePanel = el('div', { class: 'panel table-panel' }, [
    el('header', { class: 'table-heading', style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' }, [
      el('h2', { style: 'font-size: 1.25rem; margin-bottom: 0;' }, ['證人圓桌']),
      el('span', { class: 'label-hint' }, [`共 ${projection.players.length} 位在場`]),
    ]),
  ]);

  const stage = el('div', { class: 'table-stage' }, [
    el('div', { class: 'table-oval' }),
  ]);

  const seatsContainer = el('div', {
    class: 'seats',
    style: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; width: 100%;',
  });

  projection.players.forEach((p, idx) => {
    const isViewer = p.playerId === projection.viewerId;
    const isActive = p.playerId === projection.currentActorId;
    const isOffline = !p.connected;
    const isServed = projection.servedPlayerIds.includes(p.playerId);
    const isTargeted = p.playerId === selectedRecipientId;

    const classNames = ['seat'];
    if (isActive) classNames.push('is-active');
    if (isOffline) classNames.push('is-offline');
    if (isServed) classNames.push('is-served');
    if (isTargeted) classNames.push('is-targeted');

    let stateText = '在座';
    if (isActive) stateText = '當前回合 (行動中)';
    else if (isServed) stateText = '已拿牌 (完成)';
    else if (isOffline) stateText = '斷線中';
    else stateText = '等待中';

    const locationLabel = p.locationId ? PLAYER_LOCATIONS[p.locationId]?.label || '未知地點' : '未分配';

    // Check if player has public testimony claim
    const latestTestimony = [...projection.testimonyTrail].reverse().find((t) => t.fromPlayerId === p.playerId);

    const seatChildren: (Node | string)[] = [
      el('span', { class: 'seat-name' }, [p.playerName + (isViewer ? ' (我)' : '')]),
      el('span', { class: 'seat-location' }, [locationLabel]),
      el('span', { class: 'seat-state' }, [stateText]),
    ];

    if (latestTestimony?.testimonyRole) {
      seatChildren.push(
        el('span', { class: 'claim-badge' }, [`聲稱：${latestTestimony.testimonyRole}`])
      );
    }

    const seatAttrs: Record<string, string> = {
      class: classNames.join(' '),
      tabindex: '0',
      'data-seat': String(idx + 1),
      'data-player-id': p.playerId,
      'aria-label': `${p.playerName}，地點：${locationLabel}，狀態：${stateText}`,
    };
    if (isViewer) {
      seatAttrs['aria-current'] = 'true';
    }

    const seat = el('div', seatAttrs, seatChildren);

    // Interaction: Clicking a seat selects them as pass recipient if unserved and not self
    if (!isViewer && !isServed && onSelectRecipient) {
      seat.style.cursor = 'pointer';
      seat.addEventListener('click', () => {
        onSelectRecipient(p.playerId);
      });
      seat.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          onSelectRecipient(p.playerId);
        }
      });

      // Desktop Drag & Drop drop target
      seat.addEventListener('dragover', (e: Event) => {
        const de = e as DragEvent;
        de.preventDefault();
        seat.classList.add('is-drop-ready');
      });
      seat.addEventListener('dragleave', () => {
        seat.classList.remove('is-drop-ready');
      });
      seat.addEventListener('drop', (e: Event) => {
        const de = e as DragEvent;
        de.preventDefault();
        seat.classList.remove('is-drop-ready');
        onSelectRecipient(p.playerId);
      });
    }

    seatsContainer.appendChild(seat);
  });

  stage.appendChild(seatsContainer);
  tablePanel.appendChild(stage);
  return tablePanel;
}
