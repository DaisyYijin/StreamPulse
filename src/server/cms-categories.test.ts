import { describe, expect, it } from 'vitest';
import { matchCmsCategory, parseCmsCategories } from './cms-categories.js';
import type { TmdbInfo } from './tmdb.js';

const base: TmdbInfo = {
  id: 1, mediaType: 'movie', title: 'Test', originalTitle: 'Test', year: '2024',
  genres: ['Animation'], genreIds: [16], countries: ['CN'], productionCountries: ['CN'],
  languages: ['zh'], keywords: ['concert'], cast: ['Actor'], directors: ['Director'], overview: '',
};

describe('CMS category rules', () => {
  it('matches genre ids, languages and falls through', () => {
    const config = parseCmsCategories(`movie:\n  电影/动画电影:\n    genre_ids: "16"\n  电影/外语电影:\n`);
    expect(matchCmsCategory(config, base, '.mkv', 'x.mkv')?.name).toBe('电影/动画电影');
    expect(matchCmsCategory(config, { ...base, genreIds: [28], languages: ['en'] }, '.mkv', 'x.mkv')?.name).toBe('电影/外语电影');
  });

  it('supports year ranges, keywords and series layers', () => {
    const config = parseCmsCategories(`movie:\n  电影/老片:\n    release_year: "2000-2009"\n  电影/系列:\n    series_keywords: "Test"\n`);
    expect(matchCmsCategory(config, { ...base, year: '2005' }, '.mkv', 'x.mkv')?.name).toBe('电影/老片');
    expect(matchCmsCategory(config, base, '.mkv', 'x.mkv')?.name).toBe('电影/系列/Test系列');
  });

  it('supports optional and exclusion conditions', () => {
    const config = parseCmsCategories(`movie:\n  电影/测试:\n    ?genre_ids: "16"\n    origin_country: "!US"\n`);
    expect(matchCmsCategory(config, base, '.mkv', 'x.mkv')?.name).toBe('电影/测试');
  });
});
