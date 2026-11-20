import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LogLine, LogLevel, Run, RunTrigger } from '../shared/types.js';
import { config } from './config.js';
import { refreshEmbyAfterRun } from './emby.js';
import { notifyRun } from './notify.js';
import { clientForSource } from './client.js';
import { emptyManifest, isUnchanged, type Manifest, type ManifestEntry } from './core/manifest.js';
import { safeJoin, strmRelativePath } from './core/paths.js';
import { renderUrlTemplate } from './core/template.js';
import { scanLibrary } from './scanner.js';
import type { Store } from './store.js';
import { HttpError, makeId, nowIso, type LibraryRecord } from './types.js';

export type RunEvent =
  | { type: 'status'; run: Run }
  | { type: 'log'; line: LogLine }
  | { type: 'done'; run: Run };

interface QueueItem {
  runId: string;
  libraryId: string;
}

interface ActiveRun {
  runId: string;
  libraryId: string;
  controller: AbortController;
}

function emptyStats(): Run['stats'] {
  return { scanned: 0, matched: 0, generated: 0, skipped: 0, deleted: 0, failed: 0 };
}

function publicCopy(run: Run): Run {
  return { ...run, stats: { ...run.stats }, logs: [] };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return '任务已取消';
    return error.message;
  }
  return String(error);
}

