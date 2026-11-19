import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizerSettings } from '../shared/types.js';
import { executeOrganizerBatch, scanOrganizer } from './organizer.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function settings(root: string): OrganizerSettings {
  return {
    importDir: path.join(root, 'import'),
    libraryDir: path.join(root, 'media'),
    mode: 'move',
    upgradeStrategy: 'better',
    tmdbApiKey: 'test-key',
    tmdbLanguage: 'zh-CN',
    categories: [{
      id: 'action',
      name: '动作',
      mediaType: 'movie',
      genres: ['Action'],
      countries: [],
      languages: [],
      keywords: [],
    }],
  };
}

describe('organizer', () => {
  it('identifies, categorizes and moves a movie', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'streampulse-organizer-'));
    await fs.mkdir(path.join(root, 'import'), { recursive: true });
    const source = path.join(root, 'import', 'Inception.2010.2160p.BluRay.REMUX.HEVC.mkv');
    await fs.writeFile(source, 'video');
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search/movie')) {
        return new Response(JSON.stringify({ results: [{ id: 27205 }] }), { status: 200 });
      }
      if (url.includes('/movie/27205')) {
        return new Response(JSON.stringify({
          id: 27205, title: 'Inception', release_date: '2010-07-15',
          genres: [{ name: 'Action' }, { name: 'Science Fiction' }],
          origin_country: ['US'], original_language: 'en',
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const config = settings(root);
    const batch = await scanOrganizer(config);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].action).toBe('create');
    expect(batch.items[0].category).toBe('动作');
    expect(batch.items[0].destination).toContain(path.join('Movies', '动作', 'Inception (2010)'));

    const result = await executeOrganizerBatch(batch.id, config);
    expect(result.executed).toBe(1);
    await fs.access(batch.items[0].destination);
    await expect(fs.access(source)).rejects.toBeTruthy();
  });
});
