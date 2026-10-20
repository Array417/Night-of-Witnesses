import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Account } from '../shared/accounts.ts';
import { apiRequest, ApiError, post } from './api.ts';
import { clearSavedSeat } from './session.ts';

type AccountRole = 'user' | 'admin';
type Identity = {csrfToken: string; expiresAt: string} & (
  {role:'user';user:Account} | {role:'admin';admin:Account}
);
interface AuthState {
  user: Account | null;
  admin: Account | null;
  role: AccountRole | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<AccountRole>;
  register: (email: string, displayName: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      let result: Identity;
      try { result = await apiRequest<Identity>('/api/auth/me'); }
      catch (failure) {
        if (!(failure instanceof ApiError && failure.status === 401)) throw failure;
        result = await apiRequest<Identity>('/api/admin/auth/me');
      }
      if (current === generation.current) { setIdentity(result); setError(''); }
    }
    catch (failure) {
      if (current !== generation.current) return;
      if (failure instanceof ApiError && failure.status === 401) { setIdentity(null); setError(''); }
      else setError(failure instanceof Error ? failure.message : '帳戶服務暫時無法使用。');
    } finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const focus = () => { void refresh(); }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus); }, [refresh]);

  const login = async (email: string, password: string) => {
    generation.current += 1;
    const result = await post<Identity>('/api/auth/login', { email, password });
    generation.current += 1;
    clearSavedSeat();
    setIdentity(result);
    setLoading(false); setError('');
    return result.role;
  };
  const register = async (email: string, displayName: string, password: string, confirmPassword: string) => {
    generation.current += 1;
    const result = await post<Identity>('/api/auth/register', { email, displayName, password, confirmPassword });
    generation.current += 1;
    clearSavedSeat();
    setIdentity(result);
    setLoading(false); setError('');
  };
  const logout = async () => {
    generation.current += 1;
    if (identity) {
      try { await post(identity.role === 'admin' ? '/api/admin/auth/logout' : '/api/auth/logout', {}, identity.csrfToken); }
      catch (failure) { if (!(failure instanceof ApiError && failure.status === 401)) throw failure; }
    }
    generation.current += 1;
    clearSavedSeat(); setIdentity(null); setLoading(false); setError('');
  };
  return <AuthContext.Provider value={{ user: identity?.role === 'user' ? identity.user : null, admin: identity?.role === 'admin' ? identity.admin : null, role:identity?.role ?? null, loading, error, refresh, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}
