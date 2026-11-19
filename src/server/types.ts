import { randomBytes } from 'node:crypto';
import type { Library, Run, Settings, Source } from '../shared/types.js';

export type SourceRecord = Omit<Source, 'tokenHint' | 'hasToken' | 'hasPassword'> & {
  token: string;
  password: string;
  streamKey: string;
};

export type LibraryRecord = Omit<Library, 'sourceName' | 'nextRunAt'>;

export interface Database {
  schemaVersion: 1;
  secret: string;
  /** Legacy fields; migrated to /config/accounts/admin.json on startup. */
  username: string;
  passwordHash: string | null;
  sources: SourceRecord[];
  libraries: LibraryRecord[];
  runs: Run[];
  settings: Settings;
  createdAt: string;
  updatedAt: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

let sequence = 0;

export function makeId(prefix: string): string {
  sequence = (sequence + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}${sequence.toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeStreamKey(): string {
  return randomBytes(16).toString('hex');
}
