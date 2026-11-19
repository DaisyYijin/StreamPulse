import fs from 'node:fs/promises';
import path from 'node:path';

export interface AdminAccount {
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyAccount {
  username: string;
  passwordHash: string;
}

export class AccountStore {
  readonly dir: string;
  private account: AdminAccount | null = null;
  private filePath = '';

  constructor(configDir: string) {
    this.dir = path.join(configDir, 'accounts');
  }

  get file(): string {
    return this.filePath;
  }

  async init(legacy?: LegacyAccount | null): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o750 });
    const files = (await fs.readdir(this.dir).catch(() => [] as string[]))
      .filter((file) => file.endsWith('.json'))
      .sort();

    for (const file of files) {
      const full = path.join(this.dir, file);
      try {
        const raw = JSON.parse(await fs.readFile(full, 'utf8')) as Partial<AdminAccount>;
        if (raw.username && raw.passwordHash) {
          this.account = {
            username: raw.username,
            passwordHash: raw.passwordHash,
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
          };
          this.filePath = full;
          if (path.basename(full) !== `${this.account.username}.json`) {
            await this.set(this.account.username, this.account.passwordHash);
          }
          return;
        }
      } catch {
        // Ignore malformed account files and try the next one.
      }
    }

    if (legacy?.passwordHash) {
      await this.set(legacy.username || 'admin', legacy.passwordHash);
    }
  }

  get current(): AdminAccount | null {
    return this.account;
  }

  async set(username: string, passwordHash: string): Promise<void> {
    const now = new Date().toISOString();
    const next: AdminAccount = {
      username,
      passwordHash,
      createdAt: this.account?.createdAt || now,
      updatedAt: now,
    };
    const nextPath = path.join(this.dir, `${username}.json`);
    const temporary = `${nextPath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporary, nextPath);
    if (this.filePath && this.filePath !== nextPath) {
      await fs.unlink(this.filePath).catch(() => undefined);
    }
    this.filePath = nextPath;
    this.account = next;
  }
}
