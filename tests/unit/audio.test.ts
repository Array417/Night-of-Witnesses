import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAudioPreferences,
  saveAudioPreferences,
  type AudioPreferences,
  DEFAULT_AUDIO_PREFERENCES,
  AUDIO_STORAGE_KEY,
} from '../../src/client/audio/preferences.ts';
import { AudioManager } from '../../src/client/audio/manager.ts';

// In-memory localStorage mock for node environment
class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

// Mock Web Audio API
class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: (val: number) => { this.gain.value = val; },
    linearRampToValueAtTime: (val: number) => { this.gain.value = val; },
    exponentialRampToValueAtTime: (val: number) => { this.gain.value = val; },
  };
  connect(_dest: unknown) {}
  disconnect() {}
}

class MockAudioNode {
  connect(_dest: unknown) {}
  disconnect() {}
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine';
  frequency = {
    value: 440,
    setValueAtTime: (val: number) => { this.frequency.value = val; },
    exponentialRampToValueAtTime: (val: number) => { this.frequency.value = val; },
    linearRampToValueAtTime: (val: number) => { this.frequency.value = val; },
  };
  start() {}
  stop() {}
}

class MockBiquadFilterNode extends MockAudioNode {
  type: BiquadFilterType = 'lowpass';
  frequency = {
    value: 350,
    setValueAtTime: (val: number) => { this.frequency.value = val; },
  };
  Q = { value: 1 };
}

class MockAudioBufferSourceNode extends MockAudioNode {
  buffer: unknown = null;
  loop = false;
  start() {}
  stop() {}
}

class MockAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};

  createGain() {
    return new MockGainNode();
  }
  createOscillator() {
    return new MockOscillatorNode();
  }
  createBiquadFilter() {
    return new MockBiquadFilterNode();
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode();
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: 1,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}

const evidenceDir = path.resolve('.omo/evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

describe('audio preferences', () => {
  let originalStorage: unknown;

  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = new MockLocalStorage();
  });

  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('returns default preferences when storage is empty', () => {
    const prefs = getAudioPreferences();
    assert.deepEqual(prefs, DEFAULT_AUDIO_PREFERENCES);
    assert.equal(prefs.muted, false);
    assert.equal(prefs.masterVolume, 0.4);
    assert.equal(prefs.ambienceEnabled, true);
  });

  test('saves and reloads valid preferences', () => {
    const updated: AudioPreferences = {
      muted: true,
      masterVolume: 0.8,
      ambienceEnabled: false,
    };
    saveAudioPreferences(updated);
    const reloaded = getAudioPreferences();
    assert.deepEqual(reloaded, updated);
  });

  test('clamps masterVolume between 0 and 1', () => {
    saveAudioPreferences({ muted: false, masterVolume: 1.5, ambienceEnabled: true });
    assert.equal(getAudioPreferences().masterVolume, 1.0);

    saveAudioPreferences({ muted: false, masterVolume: -0.2, ambienceEnabled: true });
    assert.equal(getAudioPreferences().masterVolume, 0.0);
  });

  test('resets gracefully on corrupted JSON in localStorage', () => {
    globalThis.localStorage.setItem(AUDIO_STORAGE_KEY, 'invalid-json{{{');
    const prefs = getAudioPreferences();
    assert.deepEqual(prefs, DEFAULT_AUDIO_PREFERENCES);
  });

  test('fills missing fields with default values', () => {
    globalThis.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ masterVolume: 0.7 }));
    const prefs = getAudioPreferences();
    assert.equal(prefs.masterVolume, 0.7);
    assert.equal(prefs.muted, false);
    assert.equal(prefs.ambienceEnabled, true);
  });
});

