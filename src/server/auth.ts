import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
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

export class Auth {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  get envManaged(): boolean {
    return config.envPassword.length > 0;
  }

  get passwordSet(): boolean {
    return this.envManaged || Boolean(this.store.snapshot.passwordHash);
  }

  get setupRequired(): boolean {
    return !this.passwordSet;
  }

  async setup(password: string): Promise<void> {
    if (this.setupRequired === false) {
      throw new HttpError(409, '管理员密码已设置');
    }
    if (password.length < 8) {
      throw new HttpError(400, '密码至少需要 8 个字符');
    }
    const hash = await hashPassword(password);
    await this.store.mutate((db) => {
      db.passwordHash = hash;
    });
  }

  async verify(password: string): Promise<boolean> {
    if (this.envManaged) {
      return safeEqualStrings(password, config.envPassword);
    }
    const hash = this.store.snapshot.passwordHash;
    if (!hash) return false;
    return comparePassword(password, hash);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (this.envManaged) {
      throw new HttpError(400, '密码由 STREAMPULSE_PASSWORD 环境变量管理，无法在界面修改');
    }
    if (!(await this.verify(currentPassword))) {
      throw new HttpError(403, '当前密码不正确');
    }
    if (newPassword.length < 8) {
      throw new HttpError(400, '新密码至少需要 8 个字符');
    }
    const hash = await hashPassword(newPassword);
    await this.store.mutate((db) => {
      db.passwordHash = hash;
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
