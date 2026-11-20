import picomatch from 'picomatch';
import { extname } from 'node:path';
import { config } from './config.js';
import { isIgnoredSegment, normalizeSourcePath, relativeSourcePath } from './core/paths.js';
import type { RemoteFile } from './core/manifest.js';
import type { StorageClient } from './storage.js';
import type { LibraryRecord } from './types.js';

const SIDECAR_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'vtt', 'nfo', 'jpg', 'jpeg', 'png', 'webp', 'bif']);

export interface ScanProgress {
  directories: number;
  files: number;
  currentPath: string;
}

export interface ScanOptions {
  signal: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

export interface ScanResult {
  files: RemoteFile[];
  sidecars: RemoteFile[];
  scanned: number;
  extensions: Record<string, number>;
}

function compileExcluder(patterns: string[]): (relative: string, name: string, isDir: boolean) => boolean {
  const valid = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  if (valid.length === 0) return () => false;
  let matcher: (value: string) => boolean;
  try {
    matcher = picomatch(valid, { dot: true, nocase: true });
  } catch {
    return () => false;
  }
  return (relative, name, isDir) => {
    const candidates = [relative, name, isDir ? `${relative}/` : relative];
    return candidates.some((candidate) => matcher(candidate));
  };
}

export function normalizeExcludePatterns(patterns: string[]): string[] {
  const result: string[] = [];
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!pattern) continue;
    try {
      picomatch(pattern);
      result.push(pattern);
    } catch {
      // Ignore malformed globs instead of breaking a library.
    }
  }
  return Array.from(new Set(result));
}

export async function scanLibrary(
  client: StorageClient,
  library: Pick<
    LibraryRecord,
    'sourcePath' | 'extensions' | 'excludePatterns' | 'minSizeMB'
  >,
  options: ScanOptions,
): Promise<ScanResult> {
  const basePath = normalizeSourcePath(library.sourcePath);
  const extensions = new Set(library.extensions.map((value) => value.toLowerCase()));
  const minBytes = Math.max(0, library.minSizeMB) * 1024 * 1024;
  const isExcluded = compileExcluder(library.excludePatterns);
  const files: RemoteFile[] = [];
  const sidecars: RemoteFile[] = [];
  const extensionCounts: Record<string, number> = {};
  const visited = new Set<string>();
  const stack: Array<{ path: string; depth: number }> = [{ path: basePath, depth: 0 }];
  let scanned = 0;
  let directories = 0;
  let lastProgress = 0;

  while (stack.length > 0) {
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const current = stack.pop()!;
    if (current.depth > 40) continue;
    if (visited.has(current.path)) continue;
    visited.add(current.path);

    const entries = await client.list(current.path, options.signal);
    directories += 1;
    for (const entry of entries) {
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (isIgnoredSegment(entry.name)) continue;
      const fullPath =
        current.path === '/' ? `/${entry.name}` : `${current.path}/${entry.name}`;
      let relative: string;
      try {
        relative = relativeSourcePath(basePath, fullPath);
      } catch {
        continue;
      }
      if (!relative) continue;
      if (isExcluded(relative, entry.name, entry.isDir)) continue;

      if (entry.isDir) {
        stack.push({ path: fullPath, depth: current.depth + 1 });
        continue;
      }

      scanned += 1;
      const extension = extname(entry.name).replace(/^\./, '').toLowerCase();
      if (SIDECAR_EXTENSIONS.has(extension)) {
        sidecars.push({
          path: fullPath,
          relative,
          name: entry.name,
          extension: `.${extension}`,
          size: entry.size,
          modified: entry.modified,
        });
        continue;
      }
      if (!extensions.has(extension)) continue;
      if (minBytes > 0 && entry.size < minBytes) continue;
      files.push({
        path: fullPath,
        relative,
        name: entry.name,
        extension,
        size: entry.size,
        modified: entry.modified,
      });
      extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1;
      if (files.length > config.scanFileLimit) {
        throw new Error(`扫描文件数超过 ${config.scanFileLimit} 个上限，请缩小媒体库路径`);
      }
    }

    const now = Date.now();
    if (now - lastProgress > 1200) {
      lastProgress = now;
      options.onProgress?.({
        directories,
        files: files.length,
        currentPath: current.path,
      });
    }
  }

  files.sort((left, right) => left.relative.localeCompare(right.relative));
  sidecars.sort((left, right) => left.relative.localeCompare(right.relative));
  options.onProgress?.({ directories, files: files.length, currentPath: basePath });
  return { files, sidecars, scanned, extensions: extensionCounts };
}
