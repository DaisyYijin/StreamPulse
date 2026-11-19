import path from 'node:path';

export interface UrlTemplateVars {
  sourceUrl: string;
  path: string;
  file: string;
  ext: string;
}

const ALLOWED = new Set(['sourceUrl', 'encodedPath', 'path', 'file', 'name', 'ext', 'dir']);

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export function encodePath(pathValue: string): string {
  return pathValue
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildVars(input: UrlTemplateVars): Record<string, string> {
  const file = path.posix.basename(input.path);
  const ext = path.posix.extname(file);
  return {
    sourceUrl: input.sourceUrl.replace(/\/+$/, ''),
    encodedPath: encodePath(input.path),
    path: input.path,
    file,
    name: ext ? file.slice(0, -ext.length) : file,
    ext: ext.replace(/^\./, '').toLowerCase(),
    dir: path.posix.dirname(input.path),
  };
}

export function validateUrlTemplate(template: string): void {
  if (!template || template.length > 1000) {
    throw new TemplateError('URL 模板不能为空且不能超过 1000 字符');
  }
  if (!template.includes('{encodedPath}') && !template.includes('{path}')) {
    throw new TemplateError('URL 模板必须包含 {encodedPath} 或 {path}');
  }
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    if (!ALLOWED.has(match[1] ?? '')) {
      throw new TemplateError(`未知模板变量：{${match[1]}}`);
    }
  }
  try {
    renderUrlTemplate(template, {
      sourceUrl: 'http://127.0.0.1:5244',
      path: '/Movies/Inception (2010)/Inception.mkv',
      file: 'Inception.mkv',
      ext: 'mkv',
    });
  } catch (error) {
    throw new TemplateError(error instanceof Error ? error.message : 'URL 模板无效');
  }
}

export function renderUrlTemplate(template: string, input: UrlTemplateVars): string {
  const vars = buildVars(input);
  const rendered = template.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    if (!ALLOWED.has(key)) return whole;
    return vars[key] ?? whole;
  });
  let parsed: URL;
  try {
    parsed = new URL(rendered);
  } catch {
    throw new TemplateError('模板生成的 URL 无效，请检查 {sourceUrl} 与模板格式');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TemplateError('STRM 链接必须是 http 或 https');
  }
  return rendered;
}
