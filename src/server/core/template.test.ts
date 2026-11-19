import { describe, expect, it } from 'vitest';
import { encodePath, renderUrlTemplate, TemplateError, validateUrlTemplate } from './template.js';

const sample = {
  sourceUrl: 'https://cloud.example.com/',
  path: '/Movies/沙丘 #1/Dune Part Two (2024).mkv',
  file: 'Dune Part Two (2024).mkv',
  ext: 'mkv',
};

describe('URL templates', () => {
  it('encodes every path segment', () => {
    const url = renderUrlTemplate('{sourceUrl}/d{encodedPath}', sample);
    expect(url).toBe(
      'https://cloud.example.com/d/Movies/%E6%B2%99%E4%B8%98%20%231/Dune%20Part%20Two%20(2024).mkv',
    );
  });

  it('supports raw paths, names, extensions and directories', () => {
    expect(renderUrlTemplate('{sourceUrl}/p{path}?name={name}&ext={ext}&dir={dir}', sample)).toBe(
      'https://cloud.example.com/p/Movies/沙丘 #1/Dune Part Two (2024).mkv?name=Dune Part Two (2024)&ext=mkv&dir=/Movies/沙丘 #1',
    );
  });

  it('rejects templates without a path variable', () => {
    expect(() => validateUrlTemplate('{sourceUrl}/d/fixed.mkv')).toThrow(TemplateError);
  });

  it('rejects unknown variables', () => {
    expect(() => validateUrlTemplate('{sourceUrl}/d{encodedPath}?x={unknown}')).toThrow(
      /未知模板变量/,
    );
  });

  it('rejects non-http templates', () => {
    expect(() => validateUrlTemplate('ftp://host{encodedPath}')).toThrow(/http/);
  });

  it('encodes a root path without changing slashes', () => {
    expect(encodePath('/A B/C#D/E.mkv')).toBe('/A%20B/C%23D/E.mkv');
  });
});
