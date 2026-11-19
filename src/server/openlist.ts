import type { StorageClient, StorageEntry } from './storage.js';

interface ListItem {
  name?: string;
  size?: number;
  is_dir?: boolean;
  modified?: string;
  type?: number;
}

interface ApiEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export interface OpenListOptions {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

export type OpenListEntry = StorageEntry;

export class OpenListError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'OpenListError';
    this.status = status;
  }
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new OpenListError('来源地址不是有效的 URL', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OpenListError('来源地址必须使用 http 或 https', 400);
  }
  return trimmed;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export class OpenListClient implements StorageClient {
  readonly kind = 'openlist' as const;
  private readonly baseUrl: string;
  private readonly staticToken: string;
  private readonly username: string;
  private readonly password: string;
  private cachedToken = '';

  constructor(options: OpenListOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.staticToken = options.token?.trim() || '';
    this.username = options.username?.trim() || '';
    this.password = options.password || '';
  }

  get origin(): string {
    return this.baseUrl;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(25_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: combined });
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new OpenListError(`无法连接来源：${message}`);
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new OpenListError(
        `来源返回了非 JSON 响应（HTTP ${response.status}），请检查地址是否为 OpenList / AList 根地址`,
      );
    }

    if (!response.ok) {
      throw new OpenListError(
        errorMessage(payload, `来源请求失败（HTTP ${response.status}）`),
        response.status === 401 || response.status === 403 ? 401 : 502,
      );
    }
    const envelope = payload as ApiEnvelope<T>;
    if (typeof envelope.code === 'number' && envelope.code !== 200) {
      throw new OpenListError(
        envelope.message || `OpenList 返回错误代码 ${envelope.code}`,
        envelope.code === 401 || envelope.code === 403 ? 401 : 502,
      );
    }
    return (envelope.data ?? (payload as T)) as T;
  }

  private async token(signal?: AbortSignal): Promise<string> {
    if (this.staticToken) return this.staticToken;
    if (this.cachedToken) return this.cachedToken;
    if (!this.username || !this.password) {
      throw new OpenListError('请配置访问令牌，或填写 OpenList 用户名与密码', 401);
    }
    const data = await this.request<{ token?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
      },
      signal,
    );
    if (!data?.token) throw new OpenListError('登录成功但未返回令牌，请检查 OpenList 版本', 401);
    this.cachedToken = data.token;
    return data.token;
  }

  private async authHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
    return {
      Authorization: await this.token(signal),
      'Content-Type': 'application/json',
    };
  }

  async list(path: string, signal?: AbortSignal): Promise<OpenListEntry[]> {
    const entries: OpenListEntry[] = [];
    const perPage = 200;
    for (let page = 1; page <= 500; page += 1) {
      const headers = await this.authHeaders(signal);
      const data = await this.request<{ content?: ListItem[] | null; total?: number }>(
        '/api/fs/list',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ path, password: '', page, per_page: perPage, refresh: false }),
        },
        signal,
      );
      const content = data?.content ?? [];
      for (const item of content) {
        if (!item?.name) continue;
        entries.push({
          name: item.name,
          isDir: Boolean(item.is_dir),
          size: Number(item.size ?? 0) || 0,
          modified: item.modified ?? '',
        });
      }
      if (content.length < perPage) break;
      if (typeof data?.total === 'number' && page * perPage >= data.total) break;
    }
    return entries;
  }

  async getRawUrl(path: string, signal?: AbortSignal): Promise<string | null> {
    const headers = await this.authHeaders(signal);
    const data = await this.request<{ raw_url?: string; url?: string }>(
      '/api/fs/get',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, password: '' }),
      },
      signal,
    );
    const raw = data?.raw_url?.trim();
    return raw || null;
  }

  async testConnection(signal?: AbortSignal): Promise<{ message: string; sampleCount: number }> {
    let title = '';
    try {
      const settings = await this.request<{ title?: string; site_title?: string }>(
        '/api/public/settings',
        { method: 'GET' },
        signal,
      );
      title = settings?.title || settings?.site_title || '';
    } catch {
      // Public settings are optional; listing is the actual connectivity test.
    }
    const entries = await this.list('/', signal);
    return {
      message: title ? `已连接 ${title}` : '已连接 OpenList',
      sampleCount: entries.length,
    };
  }
}
