/**
 * Results reveal table: the canonical clockwise ring with one result card per
 * player and the optional Guest Room card at the table centre.
 *
 * Every card starts back-facing. The fronts are populated only from
 * `result.assignedRoles` / `result.guestRoomCard`, and the single table-level
 * `.is-revealed` class is added on the next animation frame so every card turns
 * over from the same style recalculation (no per-card timing or stagger).
 * Reduced motion is handled purely in CSS: the global override forces
 * `transform: none`, so the reveal becomes an instant opacity/visibility swap.
 */
import { el } from '../ui/dom.ts';
import type { GameResult, PlayerProjection } from '../../shared/state.ts';
import { PLAYER_LOCATIONS } from '../../shared/rules.ts';
import { getTableSeats } from './game-seating.ts';
import { renderResultCard } from './game-cards.ts';

export function renderResultsTable(projection: PlayerProjection, result: GameResult): HTMLElement {
  const ring = el('div', { class: 'table-ring results-reveal' });
  ring.appendChild(el('div', { class: 'table-oval', 'aria-hidden': 'true' }));

  const seatsLayer = el('div', { class: 'seats' });
  const seats = getTableSeats(projection.players, projection.viewerId);

  projection.players.forEach((player, index) => {
    const seatPosition = seats[index];
    const assignment = result.assignedRoles.find((entry) => entry.playerId === player.playerId);
    const isViewer = player.playerId === projection.viewerId;
    const locationLabel = assignment ? PLAYER_LOCATIONS[assignment.locationId].label : '未分配';

    const seatAttrs: Record<string, string> = {
      class: 'seat results-seat',
      'data-player-id': player.playerId,
      'data-relative-index': String(seatPosition.relativeIndex),
      // Cards hang away from the table centre: above the top-half seats, below the
      // rest, so no card can ever cover the Guest Room card at (x=50, y=50).
      'data-card-side': seatPosition.y < 50 ? 'above' : 'below',
      style: `--seat-x: ${seatPosition.x}; --seat-y: ${seatPosition.y}`,
      'aria-label': `${player.playerName}，地點：${locationLabel}`,
    };
    if (isViewer) seatAttrs['aria-current'] = 'true';
    const seatChildren: (Node | string)[] = [
      el('span', { class: 'seat-name' }, [player.playerName + (isViewer ? ' (我)' : '')]),
      el('span', { class: 'seat-location' }, [locationLabel]),
    ];
    if (assignment) {
      const card = renderResultCard(assignment.role);
      card.setAttribute('data-player-id', player.playerId);
      card.setAttribute('data-relative-index', String(seatPosition.relativeIndex));
      seatChildren.push(card);
    }
    seatsLayer.appendChild(el('div', seatAttrs, seatChildren));
  });

  ring.appendChild(seatsLayer);

  const guestRoomChildren: (Node | string)[] = [el('span', { class: 'guest-room-name' }, ['客房'])];
  if (result.guestRoomCard) {
    guestRoomChildren.push(renderResultCard(result.guestRoomCard.role));
  } else {
    guestRoomChildren.push(el('span', { class: 'guest-room-hint' }, ['無扣置卡牌']));
  }
  ring.appendChild(
    el(
      'div',
      { class: 'guest-room-target results-guest-room', 'data-target-id': 'guest-room' },
      guestRoomChildren
    )
  );

  requestAnimationFrame(() => {
    ring.classList.add('is-revealed');
  });

  return el('div', { class: 'table-stage results-stage' }, [ring]);
}
