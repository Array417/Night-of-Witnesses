/**
 * Mandatory draft claim dialog markup: 「不特別聲明」 plus every role in the
 * viewer's `publicRoleRoster`, an explicit `#btn-confirm-pass`, and
 * `#btn-cancel-pass`. Selecting an option never submits; only the confirm
 * button reaches the transfer coordinator.
 */
import { el } from '../ui/dom.ts';
import { ROLES, type RoleId } from '../../shared/rules.ts';

export interface ClaimDialogRefs {
  readonly dialog: HTMLDialogElement;
  readonly summary: HTMLParagraphElement;
  readonly select: HTMLSelectElement;
  readonly confirmButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
}

export function renderClaimDialog(publicRoleRoster: readonly RoleId[]): ClaimDialogRefs {
  const summary = el('p', { id: 'claim-transfer-summary' });
  const select = el('select', { id: 'claim-role-select' }, [
    el('option', { value: '' }, ['不特別聲明']),
    ...publicRoleRoster.map((roleId) =>
      el('option', { value: roleId }, [ROLES[roleId]?.label || roleId])
    ),
  ]);
  const cancelButton = el(
    'button',
    { type: 'button', class: 'secondary-button', id: 'btn-cancel-pass' },
    ['取消']
  );
  const confirmButton = el(
    'button',
    { type: 'button', class: 'primary-button', id: 'btn-confirm-pass', 'data-state': 'idle' },
    ['確認傳遞']
  );
  const dialog = el(
    'dialog',
    {
      id: 'claim-dialog',
      class: 'claim-dialog',
      'data-state': 'idle',
      'aria-labelledby': 'claim-dialog-title',
    },
    [
      el('h3', { id: 'claim-dialog-title' }, ['確認傳遞']),
      summary,
      el('div', { class: 'form-group' }, [
        el('label', { for: 'claim-role-select' }, ['公開聲稱傳遞的角色（可誠實亦可說謊）']),
        select,
      ]),
      el('div', { class: 'btn-group' }, [cancelButton, confirmButton]),
    ]
  );
  return { dialog, summary, select, confirmButton, cancelButton };
}
