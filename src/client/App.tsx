import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Link, Stack, Typography } from '@mui/material';
import { useAuth } from './auth.tsx';
import { useGame } from './use-game.ts';
import { navigate } from './api.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { Dashboard, HistoryPage } from './pages/Dashboard.tsx';
import { Room } from './pages/Room.tsx';
import { AdminOverviewPage } from './pages/Admin.tsx';
import { audioManager } from './audio/manager.ts';
import { getRoomCodeFromUrl, loadSavedSeat } from './session.ts';

export function App() {
  const auth = useAuth();
  const game = useGame();
  const [path, setPath] = useState(location.pathname);
  const attemptedInvite = useRef('');
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  useEffect(() => {
    const unlock = () => {
      void audioManager.unlock();
    };
    const visibility = () => {
      void audioManager.handleVisibilityChange(document.hidden);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    const code = getRoomCodeFromUrl();
    if (
      auth.user &&
      game.status === 'connected' &&
      !game.projection &&
      !loadSavedSeat() &&
      code &&
      attemptedInvite.current !== code
    ) {
      attemptedInvite.current = code;
      game.client.joinRoom(code, auth.user.displayName);
    }
  }, [auth.user?.id, game.status, game.projection, game.error]);
  useEffect(() => {
    if (auth.loading) return;
    let target: string | undefined;
    if (path === '/admin/login') target = auth.admin ? '/admin' : '/login';
    else if (path === '/admin' && !auth.admin) target = '/login';
    else if (auth.admin && (path === '/' || path === '/login')) target = '/admin';
    if (target) { history.replaceState({}, '', target); setPath(target); }
  }, [path, auth.loading, auth.admin?.id]);
  const account = auth.user ?? auth.admin;
  let content;
  if (auth.loading)
    content = (
      <Box sx={{ p: 8, textAlign: 'center' }}>
        <CircularProgress aria-label="載入帳戶" />
      </Box>
    );
  else if (path === '/admin' || path === '/admin/login' || (auth.admin && (path === '/' || path === '/login')))
    content = auth.admin ? <AdminOverviewPage /> : <AuthPage mode="login"/>;
  else if (game.projection && auth.user)
    content = <Room projection={game.projection} client={game.client} onError={game.setError} />;
  else if (['/login', '/register', '/forgot-password', '/reset-password'].includes(path))
    content = (
      <AuthPage
        key={path}
        mode={
          path === '/register'
            ? 'register'
            : path === '/forgot-password'
              ? 'forgot'
              : path === '/reset-password'
                ? 'reset'
                : 'login'
        }
      />
    );
  else if (path === '/history' && auth.user) content = <HistoryPage />;
  else if (path === '/history') content = <AuthPage mode="login" />;
  else
    content = (
      <Dashboard
        key={auth.user?.id ?? 'guest'}
        client={game.client}
        connected={game.status === 'connected'}
        onError={game.setError}
      />
    );
  return (
    <Box className="react-app">
      <Box component="header" className="app-header">
        <Link href="/" className="brand" underline="none">
          <span className="brand-mark">◈</span>
          <Box>
            <Typography
              component="span"
              sx={{
                display: 'block',
                fontFamily: 'var(--font-serif)',
                fontWeight: 700,
                fontSize: 21,
              }}
            >
              目擊者之夜
            </Typography>
            <Typography component="span" variant="caption" sx={{ letterSpacing: 2, fontSize: 9 }}>
              NIGHT OF WITNESSES
            </Typography>
          </Box>
        </Link>
        <Stack
          component="nav"
          aria-label="主要導覽"
          direction="row"
          sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
        >
          {auth.admin && <Button component="a" href="/admin">管理總覽</Button>}
          {!game.projection && !auth.admin && (
            <>
              <Button component="a" href="/" color={path === '/' ? 'primary' : 'secondary'}>
                遊戲大廳
              </Button>
              {auth.user && (
                <Button
                  component="a"
                  href="/history"
                  color={path === '/history' ? 'primary' : 'secondary'}
                >
                  我的戰績
                </Button>
              )}
            </>
          )}
          {account ? (
            <>
              <Chip label={account.displayName} variant="outlined" sx={{ maxWidth: 160 }} />
              <Button
                onClick={() => {
                  void auth
                    .logout()
                    .then(() => navigate('/login'))
                    .catch((failure) => game.setError(failure.message));
                }}
              >
                登出
              </Button>
            </>
          ) : (
            <>
              <Button component="a" href="/login">
                登入
              </Button>
              <Button component="a" href="/register" variant="outlined">
                建立帳戶
              </Button>
            </>
          )}
        </Stack>
      </Box>
      {auth.error && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void auth.refresh()}>重試</Button>}
          sx={{ mb: 2 }}
        >
          {auth.error}
        </Alert>
      )}
      {game.error && (
        <Alert severity="error" onClose={() => game.setError('')} sx={{ mb: 2 }}>
          {game.error}
        </Alert>
      )}
      {auth.user && (
        <Box
          id="connection-status-badge"
          className="connection app-connection"
          data-status={game.status}
        >
          {
            {
              connected: '已連線',
              connecting: '連線中',
              disconnected: '已斷線',
              reconnecting: '重新連線中',
              error: '連線錯誤',
            }[game.status]
          }
        </Box>
      )}
      {content}
      <Box component="footer" className="app-footer">
        <Typography variant="caption" color="text.secondary">
          目擊者之夜 · 把線索留在桌上，把秘密藏在心裡。
        </Typography>
      </Box>
    </Box>
  );
}
