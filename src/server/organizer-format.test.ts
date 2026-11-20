import { describe, expect, it } from 'vitest';
import { renderTemplate } from './organizer.js';

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
