import { describe, expect, it } from 'vitest';
import { renderTemplate } from './organizer.js';
import { GENRE_NAME_TO_ID } from './genres.js';

describe('organizer rename template', () => {
  it('renders variables', () => {
    expect(renderTemplate('{title} ({year})', { title: 'Movie', year: '2024' })).toBe('Movie (2024)');
  });

  it('omits conditional blocks when a variable is empty', () => {
    const template = '{title}<.{resource_pix}><.{resource_effect}>';
    expect(renderTemplate(template, { title: 'Movie', resource_pix: '2160p', resource_effect: '' })).toBe('Movie.2160p');
    expect(renderTemplate(template, { title: 'Movie', resource_pix: '', resource_effect: 'DV' })).toBe('Movie.DV');
  });
});

describe('rename template syntax', () => {
  it('supports transformations, literal braces and unknown variables', () => {
    expect(renderTemplate("{title.replace('.', ' ')}", { title: 'Iron.Man' })).toBe('Iron Man');
    expect(renderTemplate('{title.upper()}', { title: 'dune' })).toBe('DUNE');
    expect(renderTemplate('[[{title}]]', { title: 'Dune' })).toBe('{Dune}');
    expect(renderTemplate('{unknown}', {})).toBe('{unknown}');
  });

  it('cleans repeated and trailing separators', () => {
    expect(renderTemplate('{title}.{year}', { title: 'Iron Man', year: '' })).toBe('Iron Man');
    expect(renderTemplate('{title}..-{year}', { title: 'Iron Man', year: '2008' })).toBe('Iron Man-2008');
  });
});

describe('simple genre matching', () => {
  it('maps English genre names to TMDb IDs', () => {
    expect(GENRE_NAME_TO_ID.Animation).toBe(16);
    expect(GENRE_NAME_TO_ID['Science Fiction']).toBe(878);
  });
});
