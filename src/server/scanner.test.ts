import { describe, expect, it } from 'vitest';
import { scanLibrary } from './scanner.js';
import type { StorageClient, StorageEntry } from './storage.js';

function fakeClient(tree: Record<string, StorageEntry[]>): StorageClient {
  return {
    kind: '115',
    origin: 'https://115.com',
    list: async (path: string) => tree[path] ?? [],
    getRawUrl: async () => null,
    testConnection: async () => ({ message: 'ok', sampleCount: 0 }),
    resolveId: async () => '0',
  };
}

const library = {
  sourcePath: '/Media',
  extensions: ['mkv'],
  excludePatterns: [],
  minSizeMB: 0,
};

describe('scanLibrary', () => {
  it('keeps paths relative to the library root when scanning a subdirectory', async () => {
    const client = fakeClient({
      '/Media': [{ name: 'Sub', isDir: true, size: 0, modified: '', id: '1' }],
      '/Media/Sub': [{ name: 'Movie.mkv', isDir: false, size: 100, modified: '', id: '2' }],
    });
    const result = await scanLibrary(client, library, {
      signal: new AbortController().signal,
      scanPath: '/Media/Sub',
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relative).toBe('Sub/Movie.mkv');
    expect(result.files[0].path).toBe('/Media/Sub/Movie.mkv');
  });

  it('does not visit siblings when a scope is set', async () => {
    const client = fakeClient({
      '/Media': [
        { name: 'Sub', isDir: true, size: 0, modified: '', id: '1' },
        { name: 'Other.mkv', isDir: false, size: 100, modified: '', id: '2' },
      ],
      '/Media/Sub': [{ name: 'Movie.mkv', isDir: false, size: 100, modified: '', id: '3' }],
    });
    const result = await scanLibrary(client, library, {
      signal: new AbortController().signal,
      scanPath: '/Media/Sub',
    });
    expect(result.files.map((file) => file.name)).toEqual(['Movie.mkv']);
  });
});
