import { describe, expect, it } from 'vitest';
import {
  ensureWithin,
  extensionOf,
  normalizeExtensions,
  normalizeSourcePath,
  normalizeTargetPath,
  relativeSourcePath,
  strmRelativePath,
} from './paths.js';

describe('path safety', () => {
  it('normalizes source paths', () => {
    expect(normalizeSourcePath(' Movies//Inception/ ')).toBe('/Movies/Inception');
    expect(normalizeSourcePath('/')).toBe('/');
    expect(() => normalizeSourcePath('/Movies/../etc')).toThrow();
  });

  it('normalizes target paths but refuses escapes', () => {
    expect(normalizeTargetPath('/Movies/4K/')).toBe('Movies/4K');
    expect(() => normalizeTargetPath('../outside')).toThrow();
    expect(() => normalizeTargetPath('/')).toThrow();
  });

  it('keeps resolved output inside the root', () => {
    expect(ensureWithin('/data/strm', '/data/strm/Movies/a.strm')).toBe('/data/strm/Movies/a.strm');
    expect(() => ensureWithin('/data/strm', '/data/strm/../secret.strm')).toThrow();
  });

  it('derives relative paths and rejects siblings', () => {
    expect(relativeSourcePath('/Movies', '/Movies/Inception/Inception.mkv')).toBe(
      'Inception/Inception.mkv',
    );
    expect(() => relativeSourcePath('/Movies', '/Movies2/x.mkv')).toThrow();
  });

  it('maps video files to mirrored STRM paths', () => {
    expect(strmRelativePath('Movies/4K', 'Inception (2010)/Inception.2010.mkv')).toBe(
      'Movies/4K/Inception (2010)/Inception.2010.strm',
    );
    expect(strmRelativePath('TV', 'Show/Season 01/S01E01.mkv')).toBe(
      'TV/Show/Season 01/S01E01.strm',
    );
  });

  it('normalizes extensions and extracts them', () => {
    expect(normalizeExtensions(['.MKV', 'mp4, MOV', 'mkv'])).toEqual(['mkv', 'mov', 'mp4']);
    expect(extensionOf('Movie.2024.2160p.MKV')).toBe('mkv');
    expect(extensionOf('.hidden')).toBe('');
  });
});
