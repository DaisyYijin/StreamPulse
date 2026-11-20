import path from 'node:path';
import type { Request, Response } from 'express';
import { normalizeSourcePath } from './core/paths.js';
import type { RunManager } from './runner.js';
import type { Store } from './store.js';

function collectPaths(body: any): string[] {
  if (Array.isArray(body)) return body.flatMap(collectPaths);
  if (!body || typeof body !== 'object') return [];
  const values = [
    body.path,
    body.file_path,
    body.filePath,
    body.source_file,
    body.sourceFile,
    body.destination_file,
    body.destinationFile,
  ];
  if (Array.isArray(body.paths)) values.push(...body.paths);
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())));
}

export async function handleCloudDriveWebhook(
  req: Request,
  res: Response,
  store: Store,
  runner: RunManager,
): Promise<void> {
  const expected = store.snapshot.settings.cloudDrive.webhookToken.trim();
  const provided = String(req.query.token || req.header('x-streampulse-token') || '').trim();
  if (!expected) {
    res.status(503).json({ error: 'CloudDrive2 Webhook Token 未配置' });
    return;
  }
  if (provided !== expected) {
    res.status(403).json({ error: 'Webhook Token 无效' });
    return;
  }
  const paths = collectPaths(req.body);
  if (!paths.length) {
    res.json({ ok: true, matched: 0, message: '没有文件路径' });
    return;
  }
  let matched = 0;
  const started: string[] = [];
  for (const library of store.snapshot.libraries) {
    if (!library.enabled) continue;
    const sourcePath = normalizeSourcePath(library.sourcePath);
    const affected = paths.filter((path) => {
      const normalized = normalizeSourcePath(path);
      return normalized === sourcePath || normalized.startsWith(`${sourcePath}/`);
    });
    if (!affected.length) continue;
    matched += 1;
    const scopeFile = affected.sort((left, right) => right.length - left.length)[0];
    const scope = normalizeSourcePath(path.posix.dirname(scopeFile) || '/');
    try {
      await runner.start(library.id, 'watch', { scope });
      started.push(library.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('已有任务')) console.warn(`[clouddrive] ${library.name}: ${message}`);
    }
  }
  res.json({ ok: true, matched, started });
}
