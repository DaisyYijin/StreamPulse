import { describe, expect, it } from 'vitest';
import { matchLibrary, parseTelegramCommand } from './telegram-bot.js';
import type { LibraryRecord } from './types.js';

describe('Telegram bot commands', () => {
  it('parses commands and strips bot usernames', () => {
    expect(parseTelegramCommand('/run@streampulse_bot Movies')).toEqual({ command: 'run', args: 'Movies' });
    expect(parseTelegramCommand('hello')).toBeNull();
  });

  it('matches libraries by id or partial name', () => {
    const libraries = [
      { id: 'lib_movies', name: '电影' },
      { id: 'lib_tv', name: '电视剧' },
    ] as LibraryRecord[];
    expect(matchLibrary(libraries, '电影')[0].id).toBe('lib_movies');
    expect(matchLibrary(libraries, 'lib_tv')[0].name).toBe('电视剧');
    expect(matchLibrary(libraries, '不存在')).toHaveLength(0);
  });
});
