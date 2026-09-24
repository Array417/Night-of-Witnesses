/**
 * Discussion and voting phase action components with audio triggers and privacy safety.
 */
import { el, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import {
  PLAYER_LOCATIONS,
  type PlayerLocationId,
} from '../../shared/rules.ts';
import { audioManager } from '../audio/manager.ts';

/** Shown when a phase action cannot be dispatched (offline or one already in flight). */
const DISPATCH_FAILED = '操作失敗：連線中斷或已有動作正在處理，請稍後再試。';

export function renderDiscussionAction(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.appendChild(el('h2', {}, ['自由討論階段']));
  container.appendChild(
    el('p', { class: 'label-hint', style: 'margin-bottom: 16px;' }, [
      '所有玩家已獲得角色卡，現在請自由進行發言與推理。特殊角色可於此階段發動能力。',
    ])
  );

  const me = projection.ownRole;

  // Butler ability control
  if (me?.role === 'butler') {
    const butlerBox = el(
      'div',
      {
        style:
          'margin-bottom: 20px; padding: 16px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--panel-2);',
      },
      [
        el('h3', {}, ['管家特殊能力']),
        el('p', { class: 'label-hint' }, [
          '管家可於討論階段秘密查看 2 張扣置卡牌。使用後本輪將無法參與指認投票。',
        ]),
      ]
    );

    if (projection.butlerPeek) {
      butlerBox.appendChild(
        el('div', { class: 'alert alert-success' }, [
          `您查看的 2 張扣置卡為：【${projection.butlerPeek.map((c) => c.label).join('、')}】（您本輪須棄權）`,
        ])
      );
    } else {
      const peekBtn = el('button', { id: 'btn-butler-peek', type: 'button', class: 'secondary-button' }, [
        '發動能力：查看 2 張扣置卡',
      ]);
      peekBtn.addEventListener('click', () => {
        audioManager.playCue('ability');
        if (!client.dispatchAction({ type: 'butler_peek' })) {
          showInlineAlert(container, DISPATCH_FAILED);
        }
      });
      butlerBox.appendChild(peekBtn);
    }
    container.appendChild(butlerBox);
  }

  // Detective ability control
  if (me?.role === 'detective') {
    const detectiveBox = el(
      'div',
      {
        style:
          'margin-bottom: 20px; padding: 16px; border: 1px solid var(--accent); border-radius: var(--r-sm); background: var(--panel-2);',
      },
      [
        el('h3', {}, ['偵探特殊能力']),
        el('p', { class: 'label-hint' }, [
          '偵探可指認一位在場玩家，並立即將其押送至鍋爐室，遊戲將直接進入結算！',
        ]),
        el('div', { class: 'form-group' }, [
          el('label', { for: 'detective-target-select' }, ['選擇要送入鍋爐室的地點']),
          el(
            'select',
            { id: 'detective-target-select' },
            projection.players
              .filter((p) => p.locationId !== null)
              .map((p) =>
                el('option', { value: p.locationId! }, [
                  `${PLAYER_LOCATIONS[p.locationId!]?.label}（${p.playerName}）`,
                ])
              )
          ),
        ]),
        el(
          'button',
          { id: 'btn-detective-send', type: 'button', class: 'danger-button' },
          ['立即逮捕送往鍋爐室']
        ),
      ]
    );

    const sendBtn = detectiveBox.querySelector('#btn-detective-send') as HTMLButtonElement;
    sendBtn.addEventListener('click', () => {
      const targetSelect = detectiveBox.querySelector('#detective-target-select') as HTMLSelectElement;
      if (targetSelect?.value) {
        audioManager.playCue('ability');
        if (
          !client.dispatchAction({
            type: 'detective_send',
            targetLocation: targetSelect.value as PlayerLocationId,
          })
        ) {
          showInlineAlert(container, DISPATCH_FAILED);
        }
      }
    });

    container.appendChild(detectiveBox);
  }

  // Host advance button
  if (projection.isHost) {
    const hostAdvanceBtn = el(
      'button',
      {
        id: 'btn-advance-vote',
        type: 'button',
        class: 'primary-button btn-block',
        style: 'margin-top: 16px;',
      },
      ['討論結束，進入指認投票階段']
    );
    hostAdvanceBtn.addEventListener('click', () => {
      audioManager.playCue('phase_change');
      if (!client.dispatchAction({ type: 'advance_to_vote' })) {
        showInlineAlert(container, DISPATCH_FAILED);
      }
    });
    container.appendChild(hostAdvanceBtn);
  } else {
    container.appendChild(el('p', { class: 'label-hint' }, ['等待房主結束討論並開啟投票...']));
  }
}

export function renderVotingAction(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): void {
  container.appendChild(el('h2', {}, ['投票指認階段']));

  // Public vote progress (completion count without leaking targets)
  const votedCount = projection.players.filter((p) => p.hasVoted).length;
  const totalCount = projection.players.length;
  container.appendChild(
    el('div', { class: 'vote-progress label-hint', style: 'margin-bottom: 16px;' }, [
      `目前投票進度：${votedCount} / ${totalCount} 人已完成投票`,
    ])
  );

  const me = projection.ownRole;
  const isButlerPeeked = me?.role === 'butler' && Boolean(projection.butlerPeek);

  if (isButlerPeeked) {
    container.appendChild(
      el('div', { class: 'alert alert-warning' }, [
        '您已於討論階段查看扣置卡，依規則必須於投票階段棄權。等待其他玩家投票中...',
      ])
    );
    return;
  }

  if (projection.ownBallot) {
    container.appendChild(
      el('div', { class: 'alert alert-success' }, [
        `您已完成投票，指認目標為：【${PLAYER_LOCATIONS[projection.ownBallot]?.label}】。等待其他人完成投票...`,
      ])
    );
    return;
  }

  container.appendChild(
    el('p', { class: 'label-hint', style: 'margin-bottom: 16px;' }, [
      '請指認您懷疑是兇手（或欲送往鍋爐室）的玩家地點：',
    ])
  );

  const occupiedLocations = projection.players.filter((p) => p.locationId !== null);

  const form = el('form', { id: 'vote-form' }, [
    el('fieldset', { style: 'margin-bottom: 20px;' }, [
      el('legend', {}, ['請選擇投票目標地點']),
      ...occupiedLocations.map((p, idx) =>
        el(
          'label',
          {
            class: 'radio-option',
            style: 'display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer;',
          },
          [
            el('input', {
              type: 'radio',
              id: `vote-target-${idx}`,
              name: 'targetLocation',
              value: p.locationId!,
              checked: idx === 0,
              style: 'width: 20px; height: 20px; accent-color: var(--brass);',
            }),
            el('span', { style: 'font-size: 1rem;' }, [
              `【${PLAYER_LOCATIONS[p.locationId!]?.label}】（${p.playerName}）`,
            ]),
          ]
        )
      ),
    ]),
    el(
      'button',
      { id: 'btn-submit-vote', type: 'submit', class: 'primary-button btn-block' },
      ['送出投票']
    ),
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const checked = form.querySelector('input[name="targetLocation"]:checked') as HTMLInputElement;
    if (checked?.value) {
      audioManager.playCue('vote');
      if (
        !client.dispatchAction({
          type: 'cast_vote',
          targetLocation: checked.value as PlayerLocationId,
        })
      ) {
        showInlineAlert(container, DISPATCH_FAILED);
      }
    }
  });

  container.appendChild(form);
}
