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
    container.appendChild(el('div', { class: 'panel' }, [el('p', {}, ['結算結果載入中...'])]));
    return;
  }

  const isHost = projection.isHost;
  const factionDef = FACTIONS[result.winningFaction];

  const panel = el('div', { class: 'panel', id: 'results-panel' }, [
    el('header', { style: 'text-align: center; margin-bottom: 1.5rem;' }, [
      el(
        'div',
        {
          class:
            result.winningFaction === 'bomber_faction'
              ? 'alert alert-danger'
              : result.winningFaction === 'witness_faction'
                ? 'alert alert-success'
                : 'alert alert-warning',
          style: 'font-size: 1.3rem; font-weight: 700; justify-content: center;',
        },
        [`🎉 遊戲結束：${factionDef?.label || result.winningFaction}獲勝！`]
      ),
      el('p', { class: 'text-secondary', style: 'font-size: 1.1rem;' }, [result.reason]),
    ]),
    // Boiler Room Occupants
    el('section', { 'aria-labelledby': 'boiler-heading', style: 'margin-bottom: 1.5rem;' }, [
      el('h2', { id: 'boiler-heading' }, ['進入鍋爐室者']),
      result.boilerOccupants.length === 0
        ? el('p', { class: 'text-muted' }, ['無人進入鍋爐室'])
        : el(
            'ul',
            { style: 'list-style: none;' },
            result.boilerOccupants.map((b) => {
              const p = projection.players.find((pl) => pl.playerId === b.playerId);
              const locLabel = PLAYER_LOCATIONS[b.locationId]?.label || b.locationId;
              const roleLabel = ROLES[b.role]?.label || b.role;
              return el('li', { style: 'padding: 0.25rem 0; font-size: 1.05rem; font-weight: 700; color: var(--color-danger);' }, [
                `🔥 【${locLabel}】${p?.playerName || '未知'}（身分：${roleLabel}）被送入鍋爐室！`,
              ]);
            })
          ),
    ]),
    // Complete Identity Reveal Table
    el('section', { 'aria-labelledby': 'reveal-heading', style: 'margin-bottom: 1.5rem;' }, [
      el('h2', { id: 'reveal-heading' }, ['全員身分揭曉']),
      el(
        'div',
        { style: 'overflow-x: auto;' },
        [
          el(
            'table',
            { style: 'width: 100%; border-collapse: collapse; text-align: left;' },
            [
              el('thead', {}, [
                el('tr', { style: 'border-bottom: 2px solid var(--color-border);' }, [
                  el('th', { style: 'padding: 0.5rem;' }, ['地點']),
                  el('th', { style: 'padding: 0.5rem;' }, ['玩家']),
                  el('th', { style: 'padding: 0.5rem;' }, ['真實角色']),
                  el('th', { style: 'padding: 0.5rem;' }, ['陣營']),
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

                  return el('tr', { style: 'border-bottom: 1px solid var(--color-border);' }, [
                    el('td', { style: 'padding: 0.5rem;' }, [locLabel]),
                    el('td', { style: 'padding: 0.5rem;' }, [p?.playerName || a.playerId]),
                    el('td', { style: 'padding: 0.5rem; font-weight: 700;' }, [roleDef?.label || a.role]),
                    el('td', { style: 'padding: 0.5rem;' }, [factionName]),
                  ]);
                })
              ),
            ]
          ),
        ]
      ),
      result.guestRoomCard
        ? el('p', { style: 'margin-top: 0.75rem; font-size: 0.95rem;' }, [
            `客房扣置卡牌：【${result.guestRoomCard.label}】`,
          ])
        : null,
    ]),
    // Ballots Breakdown
    el('section', { 'aria-labelledby': 'ballots-heading', style: 'margin-bottom: 1.5rem;' }, [
      el('h2', { id: 'ballots-heading' }, ['投票記錄統計']),
      el(
        'ul',
        { style: 'list-style: none;' },
        result.ballots.map((b) => {
          const voter = projection.players.find((p) => p.playerId === b.voterId);
          const targetLoc = PLAYER_LOCATIONS[b.targetLocation]?.label || b.targetLocation;
          let note = '';
          if (b.isVoided) {
            note = '【已被律師作廢】';
          } else if (b.weight === 2) {
            note = '【富豪加權 2 票】';
          }

          return el('li', { style: 'padding: 0.25rem 0;' }, [
            `${voter?.playerName || b.voterId} 投給了 【${targetLoc}】 ${note}`,
          ]);
        })
      ),
    ]),
    // Rematch Control
    el('div', { class: 'btn-group' }, [
      isHost
        ? el(
            'button',
            { id: 'btn-rematch', type: 'button', class: 'btn btn-primary btn-block' },
            ['再玩一局（重新發牌）']
          )
        : el('p', { class: 'text-muted' }, ['等待房主開啟下一局...']),
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
