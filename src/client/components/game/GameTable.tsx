import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Button, Typography } from '@mui/material';
import type { Card } from '../../../shared/rules.ts';
import { PLAYER_LOCATIONS, ROLES } from '../../../shared/rules.ts';
import type { PlayerProjection } from '../../../shared/state.ts';
import { getTableSeats } from '../../views/game-seating.ts';
import { usePointerDrag } from './use-pointer-drag.ts';

export function CardFace({
  card,
  onClick,
  selected = false,
  onDrop,
  root,
}: {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  onDrop?: (targetId: string) => void;
  root?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const suppressClick = usePointerDrag(ref, Boolean(onDrop), (target) =>
    onDrop?.(target.dataset.playerId ?? 'guest-room')
  );
  return (
    <div
      ref={ref}
      className={`card-face${selected ? ' is-selected' : ''}`}
      data-hand="viewer"
      data-card-id={card.id}
      data-role={card.role}
      tabIndex={0}
      role="button"
      aria-label={`查看卡牌：${card.label}`}
      aria-pressed={selected}
      onClick={() => {
        if (performance.now() > suppressClick.current) onClick?.();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <img
        src={`/art/${card.role}.webp`}
        alt=""
        aria-hidden="true"
        className="card-art"
        draggable={false}
      />
      <span className="card-role">{card.label}</span>
      <span className="card-hint">點擊查看詳情</span>
    </div>
  );
}

function DrawPile({
  enabled,
  count,
  drawCard,
}: {
  enabled: boolean;
  count: number;
  drawCard: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const suppressClick = usePointerDrag(
    ref,
    enabled,
    drawCard,
    '.hand-slot, .seat[aria-current="true"]'
  );
  return (
    <Button
      ref={ref}
      id="draw-pile"
      className="draw-pile"
      disabled={!enabled}
      onClick={() => {
        if (performance.now() > suppressClick.current) drawCard();
      }}
      aria-label={`抽一張卡牌，牌堆剩餘 ${count} 張`}
    >
      <CardBack />
      <span className="draw-pile-label">抽牌 · {count}</span>
    </Button>
  );
}

function CardBack() {
  return (
    <div className="card-back" aria-label="未公開卡牌">
      <img src="/art/card_back.webp" alt="" aria-hidden="true" draggable={false} />
    </div>
  );
}

function CardMotion({
  projection,
  root,
}: {
  projection: PlayerProjection;
  root: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motion = projection.cardMotion;
  useLayoutEffect(() => {
    if (!motion || !ref.current || !root) return;
    const seat = (identity: string | null) =>
      identity === projection.viewerId
        ? root.querySelector('.hand-slot')
        : [...root.querySelectorAll<HTMLElement>('.seat')].find(
            (element) => element.dataset.playerId === identity
          );
    const source =
      motion.kind === 'draw' ? root.querySelector('#draw-pile') : seat(motion.fromPlayerId);
    const target = motion.toPlayerId ? seat(motion.toPlayerId) : root.querySelector('.table-ring');
    if (!source || !target) return;
    const sourceRect = source.getBoundingClientRect(),
      targetRect = target.getBoundingClientRect(),
      stage = root.getBoundingClientRect();
    ref.current.style.left = `${targetRect.left + targetRect.width / 2 - stage.left - 40}px`;
    ref.current.style.top = `${targetRect.top + targetRect.height / 2 - stage.top - 56}px`;
    const animation = ref.current.animate(
      [
        {
          transform: `translate(${sourceRect.left + sourceRect.width / 2 - targetRect.left - targetRect.width / 2}px, ${sourceRect.top + sourceRect.height / 2 - targetRect.top - targetRect.height / 2}px) rotate(-8deg)`,
        },
        { transform: 'translate(0,0) rotate(0)' },
      ],
      {
        duration: Math.max(1, motion.endsAt - motion.startedAt),
        fill: 'both',
        easing: 'ease-in-out',
      }
    );
    animation.currentTime = Math.max(
      0,
      (projection.serverTime ?? motion.startedAt) - motion.startedAt
    );
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) animation.finish();
    return () => animation.cancel();
  }, [motion?.id, root]);
  if (!motion) return null;
  return (
    <div
      ref={ref}
      className="card-motion"
      data-kind={motion.kind}
      data-face={motion.card ? 'front' : 'back'}
      aria-label={motion.kind === 'draw' ? '抽牌中' : '傳牌中'}
    >
      {motion.card ? (
        <>
          <img src={`/art/${motion.card.role}.webp`} alt="" className="card-art" />
          <span className="card-role">{motion.card.label}</span>
        </>
      ) : (
        <CardBack />
      )}
    </div>
  );
}

export function GameTable({
  projection,
  selectedCardId,
  chooseCard,
  chooseTarget,
  drawCard,
}: {
  projection: PlayerProjection;
  selectedCardId: string | null;
  chooseCard: (card: Card) => void;
  chooseTarget: (identity: string, card?: Card) => void;
  drawCard: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const actor =
    projection.phase === 'draft' &&
    projection.currentActorId === projection.viewerId &&
    !projection.cardMotion;
  const canPass = actor && projection.ownCards?.length === 2;
  const finalActor = projection.servedPlayerIds.length === projection.players.length;
  const seats = getTableSeats(projection.players, projection.viewerId);
  const ownCards =
    projection.phase === 'draft'
      ? (projection.ownCards ?? [])
      : projection.ownRole
        ? [projection.ownRole]
        : [];
  return (
    <div className="panel table-panel">
      <header className="table-heading">
        <Typography component="h2" variant="h3">
          證人圓桌
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {projection.players.length} 位在場
        </Typography>
      </header>
      <div ref={ref} className="table-stage" data-player-count={projection.players.length}>
        <div className="table-ring">
          <div className="table-oval" aria-hidden="true" />
          {projection.phase === 'draft' && (
            <DrawPile
              enabled={actor && ownCards.length < 2}
              count={projection.drawPileCount ?? 0}
              drawCard={drawCard}
            />
          )}
          {canPass && finalActor && (
            <Button
              className="guest-room-target"
              data-target-id="guest-room"
              onClick={() => chooseTarget('guest-room')}
            >
              <img src="/art/guest_room.webp" className="guest-room-art" alt="" />
              <span className="guest-room-name">傳給客房</span>
            </Button>
          )}
          <div className="seats">
            {projection.players.map((player, index) => {
              const position = seats[index];
              const self = player.playerId === projection.viewerId;
              const eligible =
                canPass &&
                !finalActor &&
                !self &&
                player.connected &&
                !projection.servedPlayerIds.includes(player.playerId);
              const claim = [...projection.testimonyTrail]
                .reverse()
                .find((entry) => entry.fromPlayerId === player.playerId)?.testimonyRole;
              return (
                <div
                  key={player.playerId}
                  className={`seat${eligible ? ' is-eligible' : ''}${projection.currentActorId === player.playerId ? ' is-active' : ''}${!player.connected ? ' is-offline' : ''}`}
                  data-player-id={player.playerId}
                  data-relative-index={position.relativeIndex}
                  aria-current={self ? 'true' : undefined}
                  style={{ '--seat-x': position.x, '--seat-y': position.y } as CSSProperties}
                >
                  <span className="seat-name">
                    {player.playerName}
                    {self && '（我）'}
                  </span>
                  {player.locationId && (
                    <>
                      <img
                        src={`/art/${player.locationId}.webp`}
                        alt=""
                        className="seat-location-art"
                        draggable={false}
                      />
                      <span className="seat-location">
                        {PLAYER_LOCATIONS[player.locationId].label}
                      </span>
                    </>
                  )}
                  <span className="seat-state">
                    {!player.connected
                      ? '離線'
                      : projection.currentActorId === player.playerId
                        ? '行動中'
                        : player.hasVoted
                          ? '已投票'
                          : '在席'}
                  </span>
                  {claim && <span className="claim-badge">聲稱：{ROLES[claim].label}</span>}
                  {!self && (
                    <div className="seat-card">
                      {Array.from(
                        {
                          length: Math.max(
                            0,
                            (player.handCount ?? 0) -
                              (projection.cardMotion?.toPlayerId === player.playerId ? 1 : 0)
                          ),
                        },
                        (_, cardIndex) => (
                          <CardBack key={cardIndex} />
                        )
                      )}
                    </div>
                  )}
                  {eligible && (
                    <button
                      type="button"
                      className="seat-target"
                      aria-label={`選擇傳牌對象：${player.playerName}`}
                      onClick={() => chooseTarget(player.playerId)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="hand-slot" role="group" aria-label="我的手牌">
          {ownCards
            .filter(
              (card) =>
                !(
                  projection.cardMotion?.toPlayerId === projection.viewerId &&
                  projection.cardMotion.card?.id === card.id
                )
            )
            .map((card) => (
              <CardFace
                key={card.id}
                card={card}
                selected={selectedCardId === card.id}
                onClick={() => chooseCard(card)}
                root={ref.current}
                onDrop={canPass ? (identity) => chooseTarget(identity, card) : undefined}
              />
            ))}
        </div>
        <CardMotion
          key={projection.cardMotion?.id ?? 'none'}
          projection={projection}
          root={ref.current}
        />
      </div>
    </div>
  );
}
