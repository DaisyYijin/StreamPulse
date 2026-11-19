import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type {
  BrowseEntry,
  BrowseResult,
  Overview,
  PreviewFile,
  PreviewResult,
} from '../../shared/types.js';
import { APP_NAME } from '../../shared/types.js';
import type { Auth } from '../auth.js';
import { clientForSource } from '../client.js';
import { PathSafetyError, normalizeExtensions, normalizeSourcePath, normalizeTargetPath, strmRelativePath } from '../core/paths.js';
import { renderUrlTemplate, TemplateError, validateUrlTemplate } from '../core/template.js';
import { config } from '../config.js';
import { OpenListError } from '../openlist.js';
import type { RunEvent, RunManager } from '../runner.js';
import { isTimezone, type Scheduler } from '../scheduler.js';
import { scanLibrary } from '../scanner.js';
import type { Store } from '../store.js';
import { HttpError, makeId, makeStreamKey, nowIso, type LibraryRecord, type SourceRecord } from '../types.js';
import { libraryToPublic, runToPublic, sourceToPublic, systemInfo } from './helpers.js';
import {
  accountUpdateSchema,
  libraryCreateSchema,
  libraryUpdateSchema,
  loginSchema,
  runOptionsSchema,
  normalizeBaseUrl,
  normalizePublicUrl,
  normalizeStreamBaseUrl,
  parseBody,
  settingsUpdateSchema,
  setupSchema,
  sourceCreateSchema,
  sourceUpdateSchema,
  validateSchedule,
} from './schemas.js';

interface ApiDeps {
  store: Store;
  auth: Auth;
  runner: RunManager;
  scheduler: Scheduler;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idOf(req: Request): string {
  return String(req.params.id ?? '');
}

function requestStreamBase(req: Request): string {
  const hostname = req.hostname.includes(':') && !req.hostname.startsWith('[')
    ? `[${req.hostname}]`
    : req.hostname;
  return `${req.protocol}://${hostname || 'localhost'}:${config.streamPort}`;
}

function mapOpenListError(error: unknown): never {
  if (error instanceof OpenListError) {
    const status = error.status === 401 ? 400 : error.status >= 400 && error.status < 500 ? error.status : 502;
    throw new HttpError(status, error.message);
  }
  if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
    const status = Number((error as { status: unknown }).status);
    if (Number.isFinite(status) && status >= 400) {
      throw new HttpError(status >= 500 ? 502 : status, String((error as { message: unknown }).message));
    }
  }
  throw error;
}

function validateLibraryInput(input: {
  sourcePath: string;
  targetPath: string;
  urlTemplate: string;
  schedule: string;
  extensions: string[];
}): { sourcePath: string; targetPath: string; extensions: string[] } {
  let sourcePath: string;
  let targetPath: string;
  try {
    sourcePath = normalizeSourcePath(input.sourcePath);
    targetPath = normalizeTargetPath(input.targetPath);
  } catch (error) {
    if (error instanceof PathSafetyError) throw new HttpError(400, error.message);
    throw error;
  }
  try {
    validateUrlTemplate(input.urlTemplate);
  } catch (error) {
    if (error instanceof TemplateError) throw new HttpError(400, error.message);
    throw error;
  }
  validateSchedule(input.schedule);
  const extensions = normalizeExtensions(input.extensions);
  if (extensions.length === 0) throw new HttpError(400, '至少配置一个有效的视频扩展名');
  return { sourcePath, targetPath, extensions };
}

function checkSourceCredentials(
  source: Pick<SourceRecord, 'type' | 'authType' | 'token' | 'username' | 'password' | 'cookie'>,
): void {
  if (source.type === '115') {
    if (!source.cookie) throw new HttpError(400, '115 账号需要填写浏览器 Cookie');
    return;
  }
  if (source.type === '123') {
    if (!source.username || !source.password) {
      throw new HttpError(400, '123 云盘需要填写账号和密码');
    }
    return;
  }
  if (source.authType === 'token' && !source.token) {
    throw new HttpError(400, '令牌模式需要填写访问令牌');
  }
  if (source.authType === 'password' && (!source.username || !source.password)) {
    throw new HttpError(400, '账号模式需要填写用户名与密码');
  }
}

