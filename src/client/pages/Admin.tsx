import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { apiRequest, ApiError, navigate } from '../api.ts';
import { useAuth } from '../auth.tsx';
import type { Paginated } from '../../shared/accounts.ts';

interface AdminOverview {
  users: number;
  completed: number;
  abandoned: number;
  inProgress: number;
}
interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}
interface AdminMatch {
  id: string;
  level: string;
  status: string;
  startedAt: string;
}

export function AdminOverviewPage() {
  const auth = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<Paginated<AdminUser> | null>(null);
  const [matches, setMatches] = useState<Paginated<AdminMatch> | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [matchPage, setMatchPage] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest<AdminOverview>('/api/admin/overview', { signal: controller.signal }),
      apiRequest<Paginated<AdminUser>>(`/api/admin/users?page=${userPage}`, {
        signal: controller.signal,
      }),
      apiRequest<Paginated<AdminMatch>>(`/api/admin/matches?page=${matchPage}`, {
        signal: controller.signal,
      }),
    ])
      .then(([totals, players, games]) => {
        setOverview(totals);
        setUsers(players);
        setMatches(games);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 401) void auth.refresh();
        else setError(failure.message);
      });
    return () => controller.abort();
  }, [userPage, matchPage, auth.refresh]);
  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Typography component="h1" variant="h2">
          管理總覽
        </Typography>
        <Button
          onClick={() => {
            void auth.logout()
              .then(() => navigate('/login'))
              .catch((failure) => setError(failure.message));
          }}
        >
          管理員登出
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!overview && !error && <CircularProgress />}
      {overview && (
        <Box className="stats-grid">
          {[
            ['玩家帳戶', overview.users],
            ['完成對局', overview.completed],
            ['中斷對局', overview.abandoned],
            ['進行中', overview.inProgress],
          ].map(([label, value]) => (
            <Paper key={label} variant="outlined" sx={{ p: 3 }}>
              <Typography color="text.secondary">{label}</Typography>
              <Typography sx={{ fontSize: 32 }}>{value}</Typography>
            </Paper>
          ))}
        </Box>
      )}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography component="h2" variant="h3">
          玩家列表
        </Typography>
        {users?.items.map((user) => (
          <Box className="match-row" key={user.id}>
            <Box sx={{ overflowWrap: 'anywhere' }}>
              <Typography>{user.displayName}</Typography>
              <Typography color="text.secondary" variant="body2">
                {user.email}
              </Typography>
            </Box>
            <Typography variant="caption">
              {new Date(user.createdAt).toLocaleDateString('zh-HK')}
            </Typography>
          </Box>
        ))}
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Button disabled={userPage === 1} onClick={() => setUserPage(userPage - 1)}>
            上一頁
          </Button>
          <Button
            disabled={!users || userPage * 10 >= users.total}
            onClick={() => setUserPage(userPage + 1)}
          >
            下一頁
          </Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography component="h2" variant="h3">
          對局列表
        </Typography>
        {matches?.items.length === 0 && (
          <Typography color="text.secondary">尚未有對局。</Typography>
        )}
        {matches?.items.map((match) => (
          <Box className="match-row" key={match.id}>
            <Typography>
              {match.level} ·{' '}
              {{ completed: '已完成', abandoned: '已中斷', in_progress: '進行中' }[match.status] ??
                match.status}
            </Typography>
            <Typography variant="body2">
              {new Date(match.startedAt).toLocaleString('zh-HK')}
            </Typography>
          </Box>
        ))}
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Button disabled={matchPage === 1} onClick={() => setMatchPage(matchPage - 1)}>
            上一頁
          </Button>
          <Button
            disabled={!matches || matchPage * 10 >= matches.total}
            onClick={() => setMatchPage(matchPage + 1)}
          >
            下一頁
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
