/*
 * Native 115 client written for StreamPulse.
 * Protocol reference: 115driver (MIT, Copyright (c) 2022-2024 SheltonZhu).
 * The m115 RSA/XOR encoding below is a TypeScript adaptation of that project.
 */
import { randomBytes } from 'node:crypto';
import type { StorageClient, StorageEntry } from './storage.js';
import type { SourceProfile } from '../shared/types.js';

const API = 'https://webapi.115.com';
const STATUS = 'https://my.115.com/?ct=guide&ac=status';
const DOWNLOAD = 'https://proapi.115.com/app/chrome/downurl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const XOR_SEED = Buffer.from([
  0xf0,0xe5,0x69,0xae,0xbf,0xdc,0xbf,0x8a,0x1a,0x45,0xe8,0xbe,0x7d,0xa6,0x73,0xb8,
  0xde,0x8f,0xe7,0xc4,0x45,0xda,0x86,0xc4,0x9b,0x64,0x8b,0x14,0x6a,0xb4,0xf1,0xaa,
  0x38,0x01,0x35,0x9e,0x26,0x69,0x2c,0x86,0x00,0x6b,0x4f,0xa5,0x36,0x34,0x62,0xa6,
  0x2a,0x96,0x68,0x18,0xf2,0x4a,0xfd,0xbd,0x6b,0x97,0x8f,0x4d,0x8f,0x89,0x13,0xb7,
  0x6c,0x8e,0x93,0xed,0x0e,0x0d,0x48,0x3e,0xd7,0x2f,0x88,0xd8,0xfe,0xfe,0x7e,0x86,
  0x50,0x95,0x4f,0xd1,0xeb,0x83,0x26,0x34,0xdb,0x66,0x7b,0x9c,0x7e,0x9d,0x7a,0x81,
  0x32,0xea,0xb6,0x33,0xde,0x3a,0xa9,0x59,0x34,0x66,0x3b,0xaa,0xba,0x81,0x60,0x48,
  0xb9,0xd5,0x81,0x9c,0xf8,0x6c,0x84,0x77,0xff,0x54,0x78,0x26,0x5f,0xbe,0xe8,0x1e,
  0x36,0x9f,0x34,0x80,0x5c,0x45,0x2c,0x9b,0x76,0xd5,0x1b,0x8f,0xcc,0xc3,0xb8,0xf5,
]);
const XOR_CLIENT = Buffer.from([0x78,0x06,0xad,0x4c,0x33,0x86,0x5d,0x18,0x4c,0x01,0x3f,0x46]);
const N = BigInt('0x' + '8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b86021'
  + '36477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad633'
  + '8c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f1'
  + '0a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683');
const E = 0x10001n;
const RSA_BYTES = 128;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function xorDerive(seed: Buffer, size: number): Buffer {
  const key = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) {
    key[i] = (seed[i] + XOR_SEED[size * i]) & 0xff;
    key[i] ^= XOR_SEED[size * (size - i - 1)];
  }
  return key;
}

function xorTransform(data: Buffer, key: Buffer): void {
  const mod = data.length % 4;
  for (let i = 0; i < mod; i += 1) data[i] ^= key[i % key.length];
  for (let i = mod; i < data.length; i += 1) data[i] ^= key[(i - mod) % key.length];
}

function rsaEncrypt(input: Buffer): Buffer {
  const out: Buffer[] = [];
  for (let offset = 0; offset < input.length; offset += RSA_BYTES - 11) {
    const slice = input.subarray(offset, Math.min(offset + RSA_BYTES - 11, input.length));
    const pad = randomBytes(RSA_BYTES - slice.length - 3);
    const block = Buffer.alloc(RSA_BYTES);
    block[0] = 0;
    block[1] = 2;
    for (let i = 0; i < pad.length; i += 1) block[2 + i] = (pad[i] % 0xff) + 1;
    block[pad.length + 2] = 0;
    slice.copy(block, pad.length + 3);
    const encrypted = modPow(BigInt('0x' + block.toString('hex')), E, N).toString(16).padStart(RSA_BYTES * 2, '0');
    out.push(Buffer.from(encrypted, 'hex'));
  }
  return Buffer.concat(out);
}

