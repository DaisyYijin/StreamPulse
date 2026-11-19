import type { StorageClient, StorageEntry } from './storage.js';

const LOGIN = 'https://login.123pan.com/api/user/sign_in';
const API = 'https://yun.123pan.com/b/api';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const tokenCache = new Map<string, string>();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function signedUrl(raw: string): string {
  const url = new URL(raw);
  const table = 'adefghlmyij nopkqrstubcvwsz'.replace(' ', '');
  const now = new Date(Date.now() + 8 * 3600_000);
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const random = String(Math.round(Math.random() * 1e7));
  const digits = now.toISOString().slice(0, 16).replace(/[-T:]/g, '').slice(0, 12);
  const mapped = digits.split('').map((digit) => table[Number(digit)] ?? digit).join('');
  const timeSign = crc32(Buffer.from(mapped)).toString();
  const data = [timestamp, random, url.pathname, 'web', '3', timeSign].join('|');
  const dataSign = crc32(Buffer.from(data)).toString();
  url.searchParams.set(timeSign, `${timestamp}-${random}-${dataSign}`);
  return url.toString();
}

interface P123File {
  FileName: string;
  Size: number;
  UpdateAt: string;
  FileId: number;
  Type: number;
  Etag: string;
  S3KeyFlag: string;
}

export class P123Error extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = 'P123Error'; }
}

export class P123Client implements StorageClient {
  readonly kind = '123' as const;
  readonly origin = 'https://yun.123pan.com';
  private readonly username: string;
  private readonly password: string;
  private token: string;
  private readonly dirIds = new Map<string, string>([['/', '0']]);

  constructor(options: { username: string; password: string; token?: string }) {
    this.username = options.username.trim();
    this.password = options.password;
    this.token = options.token?.trim() || tokenCache.get(this.username) || '';
    if (!this.username || !this.password) throw new P123Error('请填写 123 云盘账号和密码', 401);
  }

  private headers(): Record<string, string> {
    return {
      origin: 'https://yun.123pan.com',
      referer: 'https://yun.123pan.com/',
      authorization: `Bearer ${this.token}`,
      'user-agent': UA,
      platform: 'web',
      'app-version': '3',
    };
  }

  private async login(): Promise<void> {
    const body = this.username.includes('@')
      ? { mail: this.username, password: this.password, type: 2 }
      : { passport: this.username, password: this.password, remember: true };
    const response = await fetch(LOGIN, {
      method: 'POST',
      headers: {
        origin: 'https://yun.123pan.com',
        referer: 'https://yun.123pan.com/',
        'user-agent': UA,
        platform: 'web',
        'app-version': '3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok || payload?.code !== 200 || !payload?.data?.token) {
      throw new P123Error(payload?.message || '123 云盘登录失败', 401);
    }
    this.token = String(payload.data.token);
    tokenCache.set(this.username, this.token);
  }

  private async request(url: string, init: RequestInit = {}, signal?: AbortSignal, retry = true): Promise<any> {
    if (!this.token) await this.login();
    const timeout = AbortSignal.timeout(25_000);
    const response = await fetch(signedUrl(url), {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (payload?.code === 401 && retry) {
      await this.login();
      return this.request(url, init, signal, false);
    }
    if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
      throw new P123Error(payload?.message || `123 云盘请求失败（HTTP ${response.status}）`, payload?.code === 401 ? 401 : 502);
    }
    return payload;
  }

  private async listDir(parentId: string, signal?: AbortSignal): Promise<P123File[]> {
    const files: P123File[] = [];
    for (let page = 1; page <= 1000; page += 1) {
      const query = new URLSearchParams({
        driveId: '0', limit: '100', next: '0', orderBy: 'file_id', orderDirection: 'desc',
        parentFileId: parentId, trashed: 'false', SearchData: '', Page: String(page),
        OnlyLookAbnormalFile: '0', event: 'homeListFile', operateType: '4', inDirectSpace: 'false',
      });
      const payload = await this.request(`${API}/file/list/new?${query}`, { method: 'GET' }, signal);
      const list = (payload?.data?.InfoList ?? []) as P123File[];
      files.push(...list);
      const total = Number(payload?.data?.Total ?? files.length);
      if (list.length === 0 || payload?.data?.Next === '-1' || files.length >= total) break;
    }
    return files;
  }

  private async dirId(path: string, signal?: AbortSignal): Promise<string> {
    const normalized = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`;
    const cached = this.dirIds.get(normalized);
    if (cached) return cached;
    let current = '0';
    let prefix = '';
    for (const segment of normalized.split('/').filter(Boolean)) {
      const child = (await this.listDir(current, signal)).find((item) => item.Type === 1 && item.FileName === segment);
      if (!child) throw new P123Error(`123 云盘目录不存在：${prefix}/${segment}`, 404);
      current = String(child.FileId);
      prefix += `/${segment}`;
      this.dirIds.set(prefix, current);
    }
    return current;
  }

  async list(path: string, signal?: AbortSignal): Promise<StorageEntry[]> {
    const id = await this.dirId(path, signal);
    return (await this.listDir(id, signal)).map((item) => ({
      name: item.FileName,
      isDir: item.Type === 1,
      size: Number(item.Size || 0),
      modified: item.UpdateAt || '',
    }));
  }

  async getRawUrl(path: string, signal?: AbortSignal): Promise<string | null> {
    const normalized = `/${path.replace(/^\/+|\/+$/g, '')}`;
    const parent = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    const parentId = await this.dirId(parent, signal);
    const file = (await this.listDir(parentId, signal)).find((item) => item.Type !== 1 && item.FileName === name);
    if (!file) return null;
    const payload = await this.request(`${API}/file/download_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driveId: 0, etag: file.Etag, fileId: file.FileId, fileName: file.FileName,
        s3keyFlag: file.S3KeyFlag, size: file.Size, type: file.Type,
      }),
    }, signal);
    let url = String(payload?.data?.DownloadUrl || '');
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const params = parsed.searchParams.get('params');
      if (params) url = Buffer.from(params, 'base64').toString('utf8');
    } catch { return null; }
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { referer: 'https://yun.123pan.com/' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) return new URL(location, url).toString();
      }
    } catch {
      // Return the signed URL; the player can still follow it.
    }
    return url;
  }

  async testConnection(signal?: AbortSignal): Promise<{ message: string; sampleCount: number }> {
    const entries = await this.list('/', signal);
    return { message: '已连接 123 云盘', sampleCount: entries.length };
  }
}
