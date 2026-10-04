/**
 * UI-only voice controls: the discussion-phase microphone panel and the persistent
 * voice/sound settings disclosure. Media lifecycle belongs to the voice controller
 * exposed as `client.voice` (see net.ts); this module renders its state and forwards
 * user intent through the exact read-only contract below.
 */
import { el } from '../ui/dom.ts';
import { audioManager } from './manager.ts';
import type { VoiceController, VoiceState } from '../voice/controller.ts';

export const VOICE_UNAVAILABLE_HINT = '語音功能不可用（需要 HTTPS 連線與支援的瀏覽器）。';

const ignoreFailure = (): void => {
  // The controller surfaces denied/insecure/unsupported failures through state.error.
};

function describeStatus(state: VoiceState): string {
  if (!state.available) return VOICE_UNAVAILABLE_HINT;
  const connected = state.peers.filter(peer => peer.connectionState === 'connected').length;
  const failed = state.peers.some(peer => peer.connectionState === 'failed' || peer.connectionState === 'disconnected');
  const status = !state.active ? '語音僅在討論階段提供。'
    : failed ? `部分玩家語音未連通（${connected}/${state.peers.length}）。`
    : connected > 0 ? `語音已連線（${connected}/${state.peers.length}）。` : '正在與玩家建立語音連線…';
  if (state.playbackBlocked) return `${status}播放受阻，請在選單啟用語音播放。`;
  if (state.micPending) return `${status}麥克風權限請求中…`;
  if (state.micEnabled && state.micGain === 0) return `${status}麥克風已開啟，但增益為零；請在選單調高。`;
  if (state.outputVolume === 0) return `${status}收聽音量為零；請在選單調高。`;
  if (state.micEnabled) return `${status}麥克風已開啟。`;
  return `${status}麥克風目前關閉。`;
}

/**
 * Renders the discussion mic panel into `container` and returns the teardown that
 * removes its voice-controller subscription.
 */
export function renderVoicePanel(container: HTMLElement, voice: VoiceController): () => void {
  const statusLine = el('p', { class: 'voice-status label-hint' }, []);
  const errorLine = el(
    'div',
    { class: 'voice-error', style: 'display:none;' },
    []
  );
  const micBtn = el(
    'button',
    {
      id: 'btn-toggle-mic',
      type: 'button',
      class: 'secondary-button',
      'aria-pressed': 'false',
    },
    ['開啟麥克風']
  );
  const listenBtn = el(
    'button',
    {
      id: 'btn-resume-voice',
      type: 'button',
      class: 'secondary-button',
      style: 'display:none;',
    },
    ['開啟語音播放']
  );

  const panel = el('section', { class: 'voice-panel', 'aria-label': '語音通話' }, [
    el('h3', {}, ['語音通話']),
    statusLine,
    errorLine,
    el('div', { class: 'voice-actions btn-group' }, [micBtn, listenBtn]),
    el('p', { class: 'label-hint', style: 'margin-bottom: 0;' }, [
      '麥克風預設關閉；不用開啟自己的麥克風也能收聽。音量及增益在此選單下方調整。',
    ]),
  ]);
  container.appendChild(panel);

  let unsubscribe: () => void = () => {};

  const sync = (): void => {
    const state = voice.getState();
    micBtn.disabled = !state.available || !state.active;
    micBtn.setAttribute('aria-pressed', String(state.micEnabled));
    micBtn.textContent = state.micPending
      ? '取消麥克風要求'
      : state.micEnabled
        ? '關閉麥克風'
        : '開啟麥克風';
    listenBtn.style.display = state.playbackBlocked ? '' : 'none';
    statusLine.textContent = describeStatus(state);
    errorLine.textContent = state.error ?? '';
    errorLine.classList.toggle('alert', Boolean(state.error));
    errorLine.classList.toggle('alert-error', Boolean(state.error));
    if (state.error) errorLine.setAttribute('role', 'alert'); else errorLine.removeAttribute('role');
    errorLine.style.display = state.error ? 'flex' : 'none';
  };

  micBtn.addEventListener('click', () => {
    const state = voice.getState();
    // Off is always available, including while a permission request is pending.
    const next = !(state.micEnabled || state.micPending);
    void voice.setMicEnabled(next).catch(ignoreFailure);
  });
  listenBtn.addEventListener('click', () => {
    void voice.resumePlayback().catch(ignoreFailure);
  });

  unsubscribe = voice.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
  };
}