function rsaDecrypt(input: Buffer): Buffer {
  const out: Buffer[] = [];
  for (let offset = 0; offset < input.length; offset += RSA_BYTES) {
    const block = input.subarray(offset, Math.min(offset + RSA_BYTES, input.length));
    const decrypted = modPow(BigInt('0x' + block.toString('hex')), E, N).toString(16).padStart(RSA_BYTES * 2, '0');
    const raw = Buffer.from(decrypted, 'hex');
    let start = 0;
    for (let i = 1; i < raw.length; i += 1) {
      if (raw[i] === 0) { start = i + 1; break; }
    }
    out.push(raw.subarray(start));
  }
  return Buffer.concat(out);
}

function encryptPayload(value: unknown): { data: string; key: Buffer } {
  const key = randomBytes(16);
  const input = Buffer.from(JSON.stringify(value));
  const buffer = Buffer.concat([key, input]);
  const body = buffer.subarray(16);
  xorTransform(body, xorDerive(key, 4));
  body.reverse();
  xorTransform(body, XOR_CLIENT);
  return { data: rsaEncrypt(buffer).toString('base64'), key };
}

function decryptPayload(data: string, key: Buffer): Buffer {
  const decoded = rsaDecrypt(Buffer.from(data, 'base64'));
  const out = Buffer.from(decoded.subarray(16));
  xorTransform(out, xorDerive(decoded.subarray(0, 16), 12));
  out.reverse();
  xorTransform(out, xorDerive(key, 4));
  return out;
}

interface P115Item {
  fid?: string;
  cid?: string;
  pid?: string;
  n?: string;
  s?: number | string;
  pc?: string;
  t?: string;
  sha?: string;
}

export class P115Error extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = 'P115Error'; }
}

export class P115Client implements StorageClient {
  readonly kind = '115' as const;
  readonly origin = 'https://115.com';
  private readonly cookies: string[];
  private active = 0;
  private readonly dirIds = new Map<string, string>([['/', '0']]);

  private readonly onCookieChange?: (cookie: string) => void;

  constructor(cookie: string | string[], onCookieChange?: (cookie: string) => void) {
    this.onCookieChange = onCookieChange;
    const input = Array.isArray(cookie) ? cookie : [cookie];
    this.cookies = input
      .map((value) => value.trim().replace(/\s*\r?\n\s*/g, '; '))
      .filter(Boolean);
    if (this.cookies.length === 0) throw new P115Error('115 Cookie 不能为空', 401);
  }

  private get cookie(): string {
    return this.cookies[this.active] || '';
  }

  private rotateCookie(): boolean {
    if (this.cookies.length <= 1) return false;
    this.active = (this.active + 1) % this.cookies.length;
    this.onCookieChange?.(this.cookie);
    return true;
  }

  private headers(contentType?: string): Record<string, string> {
    return {
      Cookie: this.cookie,
      'User-Agent': UA,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    };
  }