async function readManifest(store: Store, libraryId: string): Promise<Manifest> {
  const file = path.join(store.manifestDir, `${libraryId}.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Manifest>;
    return {
      version: 1,
      libraryId,
      updatedAt: parsed.updatedAt || nowIso(),
      entries:
        parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
          ? parsed.entries
          : {},
    };
  } catch {
    return emptyManifest(libraryId);
  }
}

async function writeManifest(store: Store, manifest: Manifest): Promise<void> {
  manifest.updatedAt = nowIso();
  const file = path.join(store.manifestDir, `${manifest.libraryId}.json`);
  const temporary = `${file}.tmp`;
  await fs.mkdir(store.manifestDir, { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(temporary, file);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

export class RunManager {
  private readonly store: Store;
  private readonly bus = new EventEmitter();
  private readonly queue: QueueItem[] = [];
  private readonly active = new Map<string, ActiveRun>();
  private readonly live = new Map<string, Run>();
  private draining = false;
  private stopping = false;

  constructor(store: Store) {
    this.store = store;
    this.bus.setMaxListeners(200);
  }

  async init(): Promise<void> {
    const interrupted = this.store.markInterruptedRuns();
    if (interrupted > 0) await this.store.save();
  }

  get runningCount(): number {
    return this.active.size;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  isLibraryBusy(libraryId: string): boolean {
    return (
      this.queue.some((item) => item.libraryId === libraryId) ||
      Array.from(this.active.values()).some((item) => item.libraryId === libraryId)
    );
  }

  getRun(runId: string): Run | undefined {
    return this.live.get(runId) ?? this.store.run(runId);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const handler = (event: RunEvent) => listener(event);
    this.bus.on(runId, handler);
    return () => this.bus.off(runId, handler);
  }

  async start(
    libraryId: string,
    trigger: RunTrigger = 'manual',
    options: { full?: boolean } = {},
  ): Promise<Run> {
    const library = this.store.library(libraryId);
    if (!library) throw new HttpError(404, '媒体库不存在');
    if (this.isLibraryBusy(libraryId)) {
      throw new HttpError(409, '该媒体库已有任务在运行或排队');
    }
    const source = this.store.source(library.sourceId);
    if (!source) throw new HttpError(400, '媒体库关联的来源已被删除');
    const full = options.full ?? !library.incremental;

    const now = nowIso();
    const run: Run = {
      id: makeId('run'),
      libraryId,
      libraryName: library.name,
      trigger,
      mode: full ? 'full' : 'incremental',
      status: 'queued',
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      stats: emptyStats(),
      message: '等待执行',
      logs: [],
    };
    this.store.snapshot.runs.unshift(run);
    this.store.trimRuns();
    await this.store.save();
    this.queue.push({ runId: run.id, libraryId });
    this.drain();
    return publicCopy(run);
  }

  async startAll(trigger: RunTrigger = 'all'): Promise<{ started: number; skipped: number }> {
    let started = 0;
    let skipped = 0;
    for (const library of this.store.snapshot.libraries) {
      if (!library.enabled) {
        skipped += 1;
        continue;
      }
      try {
        await this.start(library.id, trigger);
        started += 1;
      } catch {
        skipped += 1;
      }
    }
    return { started, skipped };
  }

  async cancel(runId: string): Promise<Run> {
    const active = Array.from(this.active.values()).find((item) => item.runId === runId);
    if (active) {
      active.controller.abort();
      const run = this.getRun(runId);
      if (!run) throw new HttpError(404, '任务不存在');
      return publicCopy(run);
    }

    const index = this.queue.findIndex((item) => item.runId === runId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      const run = this.store.run(runId);
      if (!run) throw new HttpError(404, '任务不存在');
      run.status = 'cancelled';
      run.finishedAt = nowIso();
      run.message = '任务在开始前已取消';
      this.log(run, 'warn', '任务已取消');
      await this.store.save();
      this.publish({ type: 'done', run: publicCopy(run) });
      return publicCopy(run);
    }

    const run = this.store.run(runId);
    if (!run) throw new HttpError(404, '任务不存在');
    throw new HttpError(409, '该任务当前未运行');
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.queue.splice(0);
    for (const active of this.active.values()) active.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  private drain(): void {
    if (this.draining || this.stopping) return;
    this.draining = true;
    try {
      const maxConcurrent = Math.max(1, this.store.snapshot.settings.maxConcurrentRuns || 1);
      while (this.active.size < maxConcurrent && this.queue.length > 0) {
        const item = this.queue.shift()!;
        const run = this.store.run(item.runId);
        if (!run || run.status !== 'queued') continue;
        const controller = new AbortController();
        this.active.set(item.runId, { ...item, controller });
        void this.execute(item.runId, controller)
          .catch(async (error) => {
            await this.failRun(run, errorText(error));
          })
          .finally(() => {
            this.active.delete(item.runId);
            this.drain();
          });
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(runId: string, controller: AbortController): Promise<void> {
    const run = this.store.run(runId);
    if (!run) return;
    this.live.set(run.id, run);
    const startedAt = nowIso();
    run.status = 'running';
    run.startedAt = startedAt;
    run.message = '正在扫描来源';
    this.log(
      run,
      'info',
      `开始${run.mode === 'full' ? '全量' : '增量'}同步「${run.libraryName}」`,
    );
    this.publish({ type: 'status', run: publicCopy(run) });
    await this.store.save().catch(() => undefined);

    let lastStatusAt = 0;
    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastStatusAt < 500) return;
      lastStatusAt = now;
      this.publish({ type: 'status', run: publicCopy(run) });
    };

    try {
      const library = this.store.library(run.libraryId);
      if (!library) throw new Error('媒体库已被删除');
      const source = this.store.source(library.sourceId);
      if (!source) throw new Error('媒体库关联的来源已被删除');
      const settings = this.store.snapshot.settings;
      const outputRoot = settings.outputDir;
      if (library.urlTemplate.includes('{streamBase}') && !(library.streamBaseUrl || settings.streamBaseUrl)) {
        throw new Error('尚未配置 302 服务地址，请到设置中填写 302 服务公开地址');
      }
      await fs.mkdir(outputRoot, { recursive: true });

      this.log(run, 'info', `来源：${source.name} · 路径：${library.sourcePath}`);
      if (library.urlTemplate.includes('{streamToken}')) {
        this.log(run, 'info', `STRM 模式：302 跳转（通过 ${library.streamBaseUrl || settings.streamBaseUrl}）`);
      }
      const client = clientForSource(source, (cookie) => {
        source.cookie = cookie;
        source.cookies = [cookie, ...(source.cookies ?? []).filter((item) => item !== cookie)];
        void this.store.save();
      });
      run.message = '正在扫描文件';
      emitProgress(true);

      let lastScanLog = Date.now();
      const scan = await scanLibrary(client, library, {
        signal: controller.signal,
        onProgress: (progress) => {
          run.stats.scanned = progress.files;
          if (Date.now() - lastScanLog > 2500) {
            lastScanLog = Date.now();
            this.log(
              run,
              'debug',
              `扫描中 · ${progress.directories} 个目录 / ${progress.files} 个匹配文件`,
            );
          }
          emitProgress();
        },
      });

      run.stats.scanned = scan.scanned;
      run.stats.matched = scan.files.length;
      if (library.downloadSidecars && scan.sidecars.length > 0) {
        run.message = '正在下载字幕 / NFO / 图片';
        this.log(run, 'info', `发现 ${scan.sidecars.length} 个附属文件`);
        let downloaded = 0;
        for (const sidecar of scan.sidecars.slice(0, 500)) {
          if (controller.signal.aborted) break;
          try {
            const relativeStr = strmRelativePath(library.targetPath, sidecar.relative).replace(/\.strm$/, sidecar.extension);
            const absolute = safeJoin(outputRoot, relativeStr);
            if (await fileExists(absolute)) continue;
            const raw = await client.getRawUrl(sidecar.path, AbortSignal.timeout(15_000));
            if (!raw) continue;
            const response = await fetch(raw, { signal: AbortSignal.timeout(30_000) });
            if (!response.ok) continue;
            const length = Number(response.headers.get('content-length') || 0);
            if (length > 30 * 1024 * 1024) continue;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 30 * 1024 * 1024) continue;
            await fs.mkdir(path.dirname(absolute), { recursive: true });
            await fs.writeFile(absolute, buffer);
            downloaded += 1;
          } catch (error) {
            this.log(run, 'debug', `附属文件 ${sidecar.name} 下载失败：${errorText(error)}`);
          }
        }
        if (downloaded > 0) this.log(run, 'info', `已下载 ${downloaded} 个附属文件`);
      }
      run.message = `找到 ${scan.files.length} 个视频`;
      this.log(
        run,
        'info',
        `扫描完成：${scan.scanned} 个文件，匹配 ${scan.files.length} 个视频`,
      );
      emitProgress(true);

      const manifest = await readManifest(this.store, library.id);
      const nextEntries: Record<string, ManifestEntry> = { ...manifest.entries };
      const currentKeys = new Set<string>();
      const claimedTargets = new Map<string, string>();
      let lastProgressLog = Date.now();

      for (const file of scan.files) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        currentKeys.add(file.relative);
        const sourceUrl = source.publicUrl || source.baseUrl;
        let url: string;
        let strmFile: string;
        try {
          url = renderUrlTemplate(library.urlTemplate, {
            sourceUrl,
            path: file.path,
            file: file.name,
            ext: file.extension,
            streamBase: library.streamBaseUrl || settings.streamBaseUrl,
            streamToken: source.streamKey,
          });
          strmFile = strmRelativePath(library.targetPath, file.relative);
        } catch (error) {
          run.stats.failed += 1;
          this.log(run, 'error', `${file.name}：${errorText(error)}`);
          continue;
        }

        const owner = claimedTargets.get(strmFile);
        if (owner && owner !== file.path) {
          strmFile = strmFile.replace(/\.strm$/, `.${file.extension}.strm`);
          this.log(run, 'warn', `文件名冲突，已改用 ${path.basename(strmFile)}`);
        }
        claimedTargets.set(strmFile, file.path);

        const absolute = safeJoin(outputRoot, strmFile);
        const previous = manifest.entries[file.relative];
        try {
          if (
            run.mode !== 'full' &&
            library.incremental &&
            isUnchanged(previous, file, url) &&
            (await fileExists(absolute))
          ) {
            run.stats.skipped += 1;
            nextEntries[file.relative] = previous!;
          } else {
            await fs.mkdir(path.dirname(absolute), { recursive: true });
            await fs.writeFile(absolute, `${url}\n`, 'utf8');
            run.stats.generated += 1;
            nextEntries[file.relative] = {
              strmFile,
              sourcePath: file.path,
              size: file.size,
              modified: file.modified,
              url,
              generatedAt: nowIso(),
            };
          }
        } catch (error) {
          run.stats.failed += 1;
          this.log(run, 'error', `写入 ${strmFile} 失败：${errorText(error)}`);
        }

        if (Date.now() - lastProgressLog > 1800) {
          lastProgressLog = Date.now();
          this.log(
            run,
            'debug',
            `进度 ${run.stats.generated + run.stats.skipped + run.stats.failed}/${scan.files.length} · 新建 ${run.stats.generated} · 跳过 ${run.stats.skipped}`,
          );
        }
        emitProgress();
      }

      if (!controller.signal.aborted && library.deleteOrphans) {
        const missing = Object.keys(manifest.entries).filter((key) => !currentKeys.has(key));
        for (const key of missing) {
          const entry = manifest.entries[key];
          if (!entry || !entry.strmFile.endsWith('.strm')) continue;
          try {
            const absolute = safeJoin(outputRoot, entry.strmFile);
            if (await fileExists(absolute)) {
              await fs.unlink(absolute);
              run.stats.deleted += 1;
            }
          } catch {
            // Orphan cleanup is best-effort; never fail a run for it.
          }
          delete nextEntries[key];
        }
        if (missing.length > 0) {
          this.log(run, 'info', `清理 ${missing.length} 个失效 STRM 条目`);
        }
      }

      await writeManifest(this.store, {
        version: 1,
        libraryId: library.id,
        updatedAt: nowIso(),
        entries: nextEntries,
      });

      run.stats.matched = scan.files.length;
      const completed = run.stats.generated + run.stats.skipped;
      if (run.stats.failed > 0) {
        run.status = completed > 0 ? 'partial' : 'failed';
        run.message = `完成，${run.stats.failed} 个文件失败`;
      } else {
        run.status = 'success';
        run.message =
          scan.files.length === 0
            ? '扫描完成，没有匹配的视频'
            : `生成 ${run.stats.generated} 个，跳过 ${run.stats.skipped} 个`;
      }
      this.log(
        run,
        run.status === 'success' ? 'success' : 'warn',
        `${run.message}${run.stats.deleted ? ` · 清理 ${run.stats.deleted} 个` : ''}`,
      );
      await this.finish(run, library);
    } catch (error) {
      if (controller.signal.aborted) {
        run.status = 'cancelled';
        run.message = '任务已取消';
        this.log(run, 'warn', run.message);
        const library = this.store.library(run.libraryId);
        await this.finish(run, library);
      } else {
        await this.failRun(run, errorText(error));
      }
    } finally {
      this.live.delete(run.id);
    }
  }

  private async failRun(run: Run, message: string): Promise<void> {
    if (run.status === 'cancelled') return;
    run.status = 'failed';
    run.finishedAt = nowIso();
    run.message = message;
    this.log(run, 'error', `任务失败：${message}`);
    await this.finish(run, this.store.library(run.libraryId));
  }

  private async finish(run: Run, library: LibraryRecord | undefined): Promise<void> {
    run.finishedAt = nowIso();
    if (library) {
      library.lastRunAt = run.finishedAt;
      library.lastRunStatus = run.status;
      library.lastRunId = run.id;
      library.totalRuns += 1;
      if (run.status === 'success' || run.status === 'partial') {
        library.fileCount = run.stats.generated + run.stats.skipped;
      }
    }
    this.live.delete(run.id);
    this.publish({ type: 'done', run: publicCopy(run) });
    try {
      this.store.trimRuns();
      await this.store.save();
    } catch {
      // A failed persistence write is surfaced on next boot; delivery already happened.
    }
    if (run.status === 'success' || run.status === 'partial' || run.status === 'failed') {
      notifyRun(this.store.snapshot.settings.notifications, {
        status: run.status,
        library: run.libraryName,
        message: run.message,
        generated: run.stats.generated,
        skipped: run.stats.skipped,
        failed: run.stats.failed,
      });
      if (run.status === 'success' || run.status === 'partial') {
        void refreshEmbyAfterRun(this.store.snapshot.settings.embyServers).catch((error) => {
          console.warn('[emby] refresh failed:', error instanceof Error ? error.message : String(error));
        });
      }
    }
  }

  private log(run: Run, level: LogLevel, message: string): void {
    const line: LogLine = { at: nowIso(), level, message };
    run.logs.push(line);
    if (run.logs.length > config.runLogLimit) run.logs.splice(0, run.logs.length - config.runLogLimit);
    this.bus.emit(run.id, { type: 'log', line } satisfies RunEvent);
  }

  private publish(event: RunEvent): void {
    const runId = event.type === 'log' ? '' : event.run.id;
    if (runId) this.bus.emit(runId, event);
  }
}