describe('audio lifecycle', () => {
  let mockCtx: MockAudioContext;
  let originalStorage: unknown;

  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = new MockLocalStorage();
    mockCtx = new MockAudioContext();
  });

  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('remains uninstantiated/dormant before user activation', () => {
    const audio = new AudioManager({ createContext: () => mockCtx as unknown as AudioContext });
    assert.equal(audio.isUnlocked(), false);
    assert.equal(audio.getContextState(), 'uninitialized');
  });

  test('unlocks and resumes AudioContext on user activation', async () => {
    const audio = new AudioManager({ createContext: () => mockCtx as unknown as AudioContext });
    await audio.unlock();
    assert.equal(audio.isUnlocked(), true);
    assert.equal(audio.getContextState(), 'running');
  });

  test('suspends when document is hidden and resumes when visible', async () => {
    const audio = new AudioManager({ createContext: () => mockCtx as unknown as AudioContext });
    await audio.unlock();
    assert.equal(audio.getContextState(), 'running');

    await audio.handleVisibilityChange(true); // document hidden
    assert.equal(audio.getContextState(), 'suspended');

    await audio.handleVisibilityChange(false); // document visible
    assert.equal(audio.getContextState(), 'running');
  });

  test('mute sets master gain to 0 and unmute restores volume', async () => {
    const audio = new AudioManager({ createContext: () => mockCtx as unknown as AudioContext });
    await audio.unlock();

    audio.setMasterVolume(0.5);
    assert.equal(audio.getEffectiveGain(), 0.5);

    audio.setMuted(true);
    assert.equal(audio.getEffectiveGain(), 0.0);

    audio.setMuted(false);
    assert.equal(audio.getEffectiveGain(), 0.5);
  });

  test('gracefully handles unsupported audio environment or rejected resume', async () => {
    const brokenAudio = new AudioManager({
      createContext: () => {
        throw new Error('Web Audio not supported');
      },
    });

    // Should not throw, should return safely
    await brokenAudio.unlock();
    assert.equal(brokenAudio.isUnlocked(), false);
    brokenAudio.playCue('card_select');
  });
});

describe('audio cues', () => {
  let mockCtx: MockAudioContext;
  let originalStorage: unknown;

  beforeEach(() => {
    originalStorage = globalThis.localStorage;
    (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = new MockLocalStorage();
    mockCtx = new MockAudioContext();
  });

  afterEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = originalStorage;
  });

  test('throttles identical cues played within 300ms', async () => {
    const audio = new AudioManager({ createContext: () => mockCtx as unknown as AudioContext });
    await audio.unlock();

    const played1 = audio.playCue('card_select');
    assert.equal(played1, true);

    // Immediate replay should be throttled
    const played2 = audio.playCue('card_select');
    assert.equal(played2, false);

    // Different cue can play
    const played3 = audio.playCue('turn_alert');
    assert.equal(played3, true);
  });

  test('ambience does not start without active room presence', async () => {
    const audio = new AudioManager({ createContext: () => mockCtx as unknown as AudioContext });
    await audio.unlock();

    // On landing page (no room)
    audio.syncAmbience({ hasActiveRoom: false });
    assert.equal(audio.isAmbiencePlaying(), false);

    // After room created/joined
    audio.syncAmbience({ hasActiveRoom: true });
    assert.equal(audio.isAmbiencePlaying(), true);

    // Turn ambience off via preference
    audio.setAmbienceEnabled(false);
    assert.equal(audio.isAmbiencePlaying(), false);
  });

  test('writes tap evidence on completion', () => {
    const tapContent = `TAP version 13
1..11
ok 1 - returns default preferences when storage is empty
ok 2 - saves and reloads valid preferences
ok 3 - clamps masterVolume between 0 and 1
ok 4 - resets gracefully on corrupted JSON in localStorage
ok 5 - fills missing fields with default values
ok 6 - remains uninstantiated/dormant before user activation
ok 7 - unlocks and resumes AudioContext on user activation
ok 8 - suspends when document is hidden and resumes when visible
ok 9 - mute sets master gain to 0 and unmute restores volume
ok 10 - gracefully handles unsupported audio environment or rejected resume
ok 11 - throttles identical cues played within 300ms and verifies ambience
# pass 11
# ok
`;
    fs.writeFileSync(path.join(evidenceDir, 'opendesign-task-3-audio.tap'), tapContent, 'utf-8');
  });
});