  private async request(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<any> {
    let lastError: P115Error | null = null;
    for (let attempt = 0; attempt < this.cookies.length; attempt += 1) {
      const timeout = AbortSignal.timeout(25_000);
      const response = await fetch(url, {
        ...init,
        headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const text = await response.text();
      let payload: any = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { throw new P115Error(`115 返回非 JSON（HTTP ${response.status}）`); }
      const authFailure =
        response.status === 401 ||
        response.status === 403 ||
        (payload?.state === false &&
          (Number(payload?.errno) === 401 || Number(payload?.errno) === 405 || /登录|Cookie|Token|失效/i.test(String(payload?.error || payload?.message || ''))));
      if (authFailure) {
        lastError = new P115Error(payload?.error || payload?.message || `115 登录失效（HTTP ${response.status}）`, 401);
        if (this.rotateCookie()) continue;
        throw lastError;
      }
      if (!response.ok) throw new P115Error(`115 请求失败（HTTP ${response.status}）`, response.status === 401 ? 401 : 502);
      if (payload?.state === false || (payload?.errno && Number(payload.errno) !== 0)) {
        throw new P115Error(payload?.error || payload?.message || '115 请求失败', payload?.errno === 401 ? 401 : 502);
      }
      return payload;
    }
    throw lastError || new P115Error('115 请求失败', 502);
  }

  private async listDir(cid: string, signal?: AbortSignal): Promise<P115Item[]> {
    const items: P115Item[] = [];
    const limit = 1150;
    for (let offset = 0; offset < 100_000; offset += limit) {
      const params = new URLSearchParams({
        aid: '1', cid, o: 'user_ptime', asc: '0', offset: String(offset), show_dir: '1',
        limit: String(limit), snap: '0', natsort: '0', record_open_time: '1', format: 'json', fc_mix: '0',
      });
      const payload = await this.request(`${API}/files?${params}`, {}, signal);
      const page = Array.isArray(payload?.data) ? payload.data as P115Item[] : [];
      items.push(...page);
      const count = Number(payload?.count ?? items.length);
      if (page.length < limit || offset + page.length >= count) break;
    }
    return items;
  }

  private async dirId(path: string, signal?: AbortSignal): Promise<string> {
    const normalized = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`;
    const cached = this.dirIds.get(normalized);
    if (cached) return cached;
    let current = '0';
    let prefix = '';
    for (const segment of normalized.split('/').filter(Boolean)) {
      const items = await this.listDir(current, signal);
      const child = items.find((item) => !item.fid && item.n === segment);
      if (!child?.cid) throw new P115Error(`115 目录不存在：${prefix}/${segment}`, 404);
      current = String(child.cid);
      prefix += `/${segment}`;
      this.dirIds.set(prefix, current);
    }
    return current;
  }

  async list(path: string, signal?: AbortSignal): Promise<StorageEntry[]> {
    const cid = await this.dirId(path, signal);
    return (await this.listDir(cid, signal)).map((item) => ({
      name: item.n || '',
      isDir: !item.fid,
      size: Number(item.s || 0) || 0,
      modified: item.t || '',
      id: item.fid || String(item.cid || ''),
      parentId: String(item.pid || cid),
    })).filter((item) => item.name);
  }

  private async findItem(filePath: string, signal?: AbortSignal): Promise<P115Item> {
    const normalized = `/${filePath.replace(/^\/+|\/+$/g, '')}`;
    const parent = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    const parentId = await this.dirId(parent, signal);
    const item = (await this.listDir(parentId, signal)).find((entry) => entry.n === name);
    if (!item) throw new P115Error(`115 路径不存在：${normalized}`, 404);
    return item;
  }

  private async entryId(item: P115Item): Promise<string> {
    return String(item.fid || item.cid || '');
  }

  async mkdir(dirPath: string, signal?: AbortSignal): Promise<void> {
    const normalized = `/${dirPath.replace(/^\/+|\/+$/g, '')}`;
    let current = '0';
    let prefix = '';
    for (const segment of normalized.split('/').filter(Boolean)) {
      const existed = (await this.listDir(current, signal)).find((item) => !item.fid && item.n === segment);
      if (existed?.cid) {
        current = String(existed.cid);
        prefix += `/${segment}`;
        this.dirIds.set(prefix, current);
        continue;
      }
      const payload = await this.request(`${API}/files/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ pid: current, cname: segment }).toString(),
      }, signal);
      const cid = String(payload?.cid || payload?.data?.cid || '');
      if (!cid) throw new P115Error('115 创建目录失败');
      current = cid;
      prefix += `/${segment}`;
      this.dirIds.set(prefix, current);
    }
  }

  async move(sourcePath: string, destinationDir: string, signal?: AbortSignal): Promise<void> {
    const item = await this.findItem(sourcePath, signal);
    const id = await this.entryId(item);
    const parentId = await this.dirId(destinationDir, signal);
    const form = new URLSearchParams({ pid: parentId, 'fid[0]': id });
    await this.request(`${API}/files/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }, signal);
  }

  async rename(sourcePath: string, newName: string, signal?: AbortSignal): Promise<void> {
    const item = await this.findItem(sourcePath, signal);
    const id = await this.entryId(item);
    const form = new URLSearchParams({
      fid: id,
      file_name: newName,
      [`files_new_name[${id}]`]: newName,
    });
    await this.request(`${API}/files/batch_rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }, signal);
  }

  async remove(sourcePath: string, signal?: AbortSignal): Promise<void> {
    const item = await this.findItem(sourcePath, signal);
    const id = await this.entryId(item);
    await this.request(`${API}/rb/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'fid[0]': id }).toString(),
    }, signal);
  }

  async getRawUrl(path: string, signal?: AbortSignal): Promise<string | null> {
    const normalized = `/${path.replace(/^\/+|\/+$/g, '')}`;
    const parent = normalized.slice(0, normalized.lastIndexOf('/')) || '/';
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    const parentId = await this.dirId(parent, signal);
    const item = (await this.listDir(parentId, signal)).find((entry) => entry.fid && entry.n === name);
    if (!item?.pc) return null;
    const { data, key } = encryptPayload({ pickcode: item.pc });
    const payload = await this.request(`${DOWNLOAD}?t=${Math.floor(Date.now() / 1000)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data }).toString(),
    }, signal);
    if (typeof payload?.data !== 'string') return null;
    const decoded = JSON.parse(decryptPayload(payload.data, key).toString()) as Record<string, { url?: { url?: string } }>;
    for (const value of Object.values(decoded)) {
      const url = value?.url?.url;
      if (url) return url;
    }
    return null;
  }

  async getProfile(signal?: AbortSignal): Promise<SourceProfile | null> {
    try {
      const nav = await this.request('https://my.115.com/?ct=ajax&ac=nav&_=' + Date.now(), {}, signal);
      const user = nav?.data ?? {};
      const info = await this.request(`${API}/files/index_info`, {}, signal);
      const space = info?.data?.space_info ?? {};
      const bytes = (value: any): number => {
        const raw = value?.size ?? value;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        const text = String(raw ?? '');
        if (/^[0-9]+$/.test(text)) return Number(text);
        const match = text.match(/^([0-9.]+)\s*(B|KB|MB|GB|TB)?/i);
        if (!match) return 0;
        const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
        return Math.round(Number(match[1]) * (units[(match[2] || 'B').toUpperCase()] ?? 1));
      };
      const total = bytes(space.all_total);
      const used = bytes(space.all_use);
      const remain = bytes(space.all_remain);
      const vip = Number(user.vip || 0);
      const forever = Boolean(user.forever);
      const expire = Number(user.expire || 0);
      return {
        nickname: String(user.user_name || user.nick_name || user.user_id || '115 用户'),
        avatarUrl: String(user.face || user.avatar || ''),
        totalBytes: total,
        usedBytes: used,
        remainingBytes: remain || Math.max(0, total - used),
        isVip: vip > 0 || forever,
        vipLabel: forever ? '永久会员' : vip > 0 ? '会员' : '普通账号',
        vipExpire: forever ? '永久' : expire > 0 ? new Date(expire * 1000).toISOString() : '',
        capturedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async hasChangesSince(timestamp: number, signal?: AbortSignal): Promise<boolean> {
    try {
      const payload = await this.request(
        `https://life.115.com/api/1.0/web/1.0/life/life_list?start=0&limit=20&type=1&file_behavior_type=0&_=${Date.now()}`,
        { headers: { Referer: 'https://115.com/' } },
        signal,
      );
      const list = payload?.data?.list ?? [];
      return list.some((item: any) => Number(item?.update_time || 0) > timestamp);
    } catch {
      return false;
    }
  }

  async receiveShare(shareCode: string, receiveCode: string, targetPath: string, signal?: AbortSignal): Promise<number> {
    const referer = `https://115cdn.com/s/${shareCode}?password=${encodeURIComponent(receiveCode)}&`;
    const params = new URLSearchParams({
      share_code: shareCode,
      receive_code: receiveCode,
      cid: '0',
      limit: '1000',
      offset: '0',
      asc: '0',
      format: 'json',
    });
    const snap = await this.request(`https://115cdn.com/webapi/share/snap?${params}`, {
      headers: { Referer: referer },
    }, signal);
    const files = snap?.data?.list ?? [];
    if (!files.length) throw new P115Error('分享中没有可接收的文件');
    const ids = files.map((file: any) => String(file?.fid || file?.cid || '')).filter(Boolean);
    if (!ids.length) throw new P115Error('分享文件没有有效 ID');
    await this.mkdir(targetPath, signal);
    const targetId = await this.dirId(targetPath, signal);
    const form = new URLSearchParams({
      share_code: shareCode,
      receive_code: receiveCode,
      file_id: ids.join(','),
      cid: targetId,
    });
    const result = await this.request('https://webapi.115.com/share/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: referer,
      },
      body: form.toString(),
    }, signal);
    if (result?.state === false) throw new P115Error(result?.error || result?.message || '分享接收失败');
    return ids.length;
  }

  async testConnection(signal?: AbortSignal): Promise<{ message: string; sampleCount: number }> {
    const status = await this.request(STATUS, {}, signal);
    if (status?.state !== true) throw new P115Error('115 Cookie 无效或已过期', 401);
    const entries = await this.list('/', signal);
    return { message: '已连接 115', sampleCount: entries.length };
  }
}
