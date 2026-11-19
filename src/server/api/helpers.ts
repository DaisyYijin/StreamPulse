import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import type {
  Library,
  Run,
  Source,
  SystemInfo,
} from '../../shared/types.js';
import { config } from '../config.js';
import type { Scheduler } from '../scheduler.js';
import type { Store } from '../store.js';
import type { LibraryRecord, SourceRecord } from '../types.js';

export function sourceToPublic(source: SourceRecord): Source {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    baseUrl: source.baseUrl,
    publicUrl: source.publicUrl,
    authType: source.authType,
    username: source.username,
    tokenHint: source.token ? `••••${source.token.slice(-4)}` : null,
    hasToken: Boolean(source.token),
    hasPassword: Boolean(source.password),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    lastCheck: source.lastCheck,
  };
}

export function libraryToPublic(
  library: LibraryRecord,
  store: Store,
  scheduler: Scheduler,
): Library {
  const source = store.source(library.sourceId);
  const timezone = store.snapshot.settings.timezone;
  return {
    ...library,
    sourceName: source?.name ?? '来源已删除',
    nextRunAt: scheduler.nextFor(library, timezone),
  };
}

export function runToPublic(run: Run, includeLogs = false): Run {
  return {
    ...run,
    stats: { ...run.stats },
    logs: includeLogs ? run.logs.map((line) => ({ ...line })) : [],
  };
}

export async function systemInfo(store: Store): Promise<SystemInfo> {
  const outputDir = store.snapshot.settings.outputDir;
  let outputWritable = false;
  try {
    await fs.access(outputDir, constants.W_OK);
    outputWritable = true;
  } catch {
    outputWritable = false;
  }
  let logWritable = false;
  try {
    await fs.access(config.logDir, constants.W_OK);
    logWritable = true;
  } catch {
    logWritable = false;
  }
  let manifestCount = 0;
  try {
    manifestCount = (await fs.readdir(store.manifestDir)).filter((file) => file.endsWith('.json')).length;
  } catch {
    manifestCount = 0;
  }
  return {
    version: config.version,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    dataDir: store.dataDir,
    outputDir,
    outputWritable,
    logDir: config.logDir,
    logWritable,
    manifestCount,
    streamPort: config.streamPort,
    authMode: config.envPassword ? 'env' : store.snapshot.passwordHash ? 'local' : 'setup',
  };
}
