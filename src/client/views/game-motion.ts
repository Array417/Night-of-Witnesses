import { el } from '../ui/dom.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { roleArt } from './card-art.ts';
import { renderOpponentBack } from './game-cards.ts';

/** Face data arrives only in the sender/recipient's private projection. */
export function renderCardMotion(stage: HTMLElement, projection: PlayerProjection): void {
  const motion = projection.cardMotion;
  if (!motion) return;
  const face = motion.card
    ? el('div', { class: 'card-motion-face' }, [roleArt(motion.card.role), el('span', { class: 'card-role' }, [motion.card.label])])
    : renderOpponentBack();
  const moving = el('div', {
    class: 'card-motion', 'data-kind': motion.kind, 'data-face': motion.card ? 'front' : 'back',
    'aria-label': motion.kind === 'draw' ? '抽牌中' : '傳牌中',
  }, [face]);
  stage.appendChild(moving);
  requestAnimationFrame(() => {
    if (!stage.isConnected) return;
    const seat = (id: string | null): Element | null => {
      if (id === projection.viewerId) return stage.querySelector('.hand-slot');
      return [...stage.querySelectorAll<HTMLElement>('.seat')].find(element => element.dataset.playerId === id) ?? null;
    };
    const source = motion.kind === 'draw' ? stage.querySelector('#draw-pile') : seat(motion.fromPlayerId);
    const target = motion.toPlayerId ? seat(motion.toPlayerId) : stage.querySelector('.table-ring');
    if (!source || !target) return;
    const stageRect = stage.getBoundingClientRect();
    const center = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - stageRect.left - 40, y: rect.top + rect.height / 2 - stageRect.top - 56 };
    };
    const from = center(source);
    const to = center(target);
    moving.style.left = `${to.x}px`;
    moving.style.top = `${to.y}px`;
    const duration = Math.max(1, motion.endsAt - motion.startedAt);
    const elapsed = Math.max(0, Math.min(duration, (projection.serverTime ?? motion.startedAt) - motion.startedAt));
    const animation = moving.animate([
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) rotate(-8deg)` },
      { transform: 'translate(0, 0) rotate(0)' },
    ], { duration, fill: 'both', easing: 'ease-in-out' });
    animation.currentTime = elapsed;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) animation.finish();
  });
}
