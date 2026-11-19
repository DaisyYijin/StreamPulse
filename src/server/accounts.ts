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
  readonly file: string;
  private account: AdminAccount | null = null;

  constructor(configDir: string) {
    this.dir = path.join(configDir, 'accounts');
    this.file = path.join(this.dir, 'admin.json');
  }

  async init(legacy?: LegacyAccount | null): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o750 });
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<AdminAccount>;
      if (raw.username && raw.passwordHash) {
        this.account = {
          username: raw.username,
          passwordHash: raw.passwordHash,
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || new Date().toISOString(),
        };
        return;
      }
    } catch {
      // Missing or invalid account file; fall back to legacy DB data.
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
    const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporary, this.file);
    this.account = next;
  }
}
