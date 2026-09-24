/**
 * Tavern Design System: Primitive Showcase Module
 * Renders every reusable primitive and its interactive/responsive states.
 */

import './showcase.css';
import { renderShowcaseMarkup } from './markup.ts';
import { wireCardDetail } from '../views/game-cards.ts';

export function renderShowcase(container: HTMLElement): void {
  container.innerHTML = renderShowcaseMarkup();
  wireGameMenu(container);
  wireCardDetail(container);
  wireShowcaseDialog(container);
  wireClaimDialog(container);
  wireResultReveal(container);
}

function wireGameMenu(container: HTMLElement): void {
  const menu = container.querySelector('#game-menu');
  const toggle = container.querySelector('#btn-toggle-game-menu');
  if (!(menu instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return;

  toggle.addEventListener('click', () => {
    const collapsed = menu.dataset.state !== 'collapsed';
    menu.dataset.state = collapsed ? 'collapsed' : 'expanded';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
}

/** Generic native dialog demo: open by button, close on cancel/confirm or Escape, restore focus. */
function wireShowcaseDialog(container: HTMLElement): void {
  const trigger = container.querySelector('#btn-open-showcase-dialog');
  const dialog = container.querySelector('#showcase-dialog');
  if (!(trigger instanceof HTMLButtonElement) || !(dialog instanceof HTMLDialogElement)) return;

  trigger.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', () => trigger.focus());

  for (const selector of ['#btn-dialog-cancel', '#btn-dialog-confirm']) {
    const button = container.querySelector(selector);
    if (button instanceof HTMLButtonElement) {
      button.addEventListener('click', () => dialog.close());
    }
  }
}

function wireClaimDialog(container: HTMLElement): void {
  const dialog = container.querySelector('#claim-dialog');
  const trigger = container.querySelector('#btn-open-claim-dialog');
  const confirm = container.querySelector('#btn-confirm-pass');
  const cancel = container.querySelector('#btn-cancel-pass');
  if (!(dialog instanceof HTMLDialogElement)) return;

  const reset = (): void => {
    dialog.dataset.state = 'idle';
    if (confirm instanceof HTMLButtonElement) {
      confirm.dataset.state = 'idle';
      confirm.disabled = false;
      confirm.removeAttribute('aria-busy');
      confirm.textContent = '確認傳遞';
    }
  };

  if (trigger instanceof HTMLButtonElement) {
    trigger.addEventListener('click', () => {
      reset();
      dialog.showModal();
    });
  }

  if (confirm instanceof HTMLButtonElement) {
    confirm.addEventListener('click', () => {
      dialog.dataset.state = 'pending';
      confirm.dataset.state = 'pending';
      confirm.disabled = true;
      confirm.setAttribute('aria-busy', 'true');
      confirm.textContent = '傳遞中…';
    });
  }

  if (cancel instanceof HTMLButtonElement) {
    cancel.addEventListener('click', () => dialog.close());
  }

  dialog.addEventListener('close', () => {
    reset();
    if (trigger instanceof HTMLButtonElement) trigger.focus();
  });
}

function wireResultReveal(container: HTMLElement): void {
  const table = container.querySelector('#showcase-result-table');
  const button = container.querySelector('#btn-showcase-reveal');
  if (!(table instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return;

  button.addEventListener('click', () => {
    const revealed = table.classList.toggle('is-revealed');
    table.dataset.revealState = revealed ? 'post' : 'pre';
  });
}
