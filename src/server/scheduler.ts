import cron, { type ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { clientForSource } from './client.js';
import { buildDirectoryIndex, type DirectoryIndex } from './event-index.js';
import { normalizeSourcePath } from './core/paths.js';
import type { RunManager } from './runner.js';
import type { Store } from './store.js';
import type { LibraryRecord } from './types.js';
import type { StorageClient, StorageEvent } from './storage.js';

export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidCron(expression: string): boolean {
  if (!expression.trim()) return true;
  if (!cron.validate(expression)) return false;
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

export function nextRunAt(expression: string, timezone: string): string | null {
  if (!expression.trim()) return null;
  try {
    return CronExpressionParser.parse(expression, { tz: timezone }).next().toISOString();
  } catch {
    return null;
  }
}

export class Scheduler {
  private readonly store: Store;
  private readonly runner: RunManager;
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly eventTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastEventAt = new Map<string, number>();
  private readonly eventBusy = new Set<string>();
  private readonly dirIndexes = new Map<string, { at: number; index: DirectoryIndex }>();

  constructor(store: Store, runner: RunManager) {
    this.store = store;
    this.runner = runner;
  }

  start(): void {
    this.reload();
  }

  reload(): void {
    for (const task of this.tasks.values()) {
      try {
        task.destroy();
      } catch {
        // Ignore already-stopped tasks.
      }
    }
    this.tasks.clear();
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    for (const timer of this.eventTimers.values()) clearInterval(timer);
    this.eventTimers.clear();
    this.dirIndexes.clear();
    const timezone = this.store.snapshot.settings.timezone;

    for (const library of this.store.snapshot.libraries) {
      if (!library.enabled) continue;

      if (library.watchInterval > 0) {
        const minutes = Math.min(60, Math.max(1, library.watchInterval));
        const source = this.store.source(library.sourceId);
        if (library.eventWatch && source?.type === '115') {
          if (!this.lastEventAt.has(library.id)) this.lastEventAt.set(library.id, Date.now() / 1000);
          const timer = setInterval(() => {
            void this.pollEvents(library, source).catch((error) => {
              console.warn(`[event-watch] ${library.name}: ${error instanceof Error ? error.message : String(error)}`);
            });
          }, minutes * 60_000);
          this.eventTimers.set(library.id, timer);
        } else {
          const timer = setInterval(() => {
            void this.runner.start(library.id, 'watch').catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              if (!message.includes('已有任务')) {
                console.warn(`[watch] ${library.name}: ${message}`);
              }
            });
          }, minutes * 60_000);
          this.timers.set(library.id, timer);
        }
      }

      if (!library.schedule.trim()) continue;
      if (!isValidCron(library.schedule)) continue;
      try {
        const task = cron.schedule(
          library.schedule,
          () => {
            void this.runner.start(library.id, 'schedule').catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              if (!message.includes('已有任务')) {
                console.warn(`[scheduler] ${library.name}: ${message}`);
              }
            });
          },
          { timezone, name: `streampulse:${library.id}`, noOverlap: true },
        );
        this.tasks.set(library.id, task);
      } catch (error) {
        console.warn(`[scheduler] 无法注册 ${library.name}: ${String(error)}`);
      }
    }
  }

  private async pollEvents(library: LibraryRecord, source: NonNullable<ReturnType<Store['source']>>): Promise<void> {
    if (this.eventBusy.has(library.id)) return;
    this.eventBusy.add(library.id);
    const since = this.lastEventAt.get(library.id) ?? Date.now() / 1000;
    try {
      const client = clientForSource(source, (cookie) => {
        source.cookie = cookie;
        source.cookies = [cookie, ...(source.cookies ?? []).filter((item) => item !== cookie)];
        void this.store.save();
      });
      let events: StorageEvent[] | null = null;
      if (client.recentEvents) {
        try {
          events = await client.recentEvents(since, AbortSignal.timeout(30_000));
        } catch {
          // Detail API can be rate-limited; fall back to the boolean life check.
          events = null;
        }
      }
      if (!events) {
        const changed = await client.hasChangesSince?.(since).catch(() => false);
        if (!changed) return;
        this.lastEventAt.set(library.id, Date.now() / 1000);
        await this.startScoped(library, undefined);
        return;
      }
      if (events.length === 0) {
        this.lastEventAt.set(library.id, Date.now() / 1000);
        return;
      }

      let index = await this.directoryIndex(library, client, false);
      if (!index) {
        await this.startScoped(library, undefined);
        this.lastEventAt.set(library.id, Date.now() / 1000);
        return;
      }
      const affected = events.filter((event) => index.dirs.has(event.parentId));
      if (affected.length === 0) {
        // A new/moved directory may not be in the cached index yet. Rebuild once,
        // then skip it if it belongs to another library or a removed directory.
        const rebuilt = await this.directoryIndex(library, client, true);
        if (rebuilt) {
          const retry = events.filter((event) => rebuilt.dirs.has(event.parentId));
          if (retry.length > 0) {
            await this.startForEvents(library, rebuilt, retry);
            this.advanceEventClock(library, events);
            return;
          }
        }
        // The event belongs to another library on the same account (or to a
        // directory that no longer exists). Do not force a full scan.
        this.advanceEventClock(library, events);
        return;
      }
      await this.startForEvents(library, index, affected);
      this.advanceEventClock(library, events);
    } finally {
      this.eventBusy.delete(library.id);
    }
  }

  private async startForEvents(library: LibraryRecord, index: DirectoryIndex, events: StorageEvent[]): Promise<void> {
    const scopes = new Set<string>();
    for (const event of events) {
      const relative = index.dirs.get(event.parentId);
      if (relative === undefined) continue;
      scopes.add(relative);
    }
    if (scopes.size === 0 || scopes.has('')) {
      await this.startScoped(library, undefined);
      return;
    }
    if (scopes.size > 1) {
      // Multiple subtrees: one normal incremental run is cheaper and safer than
      // queueing several overlapping scoped runs for the same library.
      await this.startScoped(library, undefined);
      return;
    }
    const relative = Array.from(scopes)[0];
    const basePath = normalizeSourcePath(library.sourcePath);
    const scope = relative ? `${basePath === '/' ? '' : basePath}/${relative}` : basePath;
    await this.startScoped(library, scope);
  }

  private async startScoped(library: LibraryRecord, scope?: string): Promise<void> {
    try {
      await this.runner.start(library.id, 'watch', { scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('已有任务')) throw error;
    }
  }

  private advanceEventClock(library: LibraryRecord, events: StorageEvent[]): void {
    const latest = events.reduce((max, event) => Math.max(max, event.updateTime), 0);
    this.lastEventAt.set(library.id, latest > 0 ? latest : Date.now() / 1000);
  }

  private async directoryIndex(library: LibraryRecord, client: StorageClient, refresh: boolean): Promise<DirectoryIndex | null> {
    const cached = this.dirIndexes.get(library.id);
    if (!refresh && cached && Date.now() - cached.at < 5 * 60_000) return cached.index;
    if (!client.resolveId) return null;
    try {
      const index = await buildDirectoryIndex(client, library.sourcePath, AbortSignal.timeout(45_000));
      this.dirIndexes.set(library.id, { at: Date.now(), index });
      return index;
    } catch (error) {
      console.warn(`[event-index] ${library.name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      try {
        task.destroy();
      } catch {
        // Ignore.
      }
    }
    this.tasks.clear();
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    for (const timer of this.eventTimers.values()) clearInterval(timer);
    this.eventTimers.clear();
  }

  nextFor(library: LibraryRecord, timezone: string): string | null {
    if (!library.enabled) return null;
    return nextRunAt(library.schedule, timezone);
  }
}
