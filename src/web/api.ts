const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? JSON_HEADERS : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('无法连接服务器，请检查网络或容器状态', 0);
  }

  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new CustomEvent('sp:unauthorized'));
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败（HTTP ${response.status}）`;
    const details =
      payload && typeof payload === 'object' && 'details' in payload
        ? (payload as { details: unknown }).details
        : undefined;
    throw new ApiError(message, response.status, details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
