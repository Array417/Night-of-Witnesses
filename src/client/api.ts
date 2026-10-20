export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function apiRequest<Result>(path: string, options: RequestInit = {}): Promise<Result> {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({ message: '服務回應無效，請稍後再試。' }));
  if (!response.ok) throw new ApiError(body.message ?? '操作失敗，請稍後再試。', response.status);
  return body as Result;
}

export function post<Result>(path: string, body: unknown, csrfToken?: string): Promise<Result> {
  return apiRequest(path, { method: 'POST', body: JSON.stringify(body), headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {} });
}

export function navigate(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) path = '/';
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
