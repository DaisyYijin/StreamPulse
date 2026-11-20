import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ORGANIZE_CATEGORIES, DEFAULT_URL_TEMPLATE, type Settings } from '../shared/types.js';
import { config } from './config.js';
import {
  makeStreamKey,
  nowIso,
  type Database,
  type LibraryRecord,
  type SourceRecord,
} from './types.js';

interface SettingsFile {
  schemaVersion: 1;
  secret: string;
  settings: Settings;
  createdAt: string;
  updatedAt: string;
}

interface LegacyCredentialFile {
  token?: string;
  password?: string;
  username?: string;
  authType?: 'token' | 'password';
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
      organizer: {
        sourceId: '',
        sourcePath: '/Inbox',
        failedPath: '/Failed',
        redundantPath: '/Redundant',
        libraryPath: '/Media',
        libraryId: '',
        mode: 'move',
        upgradeStrategy: 'better',
        tmdbApiKey: '',
        tmdbLanguage: 'zh-CN',
        categories: DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category })),
      },
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
        type: record.type || 'openlist',
        cookie: record.cookie || '',
        profile: record.profile ?? null,
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
    libraries: (Array.isArray(input.libraries) ? input.libraries.filter(Boolean) : []).map(
      (library) => ({
        ...library,
        streamBaseUrl: (library as LibraryRecord).streamBaseUrl || '',
        watchInterval:
          typeof (library as LibraryRecord).watchInterval === 'number'
            ? (library as LibraryRecord).watchInterval
            : 0,
      }),
    ),
    runs: Array.isArray(input.runs) ? input.runs.filter(Boolean) : [],
    settings: {
      ...base.settings,
      ...(input.settings ?? {}),
      streamBaseUrl:
        typeof input.settings?.streamBaseUrl === 'string' ? input.settings.streamBaseUrl : base.settings.streamBaseUrl,
      organizer: {
        ...base.settings.organizer,
        ...(input.settings?.organizer ?? {}),
        categories: Array.isArray(input.settings?.organizer?.categories) && input.settings.organizer.categories.length
          ? input.settings.organizer.categories
          : base.settings.organizer.categories,
      },
    },
    createdAt: input.createdAt || base.createdAt,
    updatedAt: input.updatedAt || base.updatedAt,
  };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}

