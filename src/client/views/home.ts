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
    el('header', {}, [
      el('h1', {}, ['目擊者之夜']),
      el('p', { class: 'text-secondary' }, ['3 至 6 人繁體中文私人推理聚會遊戲']),
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { for: 'player-name-input' }, ['玩家暱稱']),
      el('input', {
        id: 'player-name-input',
        type: 'text',
        maxlength: '24',
        placeholder: '請輸入 1 至 24 個字元',
      }),
    ]),
    el('div', { class: 'btn-group', style: 'margin-bottom: 1.5rem;' }, [
      el(
        'button',
        { id: 'btn-create-room', type: 'button', class: 'btn btn-primary btn-block' },
        ['建立新房間']
      ),
    ]),
    el('hr', { style: 'border: 0; border-top: 1px solid var(--color-border); margin: 1.5rem 0;' }),
    el('div', { class: 'form-group' }, [
      el('label', { for: 'room-code-input' }, ['加入現有房間代碼']),
      el('input', {
        id: 'room-code-input',
        type: 'text',
        maxlength: '6',
        value: initialRoomCode,
        placeholder: '6 碼英文與數字（如：ABCDEF）',
      }),
    ]),
    el('div', { class: 'btn-group' }, [
      el(
        'button',
        { id: 'btn-join-room', type: 'button', class: 'btn btn-secondary btn-block' },
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
