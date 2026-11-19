import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { AccountStore } from './accounts.js';
import { config } from './config.js';
import type { Store } from './store.js';
import { HttpError } from './types.js';

const scryptAsync = promisify(scrypt);

const COOKIE_NAME = 'sp_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authenticated?: boolean;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function comparePassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function safeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validateUsername(value: string): string {
  const username = value.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    throw new HttpError(400, '账号需为 3–32 位字母、数字、点、下划线或短横线');
  }
  return username;
}

export class Auth {
  private readonly store: Store;
  private readonly accounts: AccountStore;

  constructor(store: Store, accounts: AccountStore) {
    this.store = store;
    this.accounts = accounts;
  }

  get envManaged(): boolean {
    return config.envPassword.length > 0;
  }

  get passwordSet(): boolean {
    return this.envManaged || Boolean(this.accounts.current);
  }

  get setupRequired(): boolean {
    return !this.passwordSet;
  }

  get username(): string {
    if (this.envManaged) return config.envUsername || 'admin';
    return this.accounts.current?.username || 'admin';
  }

  async setup(username: string, password: string): Promise<void> {
    if (this.setupRequired === false) {
      throw new HttpError(409, '管理员账号已设置');
    }
    const normalized = validateUsername(username);
    if (password.length < 8) {
      throw new HttpError(400, '密码至少需要 8 个字符');
    }
    const hash = await hashPassword(password);
    await this.accounts.set(normalized, hash);
  }

  async verify(username: string, password: string): Promise<boolean> {
    if (this.envManaged) {
      return (
        safeEqualStrings(username.trim(), config.envUsername || 'admin') &&
        safeEqualStrings(password, config.envPassword)
      );
    }
    if (!safeEqualStrings(username.trim(), this.username)) return false;
    const hash = this.accounts.current?.passwordHash;
    if (!hash) return false;
    return comparePassword(password, hash);
  }

  async changeCredentials(
    currentPassword: string,
    nextUsername: string,
    nextPassword?: string,
  ): Promise<void> {
    if (this.envManaged) {
      throw new HttpError(400, '管理员账号由环境变量管理，无法在界面修改');
    }
    if (!(await this.verify(this.username, currentPassword))) {
      throw new HttpError(403, '当前密码不正确');
    }
    const normalized = validateUsername(nextUsername);
    if (nextPassword !== undefined && nextPassword.length < 8) {
      throw new HttpError(400, '新密码至少需要 8 个字符');
    }
    const hash = nextPassword ? await hashPassword(nextPassword) : this.accounts.current?.passwordHash;
    if (!hash) throw new HttpError(500, '管理员账号文件不存在');
    await this.accounts.set(normalized, hash);
    await this.store.mutate((db) => {
      // Rotate the signing secret so every previously issued session is invalid.
      db.secret = randomBytes(32).toString('hex');
    });
  }

  createSession(): string {
    const expiresAt = Date.now() + config.sessionDays * 24 * 60 * 60 * 1000;
    const payload = `${expiresAt}`;
    const signature = createHmac('sha256', this.store.snapshot.secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  verifySession(token: string | undefined): boolean {
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expiresAt = Number(payload);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
    const expected = createHmac('sha256', this.store.snapshot.secret).update(payload).digest('base64url');
    return safeEqualStrings(signature, expected);
  }

  sessionFromRequest(req: Request): string | undefined {
    return parseCookies(req.headers.cookie)[COOKIE_NAME];
  }

  isAuthenticated(req: Request): boolean {
    return this.verifySession(this.sessionFromRequest(req));
  }

  setCookie(req: Request, res: Response): void {
    const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim() === 'https';
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(this.createSession())}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${config.sessionDays * 24 * 60 * 60}`,
    ];
    if (secure) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  clearCookie(res: Response): void {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  middleware = (req: Request, _res: Response, next: NextFunction): void => {
    req.authenticated = this.isAuthenticated(req);
    next();
  };

  requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.authenticated || this.isAuthenticated(req)) {
      req.authenticated = true;
      next();
      return;
    }
    next(new HttpError(401, '请先登录'));
  };
}
