import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type {
  MatchHistory,
  Paginated,
  PerformanceGroup,
  PlayerStats,
  PublicRoom,
} from '../../shared/accounts.ts';
import { ROLES, FACTIONS, type RoleId, type FactionId } from '../../shared/rules.ts';
import { LEVEL_SUMMARIES } from '../../shared/levels.ts';
import { apiRequest, navigate } from '../api.ts';
import { useAuth } from '../auth.tsx';
import type { GameClient } from '../net.ts';

export const percent = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
export const duration = (seconds: number | null) =>
  seconds === null ? '—' : seconds < 60 ? '少於 1 分鐘' : `${Math.floor(seconds / 60)} 分鐘`;
const outcomes = {
  pending: '進行中',
  win: '勝利',
  loss: '落敗',
  no_winner: '無獲勝者',
  abandoned: '中斷',
};

export function StatsCards({ stats }: { stats: PlayerStats | null }) {
  const cards = [
    {
      label: '參加場數',
      value: stats?.participated ?? '—',
      id: 'participated',
      hint: '每次開局，都是新線索',
    },
    { label: '勝場', value: stats?.wins ?? '—', id: 'wins', hint: '成功抵達真相的一方' },
    { label: '敗場', value: stats?.losses ?? '—', id: 'losses', hint: '下一夜，再作推敲' },
    {
      label: '勝率',
      value: stats ? percent(stats.winRate) : '—',
      id: 'winrate',
      hint: '只計有勝負的完成對局',
    },
  ];
  return (
    <Box className="stats-grid">
      {cards.map((card) => (
        <Paper variant="outlined" className="stat-card" key={card.id}>
          <Typography variant="body2" color="text.secondary">
            {card.label}
          </Typography>
          <Typography component="p" className="stat-value" data-testid={`stat-${card.id}`}>
            {card.value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {card.hint}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}

export function MatchList({ limit }: { limit?: number }) {
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<Paginated<MatchHistory> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Paginated<MatchHistory>>(`/api/me/matches?page=${page}&pageSize=${limit ?? 10}`, {
      signal: controller.signal,
    })
      .then(setHistory)
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [page, limit]);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h3" component="h2">
          {limit ? '最近對局' : '對局紀錄'}
        </Typography>
        {limit && <Link href="/history">查看全部 →</Link>}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!history && !error && <CircularProgress size={24} aria-label="載入對局" />}
      {history?.items.length === 0 && (
        <Box className="empty-state">
          <Typography sx={{ fontSize: 28 }}>♟</Typography>
          <Typography>你的故事，從第一場對局開始。</Typography>
          <Typography variant="body2" color="text.secondary">
            完成遊戲後，這裡會記下角色、勝負與遊玩時間。
          </Typography>
        </Box>
      )}
      {history?.items.map((match) => (
        <Box key={match.id} className="match-row">
          <Box>
            <Typography sx={{ fontWeight: 700 }}>
              {match.level} · {match.playerCount} 人 ·{' '}
              {match.roleId ? ROLES[match.roleId].label : '尚未揭曉'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(match.startedAt).toLocaleString('zh-HK')} ·{' '}
              {duration(match.durationSeconds)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {match.reason ?? match.abandonReason ?? '對局進行中'}
            </Typography>
          </Box>
          <Chip
            label={outcomes[match.outcome]}
            color={
              match.outcome === 'win' ? 'success' : match.outcome === 'loss' ? 'error' : 'default'
            }
            variant="outlined"
          />
        </Box>
      ))}
      {!limit && history && history.total > 10 && (
        <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 2 }}>
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            上一頁
          </Button>
          <Typography sx={{ alignSelf: 'center' }}>
            {page} / {Math.ceil(history.total / 10)}
          </Typography>
          <Button disabled={page * 10 >= history.total} onClick={() => setPage(page + 1)}>
            下一頁
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

export function Dashboard({
  client,
  connected,
  onError,
}: {
  client: GameClient;
  connected: boolean;
  onError: (message: string) => void;
}) {
  const { user } = useAuth();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [roomError, setRoomError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [level, setLevel] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [code, setCode] = useState('');
  const roomRequest = useRef<AbortController | null>(null);
  const refreshRooms = useCallback(async () => {
    roomRequest.current?.abort();
    const controller = new AbortController();
    roomRequest.current = controller;
    const signal = controller.signal;
    try {
      const result = await apiRequest<{ rooms: PublicRoom[] }>('/api/rooms/public', { signal });
      if (!signal.aborted) {
        setRooms(result.rooms);
        setRoomError('');
      }
    } catch (failure) {
      if (!signal.aborted)
        setRoomError(failure instanceof Error ? failure.message : '未能更新房間。');
    }
  }, []);
  useEffect(() => {
    const update = () => {
      if (!document.hidden) void refreshRooms();
      else roomRequest.current?.abort();
    };
    update();
    const interval = setInterval(update, 5000);
    document.addEventListener('visibilitychange', update);
    return () => {
      roomRequest.current?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refreshRooms]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    apiRequest<PlayerStats>('/api/me/stats', { signal: controller.signal })
      .then(setStats)
      .catch((failure) => {
        if (!controller.signal.aborted) setStatsError(failure.message);
      });
    return () => controller.abort();
  }, [user?.id]);
  function join(roomCode: string) {
    if (!user) {
      navigate(`/login?room=${roomCode}`);
      return;
    }
    if (!connected || !client.joinRoom(roomCode, user.displayName))
      onError('正在連接遊戲服務，請稍候再試。');
  }
  const visibleRooms = rooms?.filter((room) => level === 'all' || room.level === level);
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" className="dashboard-hero">
        <Box sx={{ maxWidth: 560, position: 'relative' }}>
          <Typography variant="overline" color="primary">
            THE TAVERN IS OPEN
          </Typography>
          <Typography
            variant="h1"
            component="h1"
            sx={{ fontFamily: 'var(--font-serif)', fontSize: { xs: 32, md: 46 }, my: 1 }}
          >
            {user ? '今晚，推理從你開始。' : '燈火已亮，等你入座。'}
          </Typography>
          <Typography color="text.secondary">
            一句證詞，一張卡牌。找出真相，或讓秘密留到最後。
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', gap: 1 }}>
            <Chip label="3–6 人推理" variant="outlined" />
            <Chip label="即時語音討論" variant="outlined" />
            <Chip label="與朋友同桌" variant="outlined" />
          </Stack>
        </Box>
      </Paper>
      {user && (
        <>
          {statsError && <Alert severity="warning">{statsError}</Alert>}
          <StatsCards stats={stats} />
        </>
      )}
      <Box className="lobby-grid">
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
          >
            <Box>
              <Typography variant="h2" component="h2">
                公開大廳
              </Typography>
              <Typography variant="body2" color="text.secondary">
                找一張空桌，認識新的推理夥伴。
              </Typography>
            </Box>
            <Button onClick={() => void refreshRooms()}>重新整理</Button>
          </Stack>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', my: 2 }}
          >
            <Chip
              size="small"
              label={`${visibleRooms?.length ?? 0} 間可加入房間`}
              variant="outlined"
            />
            <Select
              size="small"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              inputProps={{ 'aria-label': '篩選關卡' }}
            >
              <MenuItem value="all">所有關卡</MenuItem>
              {Object.entries(LEVEL_SUMMARIES).map(([item, summary]) => (
                <MenuItem value={item} key={item} sx={{whiteSpace:'normal'}}>
                  {item} · {summary}
                </MenuItem>
              ))}
            </Select>
          </Stack>
          <Divider />
          {roomError && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {roomError}
            </Alert>
          )}
          {!rooms && !roomError && <CircularProgress aria-label="載入公開房間" sx={{ m: 3 }} />}
          {visibleRooms?.length === 0 && (
            <Box className="empty-state">
              <Typography sx={{ fontSize: 38 }}>♧</Typography>
              <Typography>暫時未有公開房間</Typography>
              <Typography variant="body2" color="text.secondary">
                成為今晚第一位房主，邀請其他玩家入座。
              </Typography>
              <Button
                variant="outlined"
                onClick={() => (user ? setCreateOpen(true) : navigate('/login'))}
                sx={{ mt: 2 }}
              >
                建立第一張桌
              </Button>
            </Box>
          )}
          {visibleRooms?.map((room) => (
            <Box key={room.roomCode} className="public-room-row">
              <Box className="room-emblem">{room.level}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                  {room.hostName}的房間
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {room.playerCount} / {room.maxPlayers} 人 · 等待入座
                </Typography>
              </Box>
              <Button
                variant="outlined"
                aria-label={`加入${room.hostName}的房間`}
                onClick={() => join(room.roomCode)}
              >
                加入
              </Button>
            </Box>
          ))}
        </Paper>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h3" component="h2">
              今晚，你來作東
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ my: 2 }}>
              建立私人桌邀請朋友，或開啟公開房間，讓其他玩家一起加入。
            </Typography>
            <Button
              fullWidth
              variant="contained"
              onClick={() => (user ? setCreateOpen(true) : navigate('/login'))}
            >
              建立房間
            </Button>
          </Paper>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="h3" component="h2">
              已有邀請碼？
            </Typography>
            <TextField
              id="room-code-input"
              label="6 碼房間代碼"
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 6)
                )
              }
              slotProps={{ htmlInput: { maxLength: 6 } }}
              sx={{ my: 2 }}
            />
            <Button
              fullWidth
              variant="outlined"
              disabled={code.length !== 6}
              onClick={() => join(code)}
            >
              加入房間
            </Button>
          </Paper>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
            私人房間只透過邀請碼加入，不會在公開大廳展示。
          </Typography>
        </Stack>
      </Box>
      {user && <MatchList limit={5} />}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>建立你的房間</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            以「{user?.displayName}」入座。私人房間適合朋友聚會；公開房間會列在大廳。
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
              />
            }
            label="公開房間 / Public room"
          />
          <Typography variant="body2" color="text.secondary">
            {isPublic ? '其他玩家可從公開大廳找到並加入。' : '只限持有邀請碼或連結的玩家加入。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!connected}
            onClick={() => {
              if (user && client.createRoom(user.displayName, isPublic)) setCreateOpen(false);
              else onError('正在連接遊戲服務，請稍候再試。');
            }}
          >
            確認建立
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function Performance({
  title,
  groups,
  role,
}: {
  title: string;
  groups: PerformanceGroup[];
  role: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 3, flex: 1 }}>
      <Typography component="h2" variant="h3" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {groups.length === 0 ? (
        <Typography color="text.secondary">完成第一局後開始統計。</Typography>
      ) : (
        groups.map((group) => (
          <Box className="match-row" key={group.id}>
            <Box>
              <Typography>
                {role ? ROLES[group.id as RoleId]?.label : FACTIONS[group.id as FactionId]?.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {group.played} 場 · {group.wins} 勝 · {group.losses} 敗
              </Typography>
            </Box>
            <Typography color="primary">{percent(group.winRate)}</Typography>
          </Box>
        ))
      )}
    </Paper>
  );
}

export function HistoryPage() {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<PlayerStats>('/api/me/stats', { signal: controller.signal })
      .then(setStats)
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h2">
          我的戰績
        </Typography>
        <Typography color="text.secondary">每一次選擇，都留下自己的推理軌跡。</Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <StatsCards stats={stats} />
      {stats && (
        <>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Box className="detail-stats">
              {[
                ['完成對局', stats.completed],
                ['無獲勝者', stats.noWinner],
                ['中斷對局', stats.abandoned],
                ['進行中', stats.inProgress],
                ['目前連勝', stats.currentWinStreak],
                ['最佳連勝', stats.bestWinStreak],
                ['總遊玩時間', duration(stats.totalPlaySeconds)],
                ['平均完成時間', duration(stats.averageCompletedSeconds)],
              ].map(([label, value]) => (
                <Box key={label}>
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography sx={{ fontSize: 23, fontWeight: 700 }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
              中斷及無獲勝者局不計入勝率，也不打斷連勝。
            </Typography>
          </Paper>
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
            <Performance title="角色表現" groups={stats.roles} role />
            <Performance title="陣營表現" groups={stats.factions} role={false} />
          </Box>
        </>
      )}
      <MatchList />
    </Stack>
  );
}
