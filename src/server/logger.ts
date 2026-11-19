import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { config } from './config.js';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

const originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};
let stream: fs.WriteStream | null = null;
let initialized = false;

function dayStamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  return inspect(value, { depth: 4, breakLength: 140, colors: false });
}

function write(level: ConsoleLevel, args: unknown[]): void {
  if (!stream) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args.map(formatArg).join(' ')}\n`;
  try {
    stream.write(line);
  } catch {
    // Logging must never take the server down.
  }
}

async function cleanOldLogs(directory: string): Promise<void> {
  const cutoff = Date.now() - config.logRetentionDays * 24 * 60 * 60 * 1000;
  try {
    const files = await fsp.readdir(directory);
    await Promise.all(
      files
        .filter((file) => /^streampulse-\d{4}-\d{2}-\d{2}\.log$/.test(file))
        .map(async (file) => {
          const fullPath = path.join(directory, file);
          const stat = await fsp.stat(fullPath);
          if (stat.mtimeMs < cutoff) await fsp.unlink(fullPath).catch(() => undefined);
        }),
    );
  } catch {
    // Cleanup is best-effort.
  }
}

export async function initLogging(): Promise<string> {
  await fsp.mkdir(config.logDir, { recursive: true });
  const file = path.join(config.logDir, `streampulse-${dayStamp()}.log`);

  if (!initialized) {
    stream = fs.createWriteStream(file, { flags: 'a', mode: 0o640 });
    stream.on('error', () => {
      stream = null;
    });

    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as ConsoleLevel[]) {
      const original = console[level].bind(console);
      originals[level] = original;
      console[level] = (...args: unknown[]) => {
        original(...args);
        write(level, args);
      };
    }
    initialized = true;
  }

  await cleanOldLogs(config.logDir);
  return file;
}
