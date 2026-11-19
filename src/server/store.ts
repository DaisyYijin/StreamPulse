import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_URL_TEMPLATE } from '../shared/types.js';
import { config } from './config.js';
import {
  makeStreamKey,
  nowIso,
  type Database,
  type LibraryRecord,
  type SourceRecord,
} from './types.js';

interface SourceCredentialFile {
  id: string;
  name: string;
  username: string;
  authType: 'token' | 'password';
  token: string;
  password: string;
  updatedAt: string;
}

function createDefaultDatabase(): Database {
  const now = nowIso();
  return {
    schemaVersion: 1,
    secret: randomBytes(32).toString('hex'),
    username: 'admin',
    passwordHash: null,
    sources: [],
    libraries: [],
    runs: [],
    settings: {
      outputDir: config.outputDir,
      timezone: process.env.TZ || 'Asia/Shanghai',
      defaultUrlTemplate: DEFAULT_URL_TEMPLATE,
      streamBaseUrl: config.streamPublicUrl,
      maxConcurrentRuns: 2,
      runRetention: config.runRetentionDefault,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDatabase(raw: unknown): Database {
  const base = createDefaultDatabase();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Partial<Database>;
  const sources = (Array.isArray(input.sources) ? input.sources.filter(Boolean) : []).map(
    (source) => {
      const record = source as Partial<SourceRecord>;
      return {
        ...record,
        streamKey:
          typeof record.streamKey === 'string' && record.streamKey.length >= 16
            ? record.streamKey
            : makeStreamKey(),
      } as SourceRecord;
    },
  );
  return {
    ...base,
    ...input,
    schemaVersion: 1,
    secret: typeof input.secret === 'string' && input.secret.length >= 32 ? input.secret : base.secret,
    username: typeof input.username === 'string' && input.username.trim() ? input.username.trim() : 'admin',
    passwordHash: typeof input.passwordHash === 'string' ? input.passwordHash : null,
    sources,
    libraries: Array.isArray(input.libraries) ? input.libraries.filter(Boolean) : [],
    runs: Array.isArray(input.runs) ? input.runs.filter(Boolean) : [],
    settings: {
      ...base.settings,
      ...(input.settings ?? {}),
      streamBaseUrl:
        typeof input.settings?.streamBaseUrl === 'string' ? input.settings.streamBaseUrl : base.settings.streamBaseUrl,
    },
    createdAt: input.createdAt || base.createdAt,
    updatedAt: input.updatedAt || base.updatedAt,
  };
}

function credentialFileFor(directory: string, sourceId: string): string {
  return path.join(directory, `${sourceId}.json`);
}

export class Store {
  readonly configDir: string;
  readonly credentialsDir: string;
  readonly manifestDir: string;
  readonly filePath: string;
  data!: Database;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(configDir = config.configDir) {
    this.configDir = configDir;
    this.credentialsDir = path.join(configDir, 'sources');
    this.manifestDir = path.join(configDir, 'manifests');
    this.filePath = path.join(configDir, 'streampulse.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o750 });
    await fs.mkdir(this.credentialsDir, { recursive: true, mode: 0o750 });
    await fs.mkdir(this.manifestDir, { recursive: true, mode: 0o750 });
    await fs.mkdir(config.outputDir, { recursive: true }).catch(() => undefined);

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = normalizeDatabase(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        await fs.rename(this.filePath, backup).catch(() => undefined);
      }
      this.data = createDefaultDatabase();
      await this.save();
      return;
    }

    await this.loadSourceCredentials();
    await fs.mkdir(this.data.settings.outputDir, { recursive: true }).catch(() => undefined);
    this.data.runs = this.data.runs.slice(0, Math.max(1, this.data.settings.runRetention));
    if (!this.data.settings.streamBaseUrl && config.streamPublicUrl) {
      this.data.settings.streamBaseUrl = config.streamPublicUrl;
    }
    // Persist defaults, generated stream keys, sanitized DB and per-source files.
    await this.save();
  }

  private async loadSourceCredentials(): Promise<void> {
    for (const source of this.data.sources) {
      try {
        const raw = JSON.parse(
          await fs.readFile(credentialFileFor(this.credentialsDir, source.id), 'utf8'),
        ) as Partial<SourceCredentialFile>;
        source.token = typeof raw.token === 'string' ? raw.token : '';
        source.password = typeof raw.password === 'string' ? raw.password : '';
        if (raw.authType === 'token' || raw.authType === 'password') source.authType = raw.authType;
        if (typeof raw.username === 'string') source.username = raw.username;
      } catch {
        // No credential file yet: keep any legacy values from the database.
      }
    }
  }

  private async writeSourceCredentials(sources: SourceRecord[]): Promise<void> {
    await fs.mkdir(this.credentialsDir, { recursive: true, mode: 0o750 });
    const activeIds = new Set(sources.map((source) => source.id));

    for (const source of sources) {
      const payload: SourceCredentialFile = {
        id: source.id,
        name: source.name,
        username: source.username,
        authType: source.authType,
        token: source.token,
        password: source.password,
        updatedAt: source.updatedAt || nowIso(),
      };
      const file = credentialFileFor(this.credentialsDir, source.id);
      const temporary = `${file}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporary, file);
    }

    const files = await fs.readdir(this.credentialsDir).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((file) => file.endsWith('.json') && !activeIds.has(file.slice(0, -5)))
        .map((file) => fs.unlink(path.join(this.credentialsDir, file)).catch(() => undefined)),
    );
  }

  private sanitizedForDisk(): Record<string, unknown> {
    return {
      ...this.data,
      sources: this.data.sources.map((source) => {
        const { token: _token, password: _password, username: _username, ...metadata } = source;
        return metadata;
      }),
    };
  }

  get snapshot(): Database {
    return this.data;
  }

  async mutate<T>(mutator: (db: Database) => T): Promise<T> {
    const result = mutator(this.data);
    this.data.updatedAt = nowIso();
    await this.save();
    return result;
  }

  async touch(): Promise<void> {
    this.data.updatedAt = nowIso();
    await this.save();
  }

  async save(): Promise<void> {
    const sources = this.data.sources.map((source) => ({ ...source }));
    const serialized = JSON.stringify(this.sanitizedForDisk(), null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await this.writeSourceCredentials(sources);
      const temporary = `${this.filePath}.tmp`;
      await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    });
    await this.writeChain;
  }

  getLegacyAccount(): { username: string; passwordHash: string } | null {
    if (!this.data.passwordHash) return null;
    return { username: this.data.username || 'admin', passwordHash: this.data.passwordHash };
  }

  async clearLegacyAccount(): Promise<void> {
    if (!this.data.passwordHash && this.data.username === 'admin') return;
    this.data.username = 'admin';
    this.data.passwordHash = null;
    await this.save();
  }

  source(id: string): SourceRecord | undefined {
    return this.data.sources.find((source) => source.id === id);
  }

  library(id: string): LibraryRecord | undefined {
    return this.data.libraries.find((library) => library.id === id);
  }

  run(id: string): Database['runs'][number] | undefined {
    return this.data.runs.find((run) => run.id === id);
  }

  markInterruptedRuns(): number {
    const now = nowIso();
    let count = 0;
    for (const run of this.data.runs) {
      if (run.status === 'running' || run.status === 'queued') {
        run.status = 'interrupted';
        run.finishedAt = now;
        run.message = '服务重启，任务已中断';
        run.logs.push({ at: now, level: 'warn', message: run.message });
        count += 1;
      }
    }
    if (count > 0) {
      for (const library of this.data.libraries) {
        if (library.lastRunStatus === 'running' || library.lastRunStatus === 'queued') {
          library.lastRunStatus = 'interrupted';
        }
      }
      this.data.updatedAt = now;
    }
    return count;
  }

  trimRuns(): void {
    const retention = Math.max(10, this.data.settings.runRetention);
    if (this.data.runs.length > retention) {
      this.data.runs = this.data.runs.slice(0, retention);
    }
  }
}
