/**
 * Audio preferences storage and defensive validation.
 * Persisted under 'night-of-witnesses.audio.v1'
 */

export interface AudioPreferences {
  muted: boolean;
  masterVolume: number;
  ambienceEnabled: boolean;
}

export const AUDIO_STORAGE_KEY = 'night-of-witnesses.audio.v1';

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  muted: false,
  masterVolume: 0.4,
  ambienceEnabled: true,
};

export function clampVolume(val: unknown): number {
  if (typeof val !== 'number' || Number.isNaN(val)) {
    return DEFAULT_AUDIO_PREFERENCES.masterVolume;
  }
  return Math.max(0, Math.min(1, Math.round(val * 100) / 100));
}

export function getAudioPreferences(): AudioPreferences {
  if (typeof globalThis.localStorage === 'undefined') {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }

  try {
    const raw = globalThis.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_AUDIO_PREFERENCES };
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_AUDIO_PREFERENCES };
    }

    const muted = typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_AUDIO_PREFERENCES.muted;
    const masterVolume = clampVolume(parsed.masterVolume);
    const ambienceEnabled =
      typeof parsed.ambienceEnabled === 'boolean'
        ? parsed.ambienceEnabled
        : DEFAULT_AUDIO_PREFERENCES.ambienceEnabled;

    return { muted, masterVolume, ambienceEnabled };
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(prefs: AudioPreferences): void {
  if (typeof globalThis.localStorage === 'undefined') return;

  try {
    const sanitized: AudioPreferences = {
      muted: Boolean(prefs.muted),
      masterVolume: clampVolume(prefs.masterVolume),
      ambienceEnabled: Boolean(prefs.ambienceEnabled),
    };
    globalThis.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota or security errors gracefully
  }
}
