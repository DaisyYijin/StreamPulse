import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizerSettings } from '../shared/types.js';
import { executeCloudOrganizerBatch, scanCloudOrganizer } from './organizer.js';
import type { StorageClient, StorageEntry } from './storage.js';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const config: OrganizerSettings = {
  sourceId: 'src_test',
  sourcePath: '/Inbox',
  libraryPath: '/Media',
  mode: 'move',
  upgradeStrategy: 'better',
  tmdbApiKey: 'test-key',
  tmdbLanguage: 'zh-CN',
  categories: [{
    id: 'action', name: '动作', mediaType: 'movie',
    genres: ['Action'], countries: [], languages: [], keywords: [],
  }],
};

function fakeClient(entries: Record<string, StorageEntry[]>): StorageClient & { moves: string[]; renames: string[] } {
  const moves: string[] = [];
  const renames: string[] = [];
  return {
    kind: '115',
    origin: 'https://115.com',
    moves,
    renames,
    async list(path) { return entries[path] ?? []; },
    async getRawUrl() { return null; },
    async testConnection() { return { message: 'ok', sampleCount: 0 }; },
    async mkdir() {},
    async move(source, destination) { moves.push(`${source}->${destination}`); },
    async rename(source, name) { renames.push(`${source}->${name}`); },
    async remove() {},
  };
}

describe('cloud organizer', () => {
  it('identifies, categorizes and moves a cloud movie', async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search/movie')) {
        return new Response(JSON.stringify({ results: [{ id: 27205 }] }), { status: 200 });
      }
      if (url.includes('/movie/27205')) {
        return new Response(JSON.stringify({
          id: 27205, title: 'Inception', release_date: '2010-07-15',
          genres: [{ name: 'Action' }], origin_country: ['US'], original_language: 'en',
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const client = fakeClient({
      '/Inbox': [{ name: 'Inception.2010.2160p.BluRay.REMUX.HEVC.mkv', isDir: false, size: 1, modified: '' }],
    });
    const batch = await scanCloudOrganizer(config, client);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].action).toBe('create');
    expect(batch.items[0].category).toBe('动作');
    expect(batch.items[0].destination).toContain('/Media/Movies/动作/Inception (2010)');

    const result = await executeCloudOrganizerBatch(batch.id, client);
    expect(result.executed).toBe(1);
    expect(client.renames[0]).toContain('Inception (2010)');
    expect(client.moves[0]).toContain('/Media/Movies/动作/Inception (2010)');
  });
});