function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function buildOverview(store: Store, runner: RunManager, scheduler: Scheduler): Omit<Overview, 'system'> {
  const libraries = store.snapshot.libraries.map((library) =>
    libraryToPublic(library, store, scheduler),
  );
  const runs = store.snapshot.runs;
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const recent = runs.filter((run) => new Date(run.createdAt).getTime() >= cutoff);
  const finished = recent.filter((run) =>
    ['success', 'partial', 'failed', 'cancelled', 'interrupted'].includes(run.status),
  );
  const successful = finished.filter((run) => run.status === 'success' || run.status === 'partial');
  const timezone = store.snapshot.settings.timezone;
  const activityMap = new Map<string, { generated: number; failed: number }>();
  const days: Array<{ date: string; generated: number; failed: number }> = [];
  for (let index = 13; index >= 0; index -= 1) {
    const key = dayKey(new Date(now - index * 24 * 60 * 60 * 1000), timezone);
    activityMap.set(key, { generated: 0, failed: 0 });
  }
  for (const run of runs) {
    const timestamp = run.finishedAt || run.startedAt || run.createdAt;
    const key = dayKey(new Date(timestamp), timezone);
    const bucket = activityMap.get(key);
    if (!bucket) continue;
    bucket.generated += run.stats.generated;
    if (run.status === 'failed' || run.status === 'interrupted') bucket.failed += 1;
  }
  for (const [date, value] of activityMap) days.push({ date, ...value });

  const upcoming = libraries
    .filter((library) => library.enabled && library.nextRunAt)
    .sort((left, right) => String(left.nextRunAt).localeCompare(String(right.nextRunAt)));

  return {
    counts: {
      sources: store.snapshot.sources.length,
      libraries: libraries.length,
      files: libraries.reduce((total, library) => total + library.fileCount, 0),
      activeRuns: runner.runningCount,
      queuedRuns: runner.queuedCount,
    },
    last7d: {
      runs: finished.length,
      generated: successful.reduce((total, run) => total + run.stats.generated, 0),
      failed: finished.filter((run) => run.status === 'failed').length,
      successRate:
        finished.length === 0 ? 100 : Math.round((successful.length / finished.length) * 100),
    },
    activity: days,
    recentRuns: runs.slice(0, 6).map((run) => runToPublic(run)),
    libraries,
    nextRun: upcoming[0]
      ? {
          libraryId: upcoming[0].id,
          libraryName: upcoming[0].name,
          at: upcoming[0].nextRunAt!,
        }
      : null,
  };
}

