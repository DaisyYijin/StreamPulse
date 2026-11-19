import path from 'node:path';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

export function normalizeSourcePath(input: string): string {
  const trimmed = (input || '/').trim().replace(/\\/g, '/');
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new PathSafetyError('路径包含非法控制字符');
  }
  const segments = trimmed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new PathSafetyError('路径不能包含 ..');
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function normalizeTargetPath(input: string): string {
  const trimmed = (input || '').trim().replace(/\\/g, '/');
  if (!trimmed) throw new PathSafetyError('输出目录不能为空');
  if (CONTROL_CHARACTERS.test(trimmed)) throw new PathSafetyError('输出目录包含非法控制字符');
  const segments = trimmed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) throw new PathSafetyError('输出目录不能为空');
  if (segments.some((segment) => segment === '..')) {
    throw new PathSafetyError('输出目录不能包含 ..');
  }
  return segments.join('/');
}

export function ensureWithin(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new PathSafetyError('目标路径超出了输出目录');
}

export function safeJoin(root: string, relative: string): string {
  return ensureWithin(root, path.resolve(root, relative));
}

export function relativeSourcePath(base: string, fullPath: string): string {
  const normalizedBase = normalizeSourcePath(base);
  const normalizedFull = normalizeSourcePath(fullPath);
  if (normalizedFull === normalizedBase) return '';
  const prefix = normalizedBase === '/' ? '/' : `${normalizedBase}/`;
  if (!normalizedFull.startsWith(prefix)) {
    throw new PathSafetyError('源文件不在媒体库路径内');
  }
  return normalizedFull.slice(prefix.length);
}

export function strmRelativePath(targetPath: string, sourceRelative: string): string {
  const normalizedRelative = sourceRelative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRelative || normalizedRelative.split('/').some((part) => part === '..')) {
    throw new PathSafetyError('源文件相对路径无效');
  }
  const directory = path.posix.dirname(normalizedRelative);
  const filename = path.posix.basename(normalizedRelative);
  const extension = path.posix.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const strmName = `${stem}.strm`;
  return [normalizeTargetPath(targetPath), directory === '.' ? '' : directory, strmName]
    .filter(Boolean)
    .join('/');
}

const IGNORED_SEGMENTS = new Set([
  '@eadir',
  '#recycle',
  '$recycle.bin',
  'system volume information',
  'lost+found',
  'node_modules',
]);

export function isIgnoredSegment(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || IGNORED_SEGMENTS.has(lower);
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  if (index <= 0 || index === filename.length - 1) return '';
  return filename.slice(index + 1).toLowerCase();
}

export function normalizeExtensions(input: string[]): string[] {
  return Array.from(
    new Set(
      input
        .flatMap((value) => value.split(/[,;\s]+/))
        .map((value) => value.trim().replace(/^\.+/, '').toLowerCase())
        .filter((value) => /^[a-z0-9]{1,12}$/.test(value)),
    ),
  ).sort();
}
