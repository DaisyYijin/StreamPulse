import { describe, expect, it } from 'vitest';
import { isUnchanged, type ManifestEntry, type RemoteFile } from './manifest.js';

const file: RemoteFile = {
  path: '/Movies/A.mkv',
  relative: 'A.mkv',
  name: 'A.mkv',
  extension: 'mkv',
  size: 100,
  modified: '2026-01-01T00:00:00Z',
};

const entry: ManifestEntry = {
  strmFile: 'Movies/A.strm',
  sourcePath: '/Movies/A.mkv',
  size: 100,
  modified: '2026-01-01T00:00:00Z',
  url: 'https://cloud/d/Movies/A.mkv',
  generatedAt: '2026-01-01T00:00:00Z',
};

describe('incremental comparison', () => {
  it('skips unchanged entries', () => {
    expect(isUnchanged(entry, file, entry.url)).toBe(true);
  });

  it('regenerates when url, size or modified changes', () => {
    expect(isUnchanged(entry, file, 'https://other/A.mkv')).toBe(false);
    expect(isUnchanged({ ...entry, size: 101 }, file, entry.url)).toBe(false);
    expect(isUnchanged({ ...entry, modified: '2026-02-01' }, file, entry.url)).toBe(false);
  });

  it('does not skip without a previous entry', () => {
    expect(isUnchanged(undefined, file, entry.url)).toBe(false);
  });
});
