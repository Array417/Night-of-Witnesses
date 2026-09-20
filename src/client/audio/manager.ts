/**
 * Singleton Audio Manager owning AudioContext, master gain, lifecycle, and throttling.
 */
import {
  getAudioPreferences,
  saveAudioPreferences,
  type AudioPreferences,
} from './preferences.ts';
import {
  playSynthesizedCue,
  ProceduralAmbience,
  type AudioCueName,
} from './cues.ts';

export interface AudioManagerOptions {
  createContext?: () => AudioContext;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambience: ProceduralAmbience | null = null;
  private unlocked = false;
  private preferences: AudioPreferences;
  private lastCueTimestamps = new Map<string, number>();
  private createContextFn: () => AudioContext;
  private hasActiveRoomState = false;

  constructor(options: AudioManagerOptions = {}) {
    this.preferences = getAudioPreferences();
    this.createContextFn =
      options.createContext ||
      (() => {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        return new AudioCtx();
      });
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  getContextState(): AudioContextState | 'uninitialized' {
    return this.ctx ? this.ctx.state : 'uninitialized';
  }

  getEffectiveGain(): number {
    if (!this.masterGain) return 0;
    return this.preferences.muted ? 0 : this.preferences.masterVolume;
  }

  isAmbiencePlaying(): boolean {
    return Boolean(this.ambience && this.ambience.isPlaying());
  }

  async unlock(): Promise<void> {
    if (this.unlocked && this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch {
          // ignore
        }
      }
      return;
    }

    try {
      this.ctx = this.createContextFn();
      this.masterGain = this.ctx.createGain();
      this.updateMasterGain();
      this.masterGain.connect(this.ctx.destination);
      this.ambience = new ProceduralAmbience(this.ctx, this.masterGain);

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.unlocked = true;

      // Sync ambience state if room is already present
      if (this.hasActiveRoomState) {
        this.syncAmbience({ hasActiveRoom: true });
      }
    } catch {
      this.unlocked = false;
    }
  }

  async handleVisibilityChange(hidden: boolean): Promise<void> {
    if (!this.ctx || !this.unlocked) return;
    try {
      if (hidden && this.ctx.state === 'running') {
        await this.ctx.suspend();
      } else if (!hidden && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } catch {
      // ignore
    }
  }

  playCue(name: AudioCueName): boolean {
    if (!this.unlocked || !this.ctx || !this.masterGain || this.preferences.muted) {
      return false;
    }

    const now = Date.now();
    const last = this.lastCueTimestamps.get(name) || 0;
    if (now - last < 300) {
      return false; // Throttled
    }
    this.lastCueTimestamps.set(name, now);

    try {
      playSynthesizedCue(this.ctx, this.masterGain, name);
      return true;
    } catch {
      return false;
    }
  }

  syncAmbience(status: { hasActiveRoom: boolean }): void {
    this.hasActiveRoomState = status.hasActiveRoom;
    if (!this.unlocked || !this.ambience) return;

    if (this.hasActiveRoomState && this.preferences.ambienceEnabled && !this.preferences.muted) {
      this.ambience.start();
    } else {
      this.ambience.stop();
    }
  }

  setMuted(muted: boolean): void {
    this.preferences.muted = muted;
    saveAudioPreferences(this.preferences);
    this.updateMasterGain();
    this.syncAmbience({ hasActiveRoom: this.hasActiveRoomState });
  }

  setMasterVolume(volume: number): void {
    this.preferences.masterVolume = Math.max(0, Math.min(1, volume));
    saveAudioPreferences(this.preferences);
    this.updateMasterGain();
  }

  setAmbienceEnabled(enabled: boolean): void {
    this.preferences.ambienceEnabled = enabled;
    saveAudioPreferences(this.preferences);
    this.syncAmbience({ hasActiveRoom: this.hasActiveRoomState });
  }

  getPreferences(): Readonly<AudioPreferences> {
    return { ...this.preferences };
  }

  private updateMasterGain(): void {
    if (!this.masterGain || !this.ctx) return;
    const targetGain = this.preferences.muted ? 0 : this.preferences.masterVolume;
    try {
      this.masterGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
    } catch {
      this.masterGain.gain.value = targetGain;
    }
  }
}

// Singleton instance
export const audioManager = new AudioManager();

/**
 * Creates persistent UI audio controls shell outside #app
 */
export function mountAudioControls(container = document.body): HTMLElement {
  const existing = document.getElementById('audio-controls-shell');
  if (existing) return existing;

  const shell = document.createElement('aside');
  shell.id = 'audio-controls-shell';
  shell.setAttribute('aria-label', '音訊設定');

  const prefs = audioManager.getPreferences();

  shell.innerHTML = `
    <button type="button" id="btn-audio-mute" class="secondary-button" aria-label="靜音切換" aria-pressed="${prefs.muted}" style="min-height: 36px; min-width: 36px; padding: 4px 8px; font-size: 13px;">
      ${prefs.muted ? '🔇 靜音' : '🔊 音效'}
    </button>
    <label for="audio-volume-slider" class="sr-only">主音量</label>
    <input type="range" id="audio-volume-slider" min="0" max="1" step="0.05" value="${prefs.masterVolume}" aria-label="音量大小" style="width: 72px; min-height: 24px; cursor: pointer;" />
    <button type="button" id="btn-audio-ambience" class="secondary-button" aria-label="酒館環境音切換" aria-pressed="${prefs.ambienceEnabled}" style="min-height: 36px; min-width: 36px; padding: 4px 8px; font-size: 13px;">
      ${prefs.ambienceEnabled ? '🕯️ 環境音' : '🕯️ 靜止'}
    </button>
  `;

  const muteBtn = shell.querySelector('#btn-audio-mute') as HTMLButtonElement;
  const volumeSlider = shell.querySelector('#audio-volume-slider') as HTMLInputElement;
  const ambienceBtn = shell.querySelector('#btn-audio-ambience') as HTMLButtonElement;

  muteBtn.addEventListener('click', async () => {
    await audioManager.unlock();
    const current = audioManager.getPreferences();
    audioManager.setMuted(!current.muted);
    const updated = audioManager.getPreferences();
    muteBtn.setAttribute('aria-pressed', String(updated.muted));
    muteBtn.innerHTML = updated.muted ? '🔇 靜音' : '🔊 音效';
  });

  volumeSlider.addEventListener('input', async () => {
    await audioManager.unlock();
    const val = parseFloat(volumeSlider.value);
    audioManager.setMasterVolume(val);
  });

  ambienceBtn.addEventListener('click', async () => {
    await audioManager.unlock();
    const current = audioManager.getPreferences();
    audioManager.setAmbienceEnabled(!current.ambienceEnabled);
    const updated = audioManager.getPreferences();
    ambienceBtn.setAttribute('aria-pressed', String(updated.ambienceEnabled));
    ambienceBtn.innerHTML = updated.ambienceEnabled ? '🕯️ 環境音' : '🕯️ 靜止';
  });

  // Global user gesture unlock listener
  const unlockHandler = () => {
    audioManager.unlock();
    window.removeEventListener('pointerdown', unlockHandler);
    window.removeEventListener('keydown', unlockHandler);
  };
  window.addEventListener('pointerdown', unlockHandler, { once: true });
  window.addEventListener('keydown', unlockHandler, { once: true });

  // Visibility state listener
  document.addEventListener('visibilitychange', () => {
    audioManager.handleVisibilityChange(document.hidden);
  });

  container.appendChild(shell);
  return shell;
}
