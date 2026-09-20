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

function initApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  // Mount persistent audio controls outside #app
  mountAudioControls();

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
      audioManager.playCue('error');
      showInlineAlert(app, message);
    },
    onStatusChange: (status) => {
      if (status === 'disconnected') {
        audioManager.playCue('disconnect');
        announce('與伺服器斷線，正在嘗試重新連線...');
      } else if (status === 'connected') {
        audioManager.playCue('connect');
        announce('已成功連線至伺服器。');
      }
    },
    onRoomClosed: (reason) => {
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
