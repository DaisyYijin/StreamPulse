import { describe, expect, it } from 'vitest';
import { buildDirectoryIndex } from './event-index.js';
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

describe('buildDirectoryIndex', () => {
  it('maps directory CIDs to paths relative to the library root', async () => {
    const client = fakeClient({
      '/Media': [{ name: 'Movies', isDir: true, size: 0, modified: '', id: '10' }],
      '/Media/Movies': [{ name: '2024', isDir: true, size: 0, modified: '', id: '11' }],
      '/Media/Movies/2024': [],
    });
    const index = await buildDirectoryIndex(client, '/Media', new AbortController().signal);
    expect(index.rootId).toBe('0');
    expect(index.dirs.get('0')).toBe('');
    expect(index.dirs.get('10')).toBe('Movies');
    expect(index.dirs.get('11')).toBe('Movies/2024');
  });
});
