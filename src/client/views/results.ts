import { el } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { FACTIONS, PLAYER_LOCATIONS, ROLES } from '../../shared/rules.ts';

export function renderResults(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.innerHTML = '';

  const result = projection.result;
  if (!result) {
    container.appendChild(
      el('div', { class: 'panel', id: 'results-panel' }, [
        el('div', { class: 'loading-state', style: 'text-align: center; padding: 2rem;' }, [
          el('div', { class: 'spinner', style: 'margin: 0 auto 1rem;' }),
          el('p', { class: 'text-muted' }, ['結算結果載入中...']),
        ]),
      ])
    );
    return;
  }

  const isHost = projection.isHost;
  const factionDef = FACTIONS[result.winningFaction];

  const panel = el('div', { class: 'panel', id: 'results-panel' }, [
    // Winner Banner
    el(
      'header',
      {
        class: 'winner-banner',
        'data-faction': result.winningFaction,
        style: 'text-align: center; margin-bottom: 1.5rem; padding: 1.25rem; border-radius: var(--r-md);',
      },
      [
        el(
          'h2',
          {
            id: 'winner-heading',
            style: 'font-size: 1.35rem; font-weight: 700; margin-bottom: 0.5rem;',
          },
          [`🎉 遊戲結束：${factionDef?.label || result.winningFaction}獲勝！`]
        ),
        el('p', { class: 'winner-reason text-muted', style: 'font-size: 1.05rem; margin-bottom: 0;' }, [
          result.reason,
        ]),
      ]
    ),

    // Boiler Room Occupants
    el('section', { class: 'results-section', 'aria-labelledby': 'boiler-heading', style: 'margin-bottom: 1.5rem;' }, [
      el('h3', { id: 'boiler-heading', style: 'margin-bottom: 0.75rem;' }, ['進入鍋爐室者']),
      result.boilerOccupants.length === 0
        ? el('p', { class: 'empty-state text-muted' }, ['無人進入鍋爐室'])
        : el(
            'ul',
            { class: 'boiler-list', style: 'list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 8px;' },
            result.boilerOccupants.map((b) => {
              const p = projection.players.find((pl) => pl.playerId === b.playerId);
              const locLabel = PLAYER_LOCATIONS[b.locationId]?.label || b.locationId;
              const roleLabel = ROLES[b.role]?.label || b.role;
              return el(
                'li',
                {
                  style:
                    'padding: 8px 12px; background: var(--danger-bg); border: 1px solid var(--danger-border); border-radius: var(--r-sm); font-size: 1rem; font-weight: 700; color: var(--danger);',
                },
                [`🔥 【${locLabel}】${p?.playerName || '未知'}（身分：${roleLabel}）被送入鍋爐室！`]
              );
            })
          ),
    ]),

    // Complete Identity Reveal Table
    el('section', { class: 'results-section', 'aria-labelledby': 'reveal-heading', style: 'margin-bottom: 1.5rem;' }, [
      el('h3', { id: 'reveal-heading', style: 'margin-bottom: 0.75rem;' }, ['全員身分揭曉']),
      el('div', { class: 'results-table-wrapper' }, [
        el('table', { class: 'results-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', {}, ['地點']),
              el('th', {}, ['玩家']),
              el('th', {}, ['真實角色']),
              el('th', {}, ['陣營']),
            ]),
          ]),
          el(
            'tbody',
            {},
            result.assignedRoles.map((a) => {
              const p = projection.players.find((pl) => pl.playerId === a.playerId);
              const locLabel = PLAYER_LOCATIONS[a.locationId]?.label || a.locationId;
              const roleDef = ROLES[a.role];
              const factionName = roleDef ? FACTIONS[roleDef.faction]?.label : '';

              return el('tr', {}, [
                el('td', {}, [locLabel]),
                el('td', {}, [p?.playerName || a.playerId]),
                el('td', { style: 'font-weight: 700; color: var(--accent);' }, [
                  roleDef?.label || a.role,
                ]),
                el('td', {}, [factionName]),
              ]);
            })
          ),
        ]),
      ]),
      ...(result.guestRoomCard
        ? [
            el(
              'p',
              {
                class: 'guest-room-card-info',
                style: 'margin-top: 0.75rem; font-size: 0.95rem; color: var(--muted);',
              },
              [`客房扣置卡牌：【${result.guestRoomCard.label}】`]
            ),
          ]
        : []),
    ]),

    // Ballots Breakdown
    el('section', { class: 'results-section', 'aria-labelledby': 'ballots-heading', style: 'margin-bottom: 1.5rem;' }, [
      el('h3', { id: 'ballots-heading', style: 'margin-bottom: 0.75rem;' }, ['投票記錄統計']),
      result.ballots.length === 0
        ? el('p', { class: 'empty-state text-muted' }, ['無投票記錄'])
        : el(
            'ul',
            { class: 'ballots-list', style: 'list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 6px;' },
            result.ballots.map((b) => {
              const voter = projection.players.find((p) => p.playerId === b.voterId);
              const targetLoc = PLAYER_LOCATIONS[b.targetLocation]?.label || b.targetLocation;
              let note = '';
              if (b.isVoided) {
                note = '【已被律師作廢】';
              } else if (b.weight === 2) {
                note = '【富豪加權 2 票】';
              }

              return el(
                'li',
                {
                  style:
                    'padding: 6px 10px; background: var(--field); border: 1px solid var(--border); border-radius: var(--r-sm); font-size: 0.95rem;',
                },
                [`${voter?.playerName || b.voterId} 投給了 【${targetLoc}】 ${note}`]
              );
            })
          ),
    ]),

    // Rematch Control
    el('div', { class: 'btn-group', style: 'margin-top: 1.5rem;' }, [
      isHost
        ? el(
            'button',
            { id: 'btn-rematch', type: 'button', class: 'btn btn-primary btn-block' },
            ['再玩一局（重新發牌）']
          )
        : el('p', { class: 'text-muted', 'aria-live': 'polite' }, ['等待房主開啟下一局...']),
    ]),
  ]);

  if (isHost) {
    const rematchBtn = panel.querySelector('#btn-rematch') as HTMLButtonElement;
    rematchBtn?.addEventListener('click', () => {
      client.dispatchAction({ type: 'rematch' });
    });
  }

  container.appendChild(panel);
}