export function createApiRouter({ store, auth, runner, scheduler }: ApiDeps): Router {
  const router = Router();
  const attempts = new Map<string, { count: number; resetAt: number }>();

  const loginGuard = (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < Date.now()) {
      attempts.set(key, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
      next();
      return;
    }
    if (entry.count >= 12) {
      next(new HttpError(429, '尝试次数过多，请 15 分钟后再试'));
      return;
    }
    next();
  };

  const failLogin = (req: Request): void => {
    const entry = attempts.get(req.ip || 'unknown');
    if (entry) entry.count += 1;
  };

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: APP_NAME,
      version: config.version,
      uptime: Math.floor(process.uptime()),
      timestamp: nowIso(),
    });
  });

  router.get('/auth/status', (req, res) => {
    res.json({
      setupRequired: auth.setupRequired,
      authenticated: auth.isAuthenticated(req),
      envManaged: auth.envManaged,
      username: auth.username,
      appName: APP_NAME,
      version: config.version,
    });
  });

  router.post('/auth/login', loginGuard, async (req, res) => {
    const body = parseBody(loginSchema, req.body);
    if (auth.setupRequired) throw new HttpError(409, '请先创建管理员账号');
    if (!(await auth.verify(body.username, body.password))) {
      failLogin(req);
      throw new HttpError(401, '账号或密码错误');
    }
    attempts.delete(req.ip || 'unknown');
    auth.setCookie(req, res);
    res.json({ ok: true });
  });

  router.post('/auth/setup', async (req, res) => {
    const body = parseBody(setupSchema, req.body);
    await auth.setup(body.username, body.password);
    auth.setCookie(req, res);
    res.status(201).json({ ok: true, username: auth.username });
  });

  router.post('/auth/logout', (_req, res) => {
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  router.use(auth.requireAuth);

  router.post('/auth/account', async (req, res) => {
    const body = parseBody(accountUpdateSchema, req.body);
    await auth.changeCredentials(
      body.currentPassword,
      body.username,
      body.newPassword || undefined,
    );
    auth.setCookie(req, res);
    res.json({ ok: true, username: auth.username });
  });

  router.get('/overview', async (_req, res) => {
    const overview: Overview = {
      ...buildOverview(store, runner, scheduler),
      system: await systemInfo(store),
    };
    res.json(overview);
  });

  router.get('/system', async (_req, res) => {
    res.json(await systemInfo(store));
  });

  router.get('/sources', (_req, res) => {
    res.json(store.snapshot.sources.map(sourceToPublic));
  });

  router.post('/sources', async (req, res) => {
    const body = parseBody(sourceCreateSchema, req.body);
    const baseUrl = body.type === 'openlist' ? normalizeBaseUrl(body.baseUrl) : '';
    const publicUrl = body.type === 'openlist' ? normalizePublicUrl(body.publicUrl || '') : '';
    const draft: SourceRecord = {
      id: makeId('src'),
      name: body.name,
      type: body.type,
      baseUrl,
      publicUrl,
      authType: body.authType,
      username: body.username ?? '',
      token: body.token ?? '',
      password: body.password ?? '',
      cookie: body.cookie ?? '',
      streamKey: makeStreamKey(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastCheck: null,
    };
    checkSourceCredentials(draft);
    await store.mutate((db) => {
      db.sources.unshift(draft);
    });
    res.status(201).json(sourceToPublic(draft));
  });

  router.patch('/sources/:id', async (req, res) => {
    const body = parseBody(sourceUpdateSchema, req.body);
    const source = store.source(idOf(req));
    if (!source) throw new HttpError(404, '来源不存在');
    const next: SourceRecord = {
      ...source,
      name: body.name ?? source.name,
      type: body.type ?? source.type,
      baseUrl:
        (body.type ?? source.type) === 'openlist' && body.baseUrl !== undefined
          ? normalizeBaseUrl(body.baseUrl)
          : (body.type ?? source.type) === 'openlist'
            ? source.baseUrl
            : '',
      publicUrl:
        (body.type ?? source.type) === 'openlist' && body.publicUrl !== undefined
          ? normalizePublicUrl(body.publicUrl)
          : (body.type ?? source.type) === 'openlist'
            ? source.publicUrl
            : '',
      authType: body.authType ?? source.authType,
      username: body.username !== undefined ? body.username : source.username,
      token: body.token !== undefined ? body.token : source.token,
      password: body.password !== undefined ? body.password : source.password,
      cookie: body.cookie !== undefined ? body.cookie : source.cookie,
      updatedAt: nowIso(),
      lastCheck: null,
    };
    checkSourceCredentials(next);
    await store.mutate((db) => {
      const index = db.sources.findIndex((item) => item.id === source.id);
      db.sources[index] = next;
    });
    res.json(sourceToPublic(next));
  });

  router.delete('/sources/:id', async (req, res) => {
    const id = idOf(req);
    const source = store.source(id);
    if (!source) throw new HttpError(404, '来源不存在');
    const used = store.snapshot.libraries.filter((library) => library.sourceId === id);
    if (used.length > 0) {
      throw new HttpError(409, `仍有 ${used.length} 个媒体库使用该来源，请先移除或修改`);
    }
    await store.mutate((db) => {
      db.sources = db.sources.filter((item) => item.id !== id);
    });
    res.status(204).end();
  });

  router.post('/sources/:id/test', async (req, res) => {
    const source = store.source(idOf(req));
    if (!source) throw new HttpError(404, '来源不存在');
    const started = Date.now();
    try {
      const result = await clientForSource(source).testConnection(AbortSignal.timeout(30_000));
      const latencyMs = Date.now() - started;
      source.lastCheck = {
        ok: true,
        message: `${result.message} · ${result.sampleCount} 个根目录条目`,
        at: nowIso(),
      };
      source.updatedAt = nowIso();
      await store.save();
      res.json({
        ok: true,
        message: source.lastCheck.message,
        latencyMs,
        sampleCount: result.sampleCount,
      });
    } catch (error) {
      source.lastCheck = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        at: nowIso(),
      };
      await store.save().catch(() => undefined);
      mapOpenListError(error);
    }
  });

  router.get('/sources/:id/browse', async (req, res) => {
    const source = store.source(idOf(req));
    if (!source) throw new HttpError(404, '来源不存在');
    let requested: string;
    try {
      requested = normalizeSourcePath(asString(req.query.path) || '/');
    } catch (error) {
      if (error instanceof PathSafetyError) throw new HttpError(400, error.message);
      throw error;
    }
    try {
      const entries = await clientForSource(source).list(requested);
      const mapped: BrowseEntry[] = entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: requested === '/' ? `/${entry.name}` : `${requested}/${entry.name}`,
          isDir: entry.isDir,
          size: entry.size,
          modified: entry.modified,
        }))
        .sort((left, right) => {
          if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
          return left.name.localeCompare(right.name, 'zh-CN');
        });
      const result: BrowseResult = { path: requested, entries: mapped };
      res.json(result);
    } catch (error) {
      mapOpenListError(error);
    }
  });

  router.get('/libraries', (_req, res) => {
    res.json(store.snapshot.libraries.map((library) => libraryToPublic(library, store, scheduler)));
  });

  router.post('/libraries', async (req, res) => {
    const body = parseBody(libraryCreateSchema, req.body);
    if (!store.source(body.sourceId)) throw new HttpError(400, '选择的来源不存在');
    const validated = validateLibraryInput(body);
    const deriveStreamBase =
      !store.snapshot.settings.streamBaseUrl && body.urlTemplate.includes('{streamBase}')
        ? requestStreamBase(req)
        : '';
    const now = nowIso();
    const library: LibraryRecord = {
      id: makeId('lib'),
      name: body.name,
      sourceId: body.sourceId,
      ...validated,
      urlTemplate: body.urlTemplate,
      excludePatterns: body.excludePatterns ?? [],
      minSizeMB: body.minSizeMB ?? 0,
      enabled: body.enabled ?? true,
      incremental: body.incremental ?? true,
      deleteOrphans: body.deleteOrphans ?? false,
      schedule: body.schedule ?? '',
      watchInterval: body.watchInterval ?? 0,
      fileCount: 0,
      totalRuns: 0,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    await store.mutate((db) => {
      if (deriveStreamBase && !db.settings.streamBaseUrl) {
        db.settings.streamBaseUrl = deriveStreamBase;
      }
      db.libraries.unshift(library);
    });
    scheduler.reload();
    res.status(201).json(libraryToPublic(library, store, scheduler));
  });

  router.patch('/libraries/:id', async (req, res) => {
    const body = parseBody(libraryUpdateSchema, req.body);
    const library = store.library(idOf(req));
    if (!library) throw new HttpError(404, '媒体库不存在');
    if (body.sourceId !== undefined && !store.source(body.sourceId)) {
      throw new HttpError(400, '选择的来源不存在');
    }
    const merged: LibraryRecord = {
      ...library,
      ...body,
      sourceId: body.sourceId ?? library.sourceId,
      sourcePath: body.sourcePath ?? library.sourcePath,
      targetPath: body.targetPath ?? library.targetPath,
      urlTemplate: body.urlTemplate ?? library.urlTemplate,
      extensions: body.extensions ?? library.extensions,
      excludePatterns: body.excludePatterns ?? library.excludePatterns,
      minSizeMB: body.minSizeMB ?? library.minSizeMB,
      enabled: body.enabled ?? library.enabled,
      incremental: body.incremental ?? library.incremental,
      deleteOrphans: body.deleteOrphans ?? library.deleteOrphans,
      schedule: body.schedule ?? library.schedule,
      watchInterval: body.watchInterval ?? library.watchInterval,
      updatedAt: nowIso(),
    };
    const validated = validateLibraryInput(merged);
    Object.assign(merged, validated);
    const deriveStreamBase =
      !store.snapshot.settings.streamBaseUrl && merged.urlTemplate.includes('{streamBase}')
        ? requestStreamBase(req)
        : '';
    await store.mutate((db) => {
      if (deriveStreamBase && !db.settings.streamBaseUrl) {
        db.settings.streamBaseUrl = deriveStreamBase;
      }
      const index = db.libraries.findIndex((item) => item.id === library.id);
      db.libraries[index] = merged;
    });
    scheduler.reload();
    res.json(libraryToPublic(merged, store, scheduler));
  });

  router.delete('/libraries/:id', async (req, res) => {
    const library = store.library(idOf(req));
    if (!library) throw new HttpError(404, '媒体库不存在');
    if (runner.isLibraryBusy(library.id)) throw new HttpError(409, '请先取消正在运行的任务');
    await store.mutate((db) => {
      db.libraries = db.libraries.filter((item) => item.id !== library.id);
    });
    await fs.unlink(path.join(store.manifestDir, `${library.id}.json`)).catch(() => undefined);
    scheduler.reload();
    res.status(204).end();
  });

  router.post('/libraries/run-all', async (_req, res) => {
    res.status(202).json(await runner.startAll('all'));
  });

  router.post('/libraries/:id/run', async (req, res) => {
    const library = store.library(idOf(req));
    if (!library) throw new HttpError(404, '媒体库不存在');
    const body = parseBody(runOptionsSchema, req.body ?? {});
    const run = await runner.start(
      library.id,
      'manual',
      body.mode ? { full: body.mode === 'full' } : {},
    );
    res.status(202).json(run);
  });

  router.post('/libraries/:id/preview', async (req, res) => {
    const library = store.library(idOf(req));
    if (!library) throw new HttpError(404, '媒体库不存在');
    const source = store.source(library.sourceId);
    if (!source) throw new HttpError(400, '媒体库关联的来源已被删除');
    try {
      validateUrlTemplate(library.urlTemplate);
      const streamBase = store.snapshot.settings.streamBaseUrl || requestStreamBase(req);
      const scan = await scanLibrary(clientForSource(source), library, {
        signal: AbortSignal.timeout(60_000),
      });
      const samples: PreviewFile[] = [];
      for (const file of scan.files.slice(0, 20)) {
        const url = renderUrlTemplate(library.urlTemplate, {
          sourceUrl: source.publicUrl || source.baseUrl,
          path: file.path,
          file: file.name,
          ext: file.extension,
          streamBase,
          streamToken: source.streamKey,
        });
        samples.push({
          sourcePath: file.path,
          strmPath: strmRelativePath(library.targetPath, file.relative),
          url,
          size: file.size,
          modified: file.modified,
        });
      }
      const result: PreviewResult = {
        totalMatched: scan.files.length,
        scanned: scan.scanned,
        extensions: scan.extensions,
        samples,
        truncated: scan.files.length > samples.length,
      };
      res.json(result);
    } catch (error) {
      if (error instanceof TemplateError) throw new HttpError(400, error.message);
      if (error instanceof OpenListError) mapOpenListError(error);
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new HttpError(504, '预览超时，请缩小媒体库目录或稍后重试');
      }
      throw error;
    }
  });

  router.get('/runs', (req, res) => {
    const limitParam = Number.parseInt(asString(req.query.limit) || '50', 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;
    const status = asString(req.query.status);
    let runs = store.snapshot.runs;
    if (status && status !== 'all') runs = runs.filter((run) => run.status === status);
    res.json(runs.slice(0, limit).map((run) => runToPublic(run)));
  });

  router.get('/runs/:id', (req, res) => {
    const run = runner.getRun(idOf(req));
    if (!run) throw new HttpError(404, '任务不存在');
    res.json(runToPublic(run, true));
  });

  router.post('/runs/:id/cancel', async (req, res) => {
    res.json(await runner.cancel(idOf(req)));
  });

  router.delete('/runs', async (_req, res) => {
    const active = store.snapshot.runs.filter(
      (run) => run.status === 'running' || run.status === 'queued',
    );
    await store.mutate((db) => {
      db.runs = active;
    });
    res.json({ ok: true, kept: active.length });
  });

  router.get('/runs/:id/events', (req, res) => {
    const runId = idOf(req);
    const run = runner.getRun(runId);
    if (!run) throw new HttpError(404, '任务不存在');
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');

    let closed = false;
    let ready = false;
    const buffered: RunEvent[] = [];
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 20_000);

    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };

    const send = (event: unknown) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = runner.subscribe(runId, (event) => {
      if (!ready) {
        buffered.push(event);
        return;
      }
      send(event);
      if (event.type === 'done') finish();
    });

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });

    send({ type: 'snapshot', run: runToPublic(runner.getRun(runId) ?? run, true) });
    if (['success', 'partial', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
      finish();
      return;
    }
    ready = true;
    for (const event of buffered) {
      send(event);
      if (event.type === 'done') {
        finish();
        break;
      }
    }
  });

  router.get('/settings', async (_req, res) => {
    res.json({ settings: store.snapshot.settings, system: await systemInfo(store) });
  });

  router.patch('/settings', async (req, res) => {
    const body = parseBody(settingsUpdateSchema, req.body);
    if (body.timezone !== undefined && !isTimezone(body.timezone)) {
      throw new HttpError(400, '时区无效，例如 Asia/Shanghai');
    }
    if (body.defaultUrlTemplate !== undefined) {
      try {
        validateUrlTemplate(body.defaultUrlTemplate);
      } catch (error) {
        if (error instanceof TemplateError) throw new HttpError(400, error.message);
        throw error;
      }
    }
    const normalizedStreamBase =
      body.streamBaseUrl !== undefined ? normalizeStreamBaseUrl(body.streamBaseUrl) : undefined;
    const streamBaseUrl =
      normalizedStreamBase === '' ? requestStreamBase(req) : normalizedStreamBase;
    let outputDir: string | undefined;
    if (body.outputDir !== undefined) {
      if (!path.isAbsolute(body.outputDir)) {
        throw new HttpError(400, '输出目录必须是绝对路径');
      }
      outputDir = path.resolve(body.outputDir);
      try {
        await fs.mkdir(outputDir, { recursive: true });
        const probe = path.join(outputDir, '.streampulse-write-test');
        await fs.writeFile(probe, 'ok', 'utf8');
        await fs.unlink(probe);
      } catch (error) {
        throw new HttpError(400, `输出目录不可写：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await store.mutate((db) => {
      if (outputDir) db.settings.outputDir = outputDir;
      if (body.timezone !== undefined) db.settings.timezone = body.timezone;
      if (body.defaultUrlTemplate !== undefined) {
        db.settings.defaultUrlTemplate = body.defaultUrlTemplate;
      }
      if (streamBaseUrl !== undefined) db.settings.streamBaseUrl = streamBaseUrl;
      if (body.maxConcurrentRuns !== undefined) {
        db.settings.maxConcurrentRuns = body.maxConcurrentRuns;
      }
      if (body.runRetention !== undefined) db.settings.runRetention = body.runRetention;
    });
    store.trimRuns();
    await store.save();
    scheduler.reload();
    res.json({ settings: store.snapshot.settings, system: await systemInfo(store) });
  });

  return router;
}