/** Compact table status, with controls kept exclusively inside the menu. */
export function renderVoiceStatus(container: HTMLElement, voice: VoiceController): () => void {
  const status = el('p', { class: 'voice-status label-hint', role: 'status', 'aria-live': 'polite' });
  const open = el('button', { type: 'button', class: 'secondary-button voice-menu-link' }, ['開啟 Menu 語音設定']);
  const host = el('div', { class: 'voice-summary' }, [status, open]);
  container.appendChild(host);
  const sync = () => {
    const state = voice.getState();
    status.textContent = describeStatus(state);
    open.hidden = !state.playbackBlocked && !state.error;
  };
  open.addEventListener('click', () => {
    const menu = document.getElementById('game-menu');
    if (menu?.dataset.state === 'closed') document.getElementById('btn-show-game-menu')?.click();
    else if (menu?.dataset.state === 'collapsed') document.getElementById('btn-toggle-game-menu')?.click();
    const appMenu = document.querySelector<HTMLDetailsElement>('#app-menu');
    if (appMenu) appMenu.open = true;
    document.getElementById('btn-resume-voice')?.focus();
  });
  const unsubscribe = voice.subscribe(sync);
  sync();
  return unsubscribe;
}

interface RangeFieldOptions {
  readonly id: string;
  readonly label: string;
  readonly min: string;
  readonly max: string;
  readonly step: string;
  readonly value: number;
  readonly disabled: boolean;
}

function rangeField(options: RangeFieldOptions): {
  group: HTMLElement;
  slider: HTMLInputElement;
} {
  const slider = el('input', {
    type: 'range',
    id: options.id,
    min: options.min,
    max: options.max,
    step: options.step,
    value: String(options.value),
  });
  slider.disabled = options.disabled;
  const group = el('div', { class: 'form-group' }, [
    el('label', { for: options.id }, [options.label]),
    slider,
  ]);
  return { group, slider };
}

/**
 * Appends the persistent voice/sound settings disclosure to the audio shell.
 * The shell moves between menus and lives for the page lifetime, so the single
 * voice subscription is intentionally never torn down.
 */
export function mountVoiceSettings(
  shell: HTMLElement,
  voice: VoiceController | null,
  masterSlider: HTMLInputElement
): void {
  if (shell.querySelector('#settings-panel')) return;

  const state = voice?.getState() ?? null;
  const game = rangeField({
    id: 'settings-game-volume',
    label: '遊戲音效音量',
    min: '0',
    max: '1',
    step: '0.05',
    value: audioManager.getPreferences().masterVolume,
    disabled: false,
  });
  const output = rangeField({
    id: 'settings-voice-output',
    label: '對方語音音量',
    min: '0',
    max: '1',
    step: '0.05',
    value: state?.outputVolume ?? 0.8,
    disabled: voice === null,
  });
  const gain = rangeField({
    id: 'settings-mic-gain',
    label: '麥克風增益',
    min: '0',
    max: '2',
    step: '0.1',
    value: state?.micGain ?? 1,
    disabled: voice === null,
  });

  const details = el('details', { id: 'settings-panel' }, [
    el('summary', { id: 'btn-audio-settings' }, ['語音與音效設定']),
    el('div', { class: 'settings-fields' }, [
      game.group,
      output.group,
      gain.group,
      el('p', { class: 'label-hint', style: 'margin-bottom: 0;' }, [
        voice ? '語音音量與麥克風增益會個別儲存在此瀏覽器。' : VOICE_UNAVAILABLE_HINT,
      ]),
    ]),
  ]);
  shell.appendChild(details);
  if (voice) {
    const button = el('button', { type: 'button', id: 'btn-voice-diagnostics', class: 'secondary-button' }, ['檢查語音連線']);
    const result = el('pre', { id: 'voice-diagnostics', hidden: '', tabindex: '0', 'aria-label': '語音連線診斷' });
    details.querySelector('.settings-fields')!.append(button, result);
    button.addEventListener('click', async () => {
      button.disabled = true;
      result.hidden = false;
      result.textContent = '正在檢查…';
      try { result.textContent = JSON.stringify(await voice.getDiagnostics(), null, 2); }
      catch { result.textContent = '檢查失敗，請稍後重試。'; }
      finally { button.disabled = false; }
    });
  }

  masterSlider.addEventListener('input', () => {
    game.slider.value = masterSlider.value;
  });
  game.slider.addEventListener('input', () => {
    const value = parseFloat(game.slider.value);
    audioManager.setMasterVolume(value);
    masterSlider.value = String(value);
  });

  if (voice) {
    output.slider.addEventListener('input', () => {
      voice.setOutputVolume(parseFloat(output.slider.value));
    });
    gain.slider.addEventListener('input', () => {
      voice.setMicGain(parseFloat(gain.slider.value));
    });
    // Skip the echo while the user is dragging, so the thumb never fights the pointer.
    voice.subscribe(() => {
      const latest = voice.getState();
      if (document.activeElement !== output.slider) {
        output.slider.value = String(latest.outputVolume);
      }
      if (document.activeElement !== gain.slider) {
        gain.slider.value = String(latest.micGain);
      }
    });
  }
}
