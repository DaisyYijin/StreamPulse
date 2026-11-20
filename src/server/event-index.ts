import { normalizeSourcePath } from './core/paths.js';
import type { StorageClient } from './storage.js';

export interface DirectoryIndex {
  rootId: string;
  dirs: Map<string, string>;
}

/**
 * Build a CID -> relative-path map using directories only. This is deliberately
 * limited so event-level incremental runs do not need a full file scan.
 */
export async function buildDirectoryIndex(
  client: StorageClient,
  sourcePath: string,
  signal: AbortSignal,
  maxDirectories = 20_000,
): Promise<DirectoryIndex> {
  const basePath = normalizeSourcePath(sourcePath);
  const rootId = (await client.resolveId?.(basePath, signal)) || '';
  const dirs = new Map<string, string>();
  if (rootId) dirs.set(rootId, '');
  const visited = new Set<string>();
  const stack: Array<{ path: string; relative: string }> = [{ path: basePath, relative: '' }];
  let count = 0;

  while (stack.length > 0) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const current = stack.pop()!;
    if (visited.has(current.path)) continue;
    visited.add(current.path);
    const entries = await client.list(current.path, signal);
    for (const entry of entries) {
      if (!entry.isDir) continue;
      count += 1;
      if (count > maxDirectories) throw new Error('目录数量超过事件索引上限');
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.id) dirs.set(String(entry.id), relative);
      stack.push({
        path: current.path === '/' ? `/${entry.name}` : `${current.path}/${entry.name}`,
        relative,
      });
    }
  }

  return { rootId, dirs };
}
