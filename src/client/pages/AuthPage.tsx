import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, Chip, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '../auth.tsx';
import { navigate, post } from '../api.ts';

export function AuthPage({ mode }: { mode: 'login' | 'register' | 'forgot' | 'reset' }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resetToken] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const title = {
    login: '歡迎回到酒館',
    register: '加入這場推理',
    forgot: '忘記密碼？',
    reset: '設定新密碼',
  }[mode];
  const invite = new URLSearchParams(location.search).get('room');
  const suffix = invite && /^[A-Z0-9]{6}$/i.test(invite) ? `?room=${invite.toUpperCase()}` : '';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    try {
      if (mode === 'register' && [...String(form.get('displayName') ?? '').trim()].length > 24)
        throw new Error('玩家暱稱最多 24 個字元。');
      if (mode === 'login') {
        const role = await auth.login(email, password);
        navigate(role === 'admin' ? '/admin' : '/' + suffix);
      } else if (mode === 'register') {
        await auth.register(email, String(form.get('displayName')), password, confirmPassword);
        navigate('/' + suffix);
      } else if (mode === 'forgot') {
        const result = await post<{ message: string }>('/api/auth/forgot-password', { email });
        setMessage(result.message);
      } else {
        const result = await post<{ message: string }>('/api/auth/reset-password', {
          token: resetToken,
          password,
          confirmPassword,
        });
        history.replaceState({}, '', '/reset-password');
        await auth.refresh();
        setMessage(result.message);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失敗。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper variant="outlined" className="auth-layout">
      <Box className="auth-story">
        <Chip label="NIGHT OF WITNESSES" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
        <Typography
          component="p"
          sx={{ fontFamily: 'serif', fontSize: { xs: 24, md: 32 }, lineHeight: 1.5, mt: 'auto' }}
        >
          每一夜，
          <br />
          都有另一個版本的真相。
        </Typography>
        <Typography color="text.secondary">3–6 人 · 即時推理 · 繁體中文</Typography>
      </Box>
      <Box component="form" onSubmit={submit} className="auth-form">
        <Typography variant="overline" color="primary">
          目擊者之夜
        </Typography>
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {mode === 'login'
            ? '登入後依帳戶權限前往遊戲大廳或管理總覽。'
            : mode === 'register'
              ? '建立你的玩家身份，讓每一場對局留下紀錄。'
              : mode === 'forgot'
                ? '輸入註冊電郵，我們會提供限時重設連結。'
                : '請輸入 12–128 字元的新密碼。'}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {message && (
          <Alert severity="success" role="status">
            {message}
          </Alert>
        )}
        {!message && (
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {mode === 'register' && (
              <TextField
                label="玩家暱稱"
                name="displayName"
                autoComplete="nickname"
                required
                slotProps={{ htmlInput: { maxLength: 48 } }}
              />
            )}
            {mode !== 'reset' && (
              <TextField
                label="電郵"
                name="email"
                type="email"
                autoComplete="email"
                required
                slotProps={{ htmlInput: { maxLength: 254 } }}
              />
            )}
            {mode !== 'forgot' && (
              <TextField
                label="密碼"
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                slotProps={{ htmlInput: { minLength: mode === 'login' ? 1 : 12, maxLength: 128 } }}
              />
            )}
            {(mode === 'register' || mode === 'reset') && (
              <TextField
                label="確認密碼"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }}
              />
            )}
            {mode === 'login' && (
              <Link href={'/forgot-password' + suffix} sx={{ alignSelf: 'flex-end' }}>
                忘記密碼？
              </Link>
            )}
            <Button variant="contained" type="submit" disabled={busy}>
              {busy
                ? '處理中…'
                : {
                    login: '登入',
                    register: '建立帳戶',
                    forgot: '傳送重設連結',
                    reset: '更新密碼',
                  }[mode]}
            </Button>
          </Stack>
        )}
        <Box sx={{ mt: 3, textAlign: 'center' }}>
          {mode === 'login' ? (
            <Typography color="text.secondary">
              第一次到訪？ <Link href={'/register' + suffix}>建立帳戶</Link>
            </Typography>
          ) : (
            <Link href={'/login' + suffix}>返回登入</Link>
          )}
        </Box>
        <Link href="/" sx={{ mt: 3, display: 'inline-block', fontSize: 14 }}>
          ← 先逛逛公開大廳
        </Link>
      </Box>
    </Paper>
  );
}
