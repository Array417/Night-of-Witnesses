import { el, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import { getRoomCodeFromUrl } from '../session.ts';

export function renderHome(
  container: HTMLElement,
  client: GameClient
): void {
  container.innerHTML = '';

  const initialRoomCode = getRoomCodeFromUrl() || '';

  const panel = el('div', { class: 'panel', id: 'home-panel' }, [
    el('header', { style: 'text-align: center; margin-bottom: 24px;' }, [
      el('h1', {}, ['目擊者之夜']),
      el('p', { class: 'label-hint', style: 'font-size: 1rem;' }, [
        '3 至 6 人繁體中文私人推理聚會遊戲',
      ]),
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { for: 'player-name-input' }, ['玩家暱稱']),
      el('input', {
        id: 'player-name-input',
        type: 'text',
        maxlength: '24',
        placeholder: '請輸入 1 至 24 個字元',
        autocomplete: 'nickname',
      }),
    ]),
    el('div', { class: 'btn-group', style: 'margin-bottom: 20px;' }, [
      el(
        'button',
        { id: 'btn-create-room', type: 'button', class: 'primary-button btn-block' },
        ['建立新房間']
      ),
    ]),
    el('hr', {
      style: 'border: 0; border-top: 1px solid var(--border); margin: 24px 0;',
    }),
    el('div', { class: 'form-group' }, [
      el('label', { for: 'room-code-input' }, ['加入現有房間代碼']),
      el('input', {
        id: 'room-code-input',
        type: 'text',
        maxlength: '6',
        value: initialRoomCode,
        placeholder: '6 碼英文與數字（如：ABCDEF）',
        autocomplete: 'off',
        style: 'text-transform: uppercase; letter-spacing: 0.1em; font-family: var(--font-mono);',
      }),
    ]),
    el('div', { class: 'btn-group' }, [
      el(
        'button',
        { id: 'btn-join-room', type: 'button', class: 'secondary-button btn-block' },
        ['加入房間']
      ),
    ]),
  ]);

  const nameInput = panel.querySelector('#player-name-input') as HTMLInputElement;
  const roomInput = panel.querySelector('#room-code-input') as HTMLInputElement;
  const createBtn = panel.querySelector('#btn-create-room') as HTMLButtonElement;
  const joinBtn = panel.querySelector('#btn-join-room') as HTMLButtonElement;

  createBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      showInlineAlert(panel, '請輸入有效的玩家暱稱。');
      return;
    }
    client.createRoom(name);
  });

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = roomInput.value.trim().toUpperCase();
    if (!name) {
      showInlineAlert(panel, '請輸入有效的玩家暱稱。');
      return;
    }
    if (code.length !== 6) {
      showInlineAlert(panel, '請輸入正確的 6 碼房間代碼。');
      return;
    }
    client.joinRoom(code, name);
  });

  container.appendChild(panel);
}
