/**
 * All-player discussion consent.
 *
 * `advance_to_vote` is now a per-player, irreversible consent: every connected
 * player (host included) decides once. Strictly more than half of connected
 * players consenting starts one 15-second server deadline; unanimous consent
 * advances immediately; the server forces the transition at the deadline.
 *
 * The browser only renders the deadline — it never sends a forced advance.
 */
import { el, showInlineAlert } from '../ui/dom.ts';
import type { GameClient } from '../net.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import { audioManager } from '../audio/manager.ts';

const DISPATCH_FAILED = '操作失敗：連線中斷或已有動作正在處理，請稍後再試。';

function progressText(consentedNames: readonly string[], waitingNames: readonly string[]): string {
  const total = consentedNames.length + waitingNames.length;
  if (total > 0 && waitingNames.length === 0) {
    return '所有連線玩家已同意，即將進入投票階段。';
  }
  const agreed = consentedNames.length > 0 ? `（${consentedNames.join('、')}）` : '';
  const waiting = waitingNames.length > 0 ? `；等待：${waitingNames.join('、')}` : '';
  return `已同意結束討論：${consentedNames.length} / ${total}${agreed}${waiting}`;
}

function startCountdown(line: HTMLElement, deadlineAt: number): () => void {
  let timer = 0;
  const tick = (): void => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      line.textContent = '時間已到，正等待伺服器進入投票階段…';
      line.classList.remove('is-urgent');
      window.clearInterval(timer);
      return;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    line.textContent = `剩餘 ${seconds} 秒，時間到將自動進入投票階段。`;
    line.classList.toggle('is-urgent', seconds <= 5);
  };
  timer = window.setInterval(tick, 1000);
  tick();
  return () => window.clearInterval(timer);
}

/**
 * Renders the consent section into the table action dock and returns the teardown
 * that clears its countdown interval on every view rerender/unmount.
 */
export function renderDiscussionConsent(
  container: HTMLElement,
  projection: PlayerProjection,
  client: GameClient
): () => void {
  const consent = projection;
  const consents = consent.discussionConsents;
  const connected = projection.players.filter((player) => player.connected);
  const consentedNames = connected
    .filter((player) => consents.includes(player.playerId))
    .map((player) => player.playerName);
  const waitingNames = connected
    .filter((player) => !consents.includes(player.playerId))
    .map((player) => player.playerName);
  const hasConsented = consents.includes(projection.viewerId);
  const deadline = consent.discussionDeadlineAt;

  const progressLine = el('p', { class: 'discussion-consent-progress', role: 'status' }, [
    progressText(consentedNames, waitingNames),
  ]);
  const countdownLine = el('p', { class: 'discussion-countdown' }, [
    '同意人數過半後，將於 15 秒後自動進入投票階段。',
  ]);
  const consentBtn = el(
    'button',
    { id: 'btn-advance-vote', type: 'button', class: 'primary-button btn-block' },
    [
      hasConsented
        ? `已同意結束討論（${consentedNames.length} / ${connected.length}），等待其他玩家…`
        : '同意結束討論，進入投票階段',
    ]
  );
  consentBtn.disabled = hasConsented;
  consentBtn.addEventListener('click', () => {
    audioManager.playCue('ready_start');
    if (!client.dispatchAction({ type: 'advance_to_vote' })) {
      showInlineAlert(container, DISPATCH_FAILED);
    }
  });

  container.appendChild(
    el('section', { class: 'discussion-consent', 'aria-label': '討論結束同意' }, [
      el('h3', {}, ['討論結束同意']),
      el('p', { class: 'label-hint', style: 'margin-bottom: var(--s2);' }, [
        '所有連線玩家（含房主）皆須同意；同意人數嚴格過半後，將於 15 秒後自動進入投票，全員同意則立即進入。',
      ]),
      progressLine,
      countdownLine,
      consentBtn,
    ])
  );

  if (typeof deadline === 'number') return startCountdown(countdownLine, deadline);
  return () => {};
}