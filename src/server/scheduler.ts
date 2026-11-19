import cron, { type ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { RunManager } from './runner.js';
import type { Store } from './store.js';
import type { LibraryRecord } from './types.js';

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
    const timezone = this.store.snapshot.settings.timezone;

    for (const library of this.store.snapshot.libraries) {
      if (!library.enabled || !library.schedule.trim()) continue;
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

  stop(): void {
    for (const task of this.tasks.values()) {
      try {
        task.destroy();
      } catch {
        // Ignore.
      }
    }
    this.tasks.clear();
  }

  nextFor(library: LibraryRecord, timezone: string): string | null {
    if (!library.enabled) return null;
    return nextRunAt(library.schedule, timezone);
  }
}
