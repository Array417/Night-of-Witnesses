import { z } from 'zod';

export interface VoicePreferences {
  outputVolume: number;
  micGain: number;
}

export const VOICE_STORAGE_KEY = 'night-of-witnesses.voice.v1';

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  outputVolume: 0.8,
  micGain: 1,
};

export function clampOutputVolume(val: unknown): number {
  if (typeof val !== 'number' || Number.isNaN(val)) {
    return DEFAULT_VOICE_PREFERENCES.outputVolume;
  }
  return Math.max(0, Math.min(1, Math.round(val * 100) / 100));
}

export function clampMicGain(val: unknown): number {
  if (typeof val !== 'number' || Number.isNaN(val)) {
    return DEFAULT_VOICE_PREFERENCES.micGain;
  }
  return Math.max(0, Math.min(2, Math.round(val * 100) / 100));
}

const voicePrefsFileSchema = z.object({
  outputVolume: z.unknown().optional(),
  micGain: z.unknown().optional(),
});

export function getVoicePreferences(): VoicePreferences {
  if (typeof globalThis.localStorage === 'undefined') {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
  try {
    const raw = globalThis.localStorage.getItem(VOICE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_PREFERENCES };
    const parsed: unknown = JSON.parse(raw);
    const result = voicePrefsFileSchema.safeParse(parsed);
    if (!result.success) return { ...DEFAULT_VOICE_PREFERENCES };
    return {
      outputVolume: clampOutputVolume(result.data.outputVolume),
      micGain: clampMicGain(result.data.micGain),
    };
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
}

export function saveVoicePreferences(prefs: VoicePreferences): void {
  if (typeof globalThis.localStorage === 'undefined') return;
  try {
    const sanitized: VoicePreferences = {
      outputVolume: clampOutputVolume(prefs.outputVolume),
      micGain: clampMicGain(prefs.micGain),
    };
    globalThis.localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota or security errors gracefully
  }
}
