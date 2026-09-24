/**
 * Reusable card and native dialog primitives shared by active play and results.
 *
 * Privacy rule: face content is rendered only from viewer-safe data. Opponent
 * backs and pre-reveal result backs carry an accessible name and nothing else —
 * no role, label, card ID, title, or drag payload.
 */

import { FACTIONS, ROLES, ROLE_DETAILS } from '../../shared/rules.ts';
import type { Card, RoleId } from '../../shared/rules.ts';
import { el } from '../ui/dom.ts';

export const CARD_BACK_LABEL = '玩家的隱藏卡牌';

export interface OwnCardOptions {
  readonly kicker?: string;
  readonly actionHint?: string;
  readonly selected?: boolean;
  /** False for cards that may not be passed (detail opens without `#btn-pass-card`). */
  readonly passable?: boolean;
}

export interface CardDetailWiringOptions {
  /** When false, only `[data-action="view-card"]` triggers open the dialog. */
  readonly activateCards?: boolean;
  readonly onPassCard?: (cardId: string) => void;
}

interface CardDetailWiring {
  readonly dialog: HTMLDialogElement;
  readonly onClick: (event: Event) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly onClose: () => void;
}

const wirings = new WeakMap<HTMLElement, CardDetailWiring>();

function isRoleId(value: string): value is RoleId {
  return Object.hasOwn(ROLES, value);
}

function createCardBack(owner: 'opponent' | 'hidden' | null): HTMLDivElement {
  const back = el('div', { class: 'card-back', role: 'img', 'aria-label': CARD_BACK_LABEL });
  if (owner) back.setAttribute('data-owner', owner);
  return back;
}

/** Generic opponent back: accessible name only, never a drag source. */
export function renderOpponentBack(): HTMLDivElement {
  return createCardBack('opponent');
}

/** Two-sided result card; the front exists only because resolution data exists. */
export function renderResultCard(role: RoleId): HTMLDivElement {
  const roleDef = ROLES[role];
  return el('div', { class: 'result-card' }, [
    createCardBack('hidden'),
    el('div', { class: 'card-face', 'data-hand': 'result' }, [
      el('span', { class: 'card-kicker' }, ['結果']),
      el('span', { class: 'card-role' }, [roleDef.label]),
      el('span', { class: 'card-action' }, [FACTIONS[roleDef.faction].label]),
    ]),
  ]);
}

function renderDetailTrigger(card: Card, passable: boolean): HTMLButtonElement {
  return el(
    'button',
    {
      type: 'button',
      class: 'card-detail-trigger',
      'data-action': 'view-card',
      'data-card-id': card.id,
      'data-card-role': card.role,
      'data-passable': passable ? 'true' : 'false',
      'aria-label': `查看手牌詳情：${card.label}`,
    },
    ['查看詳情']
  );
}

/** Viewer's own face-up card. Its role text comes from the card the viewer holds. */
export function renderOwnCard(card: Card, options: OwnCardOptions = {}): HTMLDivElement {
  const selected = options.selected === true;
  const passable = options.passable !== false;
  return el(
    'div',
    {
      class: `card-face${selected ? ' is-selected' : ''}`,
      'data-hand': 'viewer',
      'data-card-id': card.id,
      'data-card-role': card.role,
      'data-passable': passable ? 'true' : 'false',
      tabindex: '0',
    },
    [
      el('span', { class: 'card-kicker' }, [options.kicker ?? '手牌']),
      el('span', { class: 'card-role' }, [card.label]),
      el('span', { class: 'card-action' }, [options.actionHint ?? '按 Enter 查看詳情']),
      renderDetailTrigger(card, passable),
    ]
  );
}

