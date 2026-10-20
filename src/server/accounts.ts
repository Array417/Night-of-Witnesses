import { authenticatedPlayerSchema, type AuthenticatedPlayer, type MatchStart, type MatchResult } from '../shared/accounts.ts';

export class AccountService {
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(baseUrl: string, secret: string) {
    if (secret.length < 32) throw new Error('INTERNAL_API_SECRET must contain at least 32 characters');
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid API_BASE_URL');
    this.baseUrl = parsed.origin;
    this.secret = secret;
  }

  private async request(path: string, body: unknown, method = 'POST'): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/internal${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
      redirect: 'error',
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 ? '登入已失效，請重新登入。' : '資料服務暫時無法使用，請稍後再試。');
      Object.assign(error, { status: response.status });
      throw error;
    }
    return response.json();
  }

  async resolveSession(rawCookie: string): Promise<AuthenticatedPlayer> {
    const token = rawCookie.split(';').map(part => part.trim()).find(part => part.startsWith('now_user_session='))?.slice('now_user_session='.length);
    if (!token || token.length > 256) throw Object.assign(new Error('請先登入。'), { status: 401 });
    return authenticatedPlayerSchema.parse(await this.request('/sessions/resolve', { sessionToken: token }));
  }

  async registerInstance(instanceId: string): Promise<void> { await this.request('/instances', { instanceId }); }
  async recordRoom(payload: { roomId: string; code: string; instanceId: string; createdByUserId: string; isPublic: boolean; createdAt: string }): Promise<void> { await this.request('/rooms', payload); }
  async closeRoom(roomId: string): Promise<void> { await this.request(`/rooms/${roomId}/close`, {}); }
  async startMatch(payload: MatchStart): Promise<void> { await this.request('/matches', payload); }
  async completeMatch(matchId: string, payload: MatchResult): Promise<void> { await this.request(`/matches/${matchId}/result`, payload, 'PUT'); }
  async abandonMatch(matchId: string, endedAt: string, reason: string): Promise<void> { await this.request(`/matches/${matchId}/abandon`, { endedAt, reason }, 'PUT'); }
}

export type GameAccounts = Pick<AccountService, keyof AccountService>;
