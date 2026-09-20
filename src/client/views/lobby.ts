import { el, announce, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { VALID_LEVELS_BY_PLAYERS, type GameLevel } from '../../shared/rules.ts';

const LEVEL_DESCRIPTIONS: Record<GameLevel, string> = {
  L1: 'L1 (3-4人) - 兇手 + 房客',
  L2: 'L2 (3-5人) - 兇手 + 共犯 + 房客',
  L3: 'L3 (4-6人) - 兇手 + 共犯 + 律師 + 房客',
  L4: 'L4 (3-5人) - 兇手 + 炸彈魔 + 房客',
  L5: 'L5 (4-6人) - 兇手 + 炸彈魔 + 富豪 + 房客',
  L6: 'L6 (4-6人) - 兇手 + 炸彈魔 + 偵探 + 房客',
  L7: 'L7 (4-6人) - 7大特殊角色（扣置 2 張）',
  L8: 'L8 (4-6人) - 7大特殊角色（扣置 2 張，移除 2 張）',
};

export function renderLobby(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.innerHTML = '';

  const isHost = projection.isHost;
  const me = projection.players.find((p) => p.playerId === projection.viewerId);
  const myReady = me?.ready ?? false;
  const playerCount = projection.players.length;
  const validLevels = VALID_LEVELS_BY_PLAYERS[playerCount] || [];

  const panel = el('div', { class: 'panel', id: 'lobby-panel' }, [
    el('header', { style: 'margin-bottom: 24px;' }, [
      el('h1', { style: 'margin-bottom: 8px;' }, [`房間代碼：${projection.roomCode}`]),
      el('p', { class: 'label-hint', style: 'font-size: 1rem;' }, [
        `目前人數：${playerCount} / 6 人（需 3 至 6 人方可開始）`,
      ]),
      el('div', { class: 'btn-group', style: 'margin-top: 12px;' }, [
        el(
          'button',
          { id: 'btn-copy-link', type: 'button', class: 'secondary-button' },
          ['複製邀請連結']
        ),
      ]),
    ]),
    el('section', { 'aria-labelledby': 'roster-heading', style: 'margin-bottom: 24px;' }, [
      el('h2', { id: 'roster-heading' }, ['玩家名單']),
      el(
        'ul',
        {
          id: 'player-roster',
          style: 'list-style: none; display: flex; flex-direction: column; gap: 8px; margin-top: 8px;',
        },
        projection.players.map((p) => {
          const badges = [];
          if (p.isHost) badges.push('【房主】');
          badges.push(p.ready ? '【已準備】' : '【未準備】');
          if (!p.connected) badges.push('【斷線中】');

          const children: (Node | string)[] = [
            el(
              'span',
              {
                style:
                  'font-family: var(--font-serif); font-size: 1.05rem; font-weight: 700; color: #fff0d2; word-break: break-all;',
              },
              [p.playerName]
            ),
            el(
              'span',
              {
                style:
                  'font-size: 0.85rem; color: var(--muted); margin-left: 8px; flex-shrink: 0;',
              },
              [badges.join(' ')]
            ),
          ];

          if (isHost && !p.isHost) {
            const kickBtn = el(
              'button',
              {
                type: 'button',
                class: 'danger-button',
                style:
                  'padding: 4px 10px; margin-left: auto; min-height: 36px; font-size: 0.85rem; flex-shrink: 0;',
                'aria-label': `踢除玩家 ${p.playerName}`,
              },
              ['踢除']
            );
            kickBtn.addEventListener('click', () => {
              client.dispatchAction({
                type: 'kick',
                targetPlayerId: p.playerId,
              });
            });
            children.push(kickBtn);
          }

          return el(
            'li',
            {
              style:
                'padding: 10px 14px; background: var(--panel-2); border: 1px solid var(--border); border-radius: var(--r-sm); display: flex; align-items: center; flex-wrap: wrap; gap: 8px;',
            },
            children
          );
        })
      ),
    ]),
    el('section', { 'aria-labelledby': 'level-heading', style: 'margin-bottom: 24px;' }, [
      el('h2', { id: 'level-heading' }, ['規則配置等級']),
      el('div', { class: 'form-group' }, [
        el('label', { for: 'level-select' }, ['選擇配置等級']),
        isHost
          ? el(
              'select',
              { id: 'level-select' },
              validLevels.map((lvl) => {
                const opt = el('option', { value: lvl }, [LEVEL_DESCRIPTIONS[lvl] || lvl]);
                if (lvl === projection.level) opt.selected = true;
                return opt;
              })
            )
          : el('input', {
              id: 'level-select',
              type: 'text',
              readonly: true,
              value: LEVEL_DESCRIPTIONS[projection.level] || projection.level,
            }),
      ]),
    ]),
    el('div', { class: 'btn-group' }, [
      el(
        'button',
        {
          id: 'btn-toggle-ready',
          type: 'button',
          class: myReady ? 'secondary-button' : 'primary-button',
        },
        [myReady ? '取消準備' : '準備完成']
      ),
      ...(isHost
        ? [
            el(
              'button',
              {
                id: 'btn-start-game',
                type: 'button',
                class: 'primary-button',
                disabled: !(
                  playerCount >= 3 &&
                  playerCount <= 6 &&
                  projection.players.every((p) => p.ready)
                ),
              },
              ['開始遊戲']
            ),
          ]
        : []),
    ]),
  ]);

  // Copy link
  const copyBtn = panel.querySelector('#btn-copy-link') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${projection.roomCode}`;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(inviteUrl);
      }
      announce('已複製邀請連結至剪貼簿！');
      copyBtn.textContent = '已複製連結！';
      setTimeout(() => {
        copyBtn.textContent = '複製邀請連結';
      }, 2000);
    } catch {
      showInlineAlert(panel, `請手動複製連結：${inviteUrl}`, 'warning');
    }
  });

  // Level change
  if (isHost) {
    const levelSelect = panel.querySelector('#level-select') as HTMLSelectElement;
    if (levelSelect) {
      levelSelect.addEventListener('change', () => {
        client.dispatchAction({
          type: 'select_level',
          level: levelSelect.value as GameLevel,
        });
      });
    }

    const startBtn = panel.querySelector('#btn-start-game') as HTMLButtonElement;
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        client.dispatchAction({
          type: 'start_game',
        });
      });
    }
  }

  // Ready toggle
  const readyBtn = panel.querySelector('#btn-toggle-ready') as HTMLButtonElement;
  readyBtn.addEventListener('click', () => {
    client.dispatchAction({
      type: 'set_ready',
      ready: !myReady,
    });
  });

  container.appendChild(panel);
}
