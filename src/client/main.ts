import './styles.css';
import { announce, showInlineAlert } from './ui/dom.ts';
import { GameClient } from './net.ts';
import * as session from './session.ts';
import type { PlayerProjection } from '../shared/state.ts';
import { renderHome } from './views/home.ts';
import { renderLobby } from './views/lobby.ts';
import { renderGame } from './views/game.ts';
import { renderResults } from './views/results.ts';

declare global {
  interface Window {
    __NOW__?: {
      GameClient: typeof GameClient;
      session: typeof session;
      client: GameClient;
    };
  }
}

let lastPhase: string | null = null;
let lastVersion: number = -1;

function renderCurrentView(app: HTMLElement, client: GameClient): void {
  const projection = client.getProjection();

  if (!projection) {
    lastPhase = null;
    renderHome(app, client);
    return;
  }

  // Phase transition announcement and audio cue
  if (projection.phase !== lastPhase) {
    lastPhase = projection.phase;
    audioManager.playCue('phase_change');
    const phaseNames: Record<string, string> = {
      lobby: '已回到遊戲大廳。',
      draft: '遊戲開始，進入抽牌傳遞階段。',
      discussion: '進入自由討論階段。',
      voting: '進入投票指認階段。',
      resolution: '遊戲結算完成。',
    };
    if (phaseNames[projection.phase]) {
      announce(phaseNames[projection.phase]);
    }
  }

  lastVersion = projection.version;

  switch (projection.phase) {
    case 'lobby':
      renderLobby(app, projection, client);
      break;
    case 'draft':
    case 'discussion':
    case 'voting':
      renderGame(app, projection, client);
      break;
    case 'resolution':
    case 'game_over':
      renderResults(app, projection, client);
      break;
    default:
      renderHome(app, client);
      break;
  }
}

import { renderShowcase } from './showcase/index.ts';
import { audioManager, mountAudioControls } from './audio/manager.ts';

function updateConnectionBadge(status: string): void {
  let badge = document.getElementById('connection-status-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'connection-status-badge';
    badge.className = 'connection';
    badge.style.position = 'fixed';
    badge.style.top = '12px';
    badge.style.right = '12px';
    badge.style.zIndex = '900';
    document.body.appendChild(badge);
  }
  badge.setAttribute('data-status', status);
  const labels: Record<string, string> = {
    connecting: '連線中',
    connected: '已連線',
    reconnecting: '重新連線中',
    disconnected: '已斷線',
    error: '連線錯誤',
  };
  badge.innerHTML = `<span>${labels[status] || status}</span>`;
}

function initApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  // Mount persistent audio controls and connection badge outside #app
  mountAudioControls();
  updateConnectionBadge('connecting');

  if (window.location.search.includes('showcase') || window.location.pathname.startsWith('/showcase')) {
    renderShowcase(app);
    return;
  }

  const client = new GameClient({
    onProjection: (p: PlayerProjection) => {
      audioManager.syncAmbience({ hasActiveRoom: true });
      renderCurrentView(app, client);
    },
    onError: (code: string, message: string) => {
      updateConnectionBadge('error');
      audioManager.playCue('error');
      showInlineAlert(app, message);
    },
    onStatusChange: (status) => {
      updateConnectionBadge(status);
      if (status === 'disconnected') {
        audioManager.playCue('disconnect');
        announce('與伺服器斷線，正在嘗試重新連線...');
      } else if (status === 'connected') {
        audioManager.playCue('connect');
        announce('已成功連線至伺服器。');
      } else if (status === 'reconnecting') {
        announce('正在嘗試重新連線至伺服器...');
      }
    },
    onRoomClosed: (reason) => {
      updateConnectionBadge('disconnected');
      audioManager.playCue('disconnect');
      audioManager.syncAmbience({ hasActiveRoom: false });
      announce(`房間已關閉：${reason}`);
      renderHome(app, client);
    },
  });

  if (typeof window !== 'undefined') {
    window.__NOW__ = {
      GameClient,
      session,
      client,
    };
  }

  // Connect WebSocket
  client.connect();

  // Initial render
  renderCurrentView(app, client);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
