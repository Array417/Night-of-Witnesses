import './styles.css';
import { el, announce, showInlineAlert } from './ui/dom.ts';

function initBaseShell(): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = '';

  const header = el('header', { class: 'panel' }, [
    el('h1', {}, ['目擊者之夜']),
    el('p', { class: 'text-secondary' }, ['繁體中文多人推理聚會遊戲']),
  ]);

  const formContainer = el('div', { class: 'panel', id: 'sample-panel' }, [
    el('h2', {}, ['玩家名稱設定']),
    el('form', { id: 'sample-form', novalidate: true }, [
      el('div', { class: 'form-group' }, [
        el('label', { for: 'sample-name' }, ['您的暱稱']),
        el('input', {
          id: 'sample-name',
          name: 'name',
          type: 'text',
          maxlength: '24',
          placeholder: '請輸入 1 至 24 個字元',
          required: true,
        }),
      ]),
      el('div', { class: 'form-group' }, [
        el('label', { for: 'sample-room-code' }, ['房間代碼（加入現有遊戲）']),
        el('input', {
          id: 'sample-room-code',
          name: 'roomCode',
          type: 'text',
          maxlength: '6',
          placeholder: '例如：ABCDEF',
        }),
      ]),
      el('div', { class: 'btn-group' }, [
        el(
          'button',
          {
            id: 'sample-submit-btn',
            type: 'submit',
            class: 'btn btn-primary',
          },
          ['確認送出']
        ),
      ]),
    ]),
  ]);

  const form = formContainer.querySelector('#sample-form') as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('sample-name') as HTMLInputElement;
    const roomInput = document.getElementById('sample-room-code') as HTMLInputElement;

    // Validation condition: if room code is empty when joining, or name is empty
    if (!nameInput.value.trim()) {
      showInlineAlert(formContainer, '請輸入有效的玩家暱稱。');
      return;
    }
    if (!roomInput.value.trim()) {
      showInlineAlert(formContainer, '請輸入 6 碼房間代碼。');
      return;
    }

    announce(`已提交：${nameInput.value.trim()}`);
  });

  app.appendChild(header);
  app.appendChild(formContainer);
  announce('目擊者之夜介面已載入。');
}

// Initialize on DOMContentLoaded or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBaseShell);
} else {
  initBaseShell();
}
