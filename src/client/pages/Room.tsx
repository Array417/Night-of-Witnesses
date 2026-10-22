import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  FACTIONS,
  PLAYER_LOCATIONS,
  ROLES,
  ROLE_DETAILS,
  VALID_LEVELS_BY_PLAYERS,
  type Card,
  type GameLevel,
  type PlayerLocationId,
  type RoleId,
} from '../../shared/rules.ts';
import type { PlayerProjection } from '../../shared/state.ts';
import type { GameClient } from '../net.ts';
import { GameTable } from '../components/game/GameTable.tsx';
import { GameSettings } from '../components/GameSettings.tsx';
import { LevelDetails } from '../components/LevelDetails.tsx';
import { LEVEL_SUMMARIES } from '../../shared/levels.ts';
import { audioManager } from '../audio/manager.ts';

type Action = Parameters<GameClient['dispatchAction']>[0];

function Discussion({
  projection,
  send,
}: {
  projection: PlayerProjection;
  send: (action: Action) => void;
}) {
  const [clock, setClock] = useState(Date.now());
  const [target, setTarget] = useState<PlayerLocationId | ''>('');
  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const connected = projection.players.filter((player) => player.connected).length;
  const consents = projection.discussionConsents.length;
  const ownConsent = projection.discussionConsents.includes(projection.viewerId);
  return (
    <Stack spacing={2}>
      <Typography component="h2" variant="h3" data-phase-heading>
        自由討論階段
      </Typography>
      <Typography color="text.secondary">
        交換證詞，找出最值得懷疑的身份。每位玩家各自決定何時結束討論。
      </Typography>
      <Typography role="status">
        已同意結束討論：{consents} / {connected}
      </Typography>
      {projection.discussionDeadlineAt && (
        <Typography>
          過半數同意，{Math.max(0, Math.ceil((projection.discussionDeadlineAt - clock) / 1000))}{' '}
          秒後進入投票
        </Typography>
      )}
      <Button
        id="btn-consent-vote"
        variant="contained"
        disabled={ownConsent}
        onClick={() => send({ type: 'advance_to_vote' })}
      >
        {ownConsent ? '已同意，等待其他玩家' : '同意結束討論並進入投票'}
      </Button>
      {projection.ownRole?.role === 'butler' && (
        <>
          <Button
            variant="outlined"
            disabled={Boolean(projection.butlerPeek)}
            onClick={() => send({ type: 'butler_peek' })}
          >
            管家：查看扣置卡（之後須棄權）
          </Button>
          {projection.butlerPeek && (
            <Alert severity="info">
              僅你可見：{projection.butlerPeek.map((card) => card.label).join('、')}
            </Alert>
          )}
        </>
      )}
      {projection.ownRole?.role === 'detective' && (
        <>
          <FormControl fullWidth>
            <InputLabel id="detective-target-label">偵探目標地點</InputLabel>
            <Select
              labelId="detective-target-label"
              label="偵探目標地點"
              value={target}
              onChange={(event) => setTarget(event.target.value as PlayerLocationId)}
            >
              {projection.players
                .filter((player) => player.locationId)
                .map((player) => (
                  <MenuItem key={player.playerId} value={player.locationId!}>
                    {PLAYER_LOCATIONS[player.locationId!].label} · {player.playerName}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            disabled={!target || Boolean(projection.detectiveSentLocation)}
            onClick={() => {
              if (target) send({ type: 'detective_send', targetLocation: target });
            }}
          >
            偵探：送往鍋爐室
          </Button>
          {projection.detectiveSentLocation && (
            <Typography color="text.secondary">
              已選擇：{PLAYER_LOCATIONS[projection.detectiveSentLocation].label}
            </Typography>
          )}
        </>
      )}
    </Stack>
  );
}

function Voting({
  projection,
  send,
}: {
  projection: PlayerProjection;
  send: (action: Action) => void;
}) {
  const [target, setTarget] = useState<PlayerLocationId | ''>('');
  if (projection.ownRole?.role === 'butler' && projection.butlerPeek)
    return <Alert severity="info">你已查看扣置卡，本輪須棄權。正在等待其他玩家投票。</Alert>;
  if (projection.ownBallot)
    return (
      <Alert severity="success">
        你已投票給【{PLAYER_LOCATIONS[projection.ownBallot].label}】，等待其他玩家。
      </Alert>
    );
  return (
    <Stack spacing={2}>
      <Typography component="h2" variant="h3" data-phase-heading>
        投票指認階段
      </Typography>
      <Typography color="text.secondary">
        已投票：{projection.players.filter((player) => player.hasVoted).length} /{' '}
        {projection.players.length}。投票內容僅自己可見，結算時統一公開。
      </Typography>
      <FormControl fullWidth>
        <InputLabel id="vote-target-label">投票目標地點</InputLabel>
        <Select
          labelId="vote-target-label"
          label="投票目標地點"
          value={target}
          onChange={(event) => setTarget(event.target.value as PlayerLocationId)}
        >
          {projection.players
            .filter((player) => player.locationId)
            .map((player) => (
              <MenuItem key={player.playerId} value={player.locationId!}>
                {PLAYER_LOCATIONS[player.locationId!].label} · {player.playerName}
              </MenuItem>
            ))}
        </Select>
      </FormControl>
      <Button
        id="btn-submit-vote"
        variant="contained"
        disabled={!target}
        onClick={() => {
          if (target) send({ type: 'cast_vote', targetLocation: target });
        }}
      >
        送出投票
      </Button>
    </Stack>
  );
}

export function Room({
  projection,
  client,
  onError,
}: {
  projection: PlayerProjection;
  client: GameClient;
  onError: (message: string) => void;
}) {
  const [detail, setDetail] = useState<Card | null>(null);
  const [passed, setPassed] = useState<Card | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [claim, setClaim] = useState<RoleId>(projection.publicRoleRoster[0] ?? 'guest');
  const [copied, setCopied] = useState(false);
  const send = (action: Action) => {
    if (!client.dispatchAction(action)) onError('連線中斷或已有操作處理中，請稍後重試。');
    else audioManager.playCue(action.type === 'cast_vote' ? 'vote' : 'ready_start');
  };
  const handIdentity = (projection.ownCards ?? []).map((card) => card.id).join(',');
  useEffect(() => {
    setDetail(null);
    setPassed(null);
    setTarget(null);
  }, [projection.phase, projection.currentActorId, handIdentity]);
  useEffect(() => {
    if (projection.phase === 'resolution')
      audioManager.playCue(
        projection.result?.winningPlayerIds.includes(projection.viewerId) ? 'win' : 'loss'
      );
    else audioManager.playCue('phase_change');
  }, [projection.phase]);
  const playerName = (identity: string) =>
    projection.players.find((player) => player.playerId === identity)?.playerName ?? '已離房玩家';
  const me = projection.players.find((player) => player.playerId === projection.viewerId);
  const leave = () => send({ type: 'leave' });
  const phaseLabels: Record<string, string> = {
    lobby: '等待入座',
    draft: '抽牌傳遞',
    discussion: '自由討論',
    voting: '投票指認',
    resolution: '身分揭曉',
    game_over: '對局結束',
  };
  const header = (
    <Stack
      className="room-header"
      direction="row"
      sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}
    >
      <Box>
        <Typography variant="overline" color="primary">
          {phaseLabels[projection.phase]} · {projection.level}
        </Typography>
        <Typography component="h1" variant="h2">
          房間代碼：{projection.roomCode}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={projection.isPublic ? '公開房間' : '私人房間'}
        />
      </Box>
      <GameSettings client={client} />
    </Stack>
  );
  if (projection.phase === 'lobby')
    return (
      <Paper id="lobby-panel" variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
        <Stack spacing={3}>
          {header}
          <Typography color="text.secondary">
            目前人數：{projection.players.length} / 6 人（需 3 至 6 人方可開始）
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              id="btn-leave-room"
              variant="outlined"
              onClick={leave}
              disabled={projection.historyStatus === 'saving'}
            >
              ← 返回大廳
            </Button>
            <Button
              id="btn-copy-link"
              variant="outlined"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${location.origin}/?room=${projection.roomCode}`)
                  .then(() => setCopied(true))
                  .catch(() =>
                    onError(`邀請連結：${location.origin}/?room=${projection.roomCode}`)
                  );
              }}
            >
              {copied ? '已複製連結' : '複製邀請連結'}
            </Button>
          </Stack>
          <Box>
            <Typography component="h2" variant="h3">
              玩家名單
            </Typography>
            <Stack component="ul" id="player-roster" spacing={1} sx={{ listStyle: 'none', mt: 2 }}>
              {projection.players.map((player) => (
                <Paper
                  component="li"
                  variant="outlined"
                  key={player.playerId}
                  sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                >
                  <Typography sx={{ flex: 1, overflowWrap: 'anywhere' }}>
                    {player.playerName}
                    {player.isHost && '【房主】'}
                  </Typography>
                  <Chip
                    size="small"
                    label={!player.connected ? '斷線中' : player.ready ? '已準備' : '未準備'}
                    color={player.ready ? 'success' : 'default'}
                    variant="outlined"
                  />
                  {projection.isHost && !player.isHost && (
                    <Button
                      color="error"
                      onClick={() => send({ type: 'kick', targetPlayerId: player.playerId })}
                      aria-label={`踢除玩家 ${player.playerName}`}
                    >
                      踢除
                    </Button>
                  )}
                </Paper>
              ))}
            </Stack>
          </Box>
          <FormControl fullWidth>
            <InputLabel id="level-select-label">規則配置等級</InputLabel>
            <Select
              id="level-select"
              labelId="level-select-label"
              label="規則配置等級"
              value={
                (VALID_LEVELS_BY_PLAYERS[projection.players.length] ?? []).includes(
                  projection.level
                )
                  ? projection.level
                  : ''
              }
              disabled={!projection.isHost || projection.historyStatus === 'saving'}
              onChange={(event) =>
                send({ type: 'select_level', level: event.target.value as GameLevel })
              }
            >
              {(VALID_LEVELS_BY_PLAYERS[projection.players.length] ?? []).map((level) => (
                <MenuItem key={level} value={level} sx={{whiteSpace:'normal'}}>
                  {level} · {LEVEL_SUMMARIES[level]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {(VALID_LEVELS_BY_PLAYERS[projection.players.length] ?? []).includes(projection.level) && (
            <LevelDetails level={projection.level} playerCount={projection.players.length}/>
          )}
          {projection.players.length < 3 && (
            <Typography color="text.secondary">邀請至少兩位朋友入座後，即可選擇關卡。</Typography>
          )}
          {projection.historyStatus === 'saving' && (
            <Alert severity="info" role="status">
              正在保存開局資料，服務恢復後會自動開始。請稍候。
            </Alert>
          )}
          <Stack direction="row" spacing={2}>
            <Button
              id="btn-toggle-ready"
              variant="outlined"
              disabled={projection.historyStatus === 'saving'}
              onClick={() => send({ type: 'set_ready', ready: !me?.ready })}
            >
              {me?.ready ? '取消準備' : '準備完成'}
            </Button>
            {projection.isHost && (
              <Button
                id="btn-start-game"
                variant="contained"
                disabled={
                  projection.players.length < 3 ||
                  !projection.players.every((player) => player.ready) ||
                  projection.historyStatus === 'saving'
                }
                onClick={() => send({ type: 'start_game' })}
              >
                開始遊戲
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>
    );
  const result = projection.result;
  if (result)
    return (
      <Stack id="results-panel" spacing={3}>
        {header}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="overline" color="primary">
            THE NIGHT REVEALED
          </Typography>
          <Typography component="h2" variant="h2">
            {result.winningPlayerIds.length === 0
              ? '本局無獲勝者'
              : result.winningPlayerIds.includes(projection.viewerId)
                ? '你獲勝了！'
                : '這一夜，真相另有所屬。'}
          </Typography>
          <Typography sx={{ my: 2 }}>
            {FACTIONS[result.winningFaction].label} · {result.reason}
          </Typography>
          <Alert
            severity={projection.historyStatus === 'saving' ? 'info' : 'success'}
            role="status"
          >
            {projection.historyStatus === 'saving'
              ? '戰績保存中，完成後才可開始下一局。'
              : '戰績已保存，可在「我的戰績」查看。'}
          </Alert>
          <Box className="reveal-cards">
            {result.assignedRoles.map((assignment) => (
              <Box key={assignment.playerId} className="reveal-card">
                <img src={`/art/${assignment.role}.webp`} alt={ROLES[assignment.role].label} />
                <Typography sx={{ fontWeight: 700 }}>{playerName(assignment.playerId)}</Typography>
                <Typography>
                  {ROLES[assignment.role].label} · {PLAYER_LOCATIONS[assignment.locationId].label}
                </Typography>
                <Chip
                  size="small"
                  label={
                    result.winningPlayerIds.length === 0
                      ? '無獲勝者'
                      : result.winningPlayerIds.includes(assignment.playerId)
                        ? '勝利'
                        : '落敗'
                  }
                  variant="outlined"
                />
              </Box>
            ))}
          </Box>
          {result.guestRoomCard && (
            <Typography>客房扣置卡牌：{result.guestRoomCard.label}</Typography>
          )}
          <Typography component="h3" variant="h3" sx={{ mt: 2 }}>
            鍋爐室
          </Typography>
          <Typography>
            {result.boilerOccupants.length
              ? result.boilerOccupants
                  .map(
                    (occupant) =>
                      `${playerName(occupant.playerId)}（${ROLES[occupant.role].label}）`
                  )
                  .join('、')
              : '本局沒有人進入鍋爐室。'}
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="公開投票結果">
              <TableHead>
                <TableRow>
                  <TableCell>投票玩家</TableCell>
                  <TableCell>指認地點</TableCell>
                  <TableCell>票數</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.ballots.map((ballot) => (
                  <TableRow key={ballot.voterId}>
                    <TableCell>{playerName(ballot.voterId)}</TableCell>
                    <TableCell>{PLAYER_LOCATIONS[ballot.targetLocation].label}</TableCell>
                    <TableCell>{ballot.isVoided ? '無效' : ballot.weight}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
            <Button
              variant="outlined"
              disabled={projection.historyStatus === 'saving'}
              onClick={leave}
            >
              返回大廳
            </Button>
            {projection.isHost && (
              <Button
                variant="contained"
                id="btn-rematch"
                disabled={projection.historyStatus === 'saving'}
                onClick={() => send({ type: 'rematch' })}
              >
                再來一局
              </Button>
            )}
          </Stack>
        </Paper>
      </Stack>
    );
  function chooseTarget(identity: string, card?: Card) {
    if (card) setPassed(card);
    if (!card && !passed) {
      onError('請先選擇要傳出的卡牌。');
      return;
    }
    setTarget(identity);
  }
  return (
    <Stack className="game-room" spacing={2}>
      {header}
      <Box className="game-board">
        <GameTable
          projection={projection}
          selectedCardId={passed?.id ?? null}
          chooseCard={setDetail}
          chooseTarget={chooseTarget}
          drawCard={() => send({ type: 'draw_card' })}
        />
        <Paper variant="outlined" className="table-action-dock" sx={{ p: 3 }}>
          {projection.phase === 'draft' ? (
            <Typography role="status">
              {projection.cardMotion
                ? '卡牌移動中…'
                : projection.currentActorId !== projection.viewerId
                  ? `等待 ${playerName(projection.currentActorId ?? '')} 抽牌或傳牌。`
                  : (projection.ownCards?.length ?? 0) < 2
                    ? '輪到你：從中央牌堆逐張抽牌。'
                    : passed
                      ? '已選擇傳出卡牌，請點選目標席位。'
                      : '點擊手牌查看詳情，或直接拖曳到目標席位。'}
            </Typography>
          ) : projection.phase === 'discussion' ? (
            <Discussion projection={projection} send={send} />
          ) : (
            <Voting projection={projection} send={send} />
          )}
        </Paper>
        <Paper variant="outlined" className="game-testimony" sx={{ p: 3 }}>
          <Typography component="h2" variant="h3">
            公開目擊者證詞
          </Typography>
          {projection.testimonyTrail.length === 0 ? (
            <Typography color="text.secondary">尚無傳遞記錄</Typography>
          ) : (
            projection.testimonyTrail.map((entry, index) => (
              <Typography key={index} variant="body2" sx={{ mt: 1 }}>
                #{index + 1} {playerName(entry.fromPlayerId)} →{' '}
                {entry.toPlayerId ? playerName(entry.toPlayerId) : '客房'}，聲稱【
                {entry.testimonyRole ? ROLES[entry.testimonyRole].label : '無聲明'}】
              </Typography>
            ))
          )}
        </Paper>
      </Box>
      <Dialog id="card-detail-dialog" open={Boolean(detail)} onClose={() => setDetail(null)}>
        <DialogTitle>{detail?.label}</DialogTitle>
        <DialogContent>
          {detail && (
            <>
              <img src={`/art/${detail.role}.webp`} alt="" className="detail-card-image" />
              <Typography>{ROLE_DETAILS[detail.role].objective}</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {ROLE_DETAILS[detail.role].ability}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>關閉</Button>
          {projection.phase === 'draft' &&
            projection.currentActorId === projection.viewerId &&
            projection.ownCards?.length === 2 &&
            !projection.cardMotion && (
              <Button
                id="btn-pass-card"
                variant="contained"
                onClick={() => {
                  setPassed(detail);
                  setDetail(null);
                }}
              >
                傳遞此牌
              </Button>
            )}
        </DialogActions>
      </Dialog>
      <Dialog
        id="claim-dialog"
        open={Boolean(target && passed)}
        onClose={() => {
          setTarget(null);
          setPassed(null);
        }}
      >
        <DialogTitle>確認傳牌與公開聲稱</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            將「{passed?.label}」傳給 {target === 'guest-room' ? '客房' : playerName(target ?? '')}
            ，保留另一張卡。
          </Typography>
          <FormControl fullWidth>
            <InputLabel id="claim-role-label">公開聲稱的角色</InputLabel>
            <Select
              labelId="claim-role-label"
              label="公開聲稱的角色"
              value={claim}
              onChange={(event) => setClaim(event.target.value as RoleId)}
            >
              {projection.publicRoleRoster.map((role) => (
                <MenuItem key={role} value={role}>
                  {ROLES[role].label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
            聲稱會公開，但真正的卡面只會讓你與接收者看見。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            id="btn-cancel-pass"
            onClick={() => {
              setTarget(null);
              setPassed(null);
            }}
          >
            取消
          </Button>
          <Button
            id="btn-confirm-pass"
            variant="contained"
            onClick={() => {
              const keep = projection.ownCards?.find((card) => card.id !== passed?.id);
              if (keep && target)
                send({
                  type: 'choose_and_pass',
                  keepCardId: keep.id,
                  ...(target === 'guest-room' ? {} : { passToPlayerId: target }),
                  testimonyRole: claim,
                });
              setTarget(null);
              setPassed(null);
            }}
          >
            確認傳牌
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
