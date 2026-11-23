import { describe, expect, it } from 'vitest';
import { firstLetterOf } from './organizer.js';

describe('firstLetterOf', () => {
  it('uses pinyin initials for Chinese titles', () => {
    expect(firstLetterOf('蜘蛛侠')).toBe('Z');
    expect(firstLetterOf('沙丘2')).toBe('S');
  });

  it('uses Latin initials and a fallback for numbers', () => {
    expect(firstLetterOf('Dune')).toBe('D');
    expect(firstLetterOf('3 Body Problem')).toBe('#');
  });
});