/** Empty card-detail shell; `wireCardDetail` fills it from ROLES/FACTIONS/ROLE_DETAILS. */
export function renderCardDetailDialog(): HTMLDialogElement {
  return el(
    'dialog',
    { id: 'card-detail-dialog', class: 'card-detail', 'aria-labelledby': 'card-detail-title' },
    [
      el('h3', { id: 'card-detail-title', tabindex: '-1' }),
      el('p', { class: 'card-detail-faction' }),
      el('dl', { class: 'card-detail-list' }, [
        el('dt', {}, ['目標']),
        el('dd', {}),
        el('dt', {}, ['能力']),
        el('dd', {}),
      ]),
      el('div', { class: 'btn-group' }, [
        el(
          'button',
          { type: 'button', class: 'secondary-button', id: 'btn-close-card-detail' },
          ['關閉']
        ),
        el('button', { type: 'button', class: 'primary-button', id: 'btn-pass-card' }, ['傳遞此卡']),
      ]),
    ]
  );
}

function fillCardDetail(dialog: HTMLDialogElement, roleId: RoleId, passable: boolean): void {
  const role = ROLES[roleId];
  const detail = ROLE_DETAILS[roleId];
  const title = dialog.querySelector('#card-detail-title');
  const faction = dialog.querySelector('.card-detail-faction');
  const definitions = dialog.querySelectorAll('.card-detail-list dd');
  const objective = definitions.item(0);
  const ability = definitions.item(1);
  const passButton = dialog.querySelector('#btn-pass-card');
  if (title) title.textContent = role.label;
  if (faction) faction.textContent = `陣營：${FACTIONS[role.faction].label}`;
  if (objective) objective.textContent = detail.objective;
  if (ability) ability.textContent = detail.ability;
  if (passButton instanceof HTMLButtonElement) passButton.hidden = !passable;
}

/**
 * Wires card details for `root` (idempotent: rewiring re-targets the current dialog):
 * own cards open on click or Enter/Space, `[data-action="view-card"]` triggers open on
 * click, `#btn-close-card-detail` and Escape close with focus returning to the trigger,
 * and `#btn-pass-card` exists only for passable cards and invokes `onPassCard`.
 */
export function wireCardDetail(root: HTMLElement, options: CardDetailWiringOptions = {}): void {
  const previous = wirings.get(root);
  if (previous) {
    root.removeEventListener('click', previous.onClick);
    root.removeEventListener('keydown', previous.onKeyDown);
    previous.dialog.removeEventListener('close', previous.onClose);
    wirings.delete(root);
  }

  const dialog = root.querySelector('#card-detail-dialog');
  if (!(dialog instanceof HTMLDialogElement)) return;

  const activateCards = options.activateCards !== false;
  let lastTrigger: HTMLElement | null = null;

  const activate = (trigger: HTMLElement): void => {
    const roleId = trigger.dataset.cardRole;
    if (roleId === undefined || !isRoleId(roleId)) return;
    lastTrigger = trigger;
    fillCardDetail(dialog, roleId, trigger.dataset.passable !== 'false');
    if (!dialog.open) dialog.showModal();
    const title = dialog.querySelector('#card-detail-title');
    if (title instanceof HTMLElement) title.focus();
  };

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest<HTMLElement>('[data-action="view-card"]');
    if (trigger) {
      activate(trigger);
      return;
    }
    if (target.closest('#btn-close-card-detail')) {
      dialog.close();
      return;
    }
    if (target.closest('#btn-pass-card')) {
      const cardId = lastTrigger?.dataset.cardId;
      // Passing hands off to the claim step, so focus does not return to the card.
      lastTrigger = null;
      dialog.close();
      if (cardId !== undefined) options.onPassCard?.(cardId);
      return;
    }
    if (!activateCards) return;
    const card = target.closest<HTMLElement>('.card-face[data-hand="viewer"][data-card-id]');
    if (card) activate(card);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button')) return;
    const card = target.closest<HTMLElement>('.card-face[data-hand="viewer"][data-card-id]');
    if (!card) return;
    event.preventDefault();
    activate(card);
  };

  const onClose = (): void => {
    const trigger = lastTrigger;
    lastTrigger = null;
    if (!trigger) return;
    // Native closing already restores focus; only step in when focus would be lost.
    const active = document.activeElement;
    if (active === null || active === document.body || dialog.contains(active)) {
      trigger.focus();
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  dialog.addEventListener('close', onClose);
  wirings.set(root, { dialog, onClick, onKeyDown, onClose });
}