async function listJson(directory: string): Promise<string[]> {
  return (await fs.readdir(directory).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.json'))
    .sort();
}

async function pruneJson(directory: string, activeIds: Set<string>): Promise<void> {
  for (const file of await listJson(directory)) {
    if (!activeIds.has(file.slice(0, -5))) {
      await fs.unlink(path.join(directory, file)).catch(() => undefined);
    }
  }
}

export class Store {
  readonly configDir: string;
  readonly stateDir: string;
  readonly accountsDir: string;
  readonly credentialsDir: string;
  readonly librariesDir: string;
  readonly runsDir: string;
  readonly manifestDir: string;
  readonly settingsFile: string;
  readonly legacyFile: string;
  readonly legacyManifestDir: string;
  data!: Database;
  private needsMigration = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(configDir = config.configDir, stateDir = config.stateDir) {
    this.configDir = configDir;
    this.stateDir = stateDir;
    this.accountsDir = path.join(configDir, 'accounts');
    this.credentialsDir = path.join(configDir, 'sources');
    this.librariesDir = path.join(configDir, 'libraries');
    this.runsDir = path.join(stateDir, 'runs');
    this.manifestDir = path.join(stateDir, 'manifests');
    this.settingsFile = path.join(configDir, 'settings.json');
    this.legacyFile = path.join(configDir, 'streampulse.json');
    this.legacyManifestDir = path.join(configDir, 'manifests');
  }

  async init(): Promise<void> {
    await Promise.all([
      fs.mkdir(this.configDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(this.accountsDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(this.credentialsDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(this.librariesDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(this.stateDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(this.runsDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(this.manifestDir, { recursive: true, mode: 0o750 }),
      fs.mkdir(config.outputDir, { recursive: true }).catch(() => undefined),
    ]);

    const settings = await readJson<SettingsFile>(this.settingsFile);
    if (settings) {
      this.data = await this.loadSplit(settings);
      await this.save();
      await this.cleanupLegacyArtifacts();
      return;
    }

    const legacy = await readJson<unknown>(this.legacyFile);
    if (legacy) {
      this.data = normalizeDatabase(legacy);
      await this.loadLegacyCredentials();
      this.needsMigration = true;
      return;
    }

    this.data = createDefaultDatabase();
    await this.save();
  }

  private async loadSplit(settings: SettingsFile): Promise<Database> {
    const base = createDefaultDatabase();
    const sources = (await Promise.all(
      (await listJson(this.credentialsDir)).map((file) =>
        readJson<SourceRecord>(path.join(this.credentialsDir, file)),
      ),
    )).filter((source): source is SourceRecord => Boolean(source?.id))
      .map((source) => ({
        ...source,
        type: source.type || 'openlist',
        cookie: source.cookie || '',
        token: source.token || '',
        password: source.password || '',
        username: source.username || '',
        profile: source.profile ?? null,
      }));
    const libraries = (await Promise.all(
      (await listJson(this.librariesDir)).map((file) =>
        readJson<LibraryRecord>(path.join(this.librariesDir, file)),
      ),
    ))
      .filter((library): library is LibraryRecord => Boolean(library?.id))
      .map((library) => ({ ...library, streamBaseUrl: library.streamBaseUrl ?? '', watchInterval: library.watchInterval ?? 0 }));
    const runs = (await Promise.all(
      (await listJson(this.runsDir)).map((file) =>
        readJson<Database['runs'][number]>(path.join(this.runsDir, file)),
      ),
    ))
      .filter((run): run is Database['runs'][number] => Boolean(run?.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    for (const source of sources) {
      if (!source.streamKey || source.streamKey.length < 16) source.streamKey = makeStreamKey();
    }

    return {
      ...base,
      secret: typeof settings.secret === 'string' && settings.secret.length >= 32 ? settings.secret : base.secret,
      sources,
      libraries,
      runs,
      settings: {
        ...base.settings,
        ...(settings.settings ?? {}),
        organizer: {
          ...base.settings.organizer,
          ...(settings.settings?.organizer ?? {}),
          categories: Array.isArray(settings.settings?.organizer?.categories) && settings.settings.organizer.categories.length
            ? settings.settings.organizer.categories
            : base.settings.organizer.categories,
        },
      },
      createdAt: settings.createdAt || base.createdAt,
      updatedAt: settings.updatedAt || base.updatedAt,
    };
  }

  private async loadLegacyCredentials(): Promise<void> {
    for (const source of this.data.sources) {
      const legacy = await readJson<LegacyCredentialFile>(
        path.join(this.credentialsDir, `${source.id}.json`),
      );
      if (!legacy) continue;
      if (typeof legacy.token === 'string') source.token = legacy.token;
      if (typeof legacy.password === 'string') source.password = legacy.password;
      if (typeof legacy.username === 'string') source.username = legacy.username;
      if (legacy.authType === 'token' || legacy.authType === 'password') {
        source.authType = legacy.authType;
      }
    }
  }

  private settingsDocument(): SettingsFile {
    return {
      schemaVersion: 1,
      secret: this.data.secret,
      settings: this.data.settings,
      createdAt: this.data.createdAt,
      updatedAt: this.data.updatedAt,
    };
  }

  private async cleanupLegacyArtifacts(): Promise<void> {
    await fs.unlink(this.legacyFile).catch(() => undefined);
    await fs.rm(this.legacyManifestDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async archiveLegacy(): Promise<void> {
    await fs.mkdir(this.manifestDir, { recursive: true, mode: 0o750 });
    const oldManifests = await fs.readdir(this.legacyManifestDir).catch(() => [] as string[]);
    for (const file of oldManifests) {
      const target = path.join(this.manifestDir, file);
      const exists = await fs.access(target).then(() => true).catch(() => false);
      if (!exists) {
        await fs.copyFile(path.join(this.legacyManifestDir, file), target).catch(() => undefined);
      }
    }
    await fs.rm(this.legacyManifestDir, { recursive: true, force: true }).catch(() => undefined);
    // The legacy aggregate file may contain old credentials. All data has been
    // split into dedicated files, so remove it instead of leaving a second copy.
    await fs.unlink(this.legacyFile).catch(() => undefined);
  }

  private async writeCollection<T extends { id: string }>(
    directory: string,
    items: T[],
  ): Promise<void> {
    await fs.mkdir(directory, { recursive: true, mode: 0o750 });
    for (const item of items) {
      await writeJson(path.join(directory, `${item.id}.json`), item);
    }
    await pruneJson(directory, new Set(items.map((item) => item.id)));
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
    this.trimRuns();
    const snapshot = JSON.parse(JSON.stringify(this.data)) as Database;
    const settingsDocument = this.settingsDocument();
    this.writeChain = this.writeChain.then(async () => {
      // Write collections first: settings.json is the commit marker for a
      // complete configuration. If the process dies mid-save, the legacy DB or
      // the previous settings file still drives recovery on next boot.
      await this.writeCollection(this.credentialsDir, snapshot.sources);
      await this.writeCollection(this.librariesDir, snapshot.libraries);
      await this.writeCollection(this.runsDir, snapshot.runs);
      await writeJson(this.settingsFile, settingsDocument);
      if (this.needsMigration) {
        await this.archiveLegacy();
        this.needsMigration = false;
      }
    });
    await this.writeChain;
  }

  getLegacyAccount(): { username: string; passwordHash: string } | null {
    if (!this.data.passwordHash) return null;
    return { username: this.data.username || 'admin', passwordHash: this.data.passwordHash };
  }

  async clearLegacyAccount(): Promise<void> {
    const needsSave = this.needsMigration || this.data.passwordHash !== null;
    this.data.username = 'admin';
    this.data.passwordHash = null;
    if (needsSave) await this.save();
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
