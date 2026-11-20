import path from 'node:path';
import type { OrganizeCategory, OrganizerSettings } from '../shared/types.js';
import { normalizeSourcePath } from './core/paths.js';
import type { StorageClient, StorageEntry } from './storage.js';
import { searchTmdb, TmdbError, type TmdbInfo } from './tmdb.js';
import { makeId } from './types.js';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.ts', '.m2ts', '.flv', '.webm', '.rmvb']);
const QUALITY_RE = /(2160p|1080p|1080i|720p|576p|480p)/i;
const SOURCE_RE = /(remux|bluray|blu-ray|web-dl|webrip|hdtv|dvdrip|bdrip)/i;

export interface OrganizeItem {
  id: string;
  sourcePath: string;
  relativePath: string;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  season: number;
  episode: number;
  tmdbId: number | null;
  category: string;
  destinationDir: string;
  destinationName: string;
  destination: string;
  quality: string;
  existingPaths: string[];
  existingQuality: string;
  action: 'create' | 'upgrade' | 'skip' | 'error';
  reason: string;
}

export interface OrganizeBatch {
  id: string;
  sourceId: string;
  createdAt: string;
  items: OrganizeItem[];
}

const batches = new Map<string, OrganizeBatch>();

function cloudJoin(...parts: string[]): string {
  return normalizeSourcePath(`/${parts.join('/')}`.replace(/\/+/g, '/'));
}

function safeComponent(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '未命名';
}

function parseName(filename: string): {
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  season: number;
  episode: number;
} {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ');
  const episodeMatch = base.match(/S(\d{1,2})\s*E(\d{1,3})/i) || base.match(/(\d{1,2})x(\d{1,3})/i);
  const yearMatch = base.match(/(?:^|[\s(])((?:19|20)\d{2})(?:[\s)]|$)/);
  const year = yearMatch?.[1] || '';
  let title = base;
  if (episodeMatch?.index !== undefined) title = base.slice(0, episodeMatch.index);
  else if (yearMatch?.index !== undefined) title = base.slice(0, yearMatch.index);
  title = title
    .replace(QUALITY_RE, ' ')
    .replace(SOURCE_RE, ' ')
    .replace(/\b(HDR|DV|Dolby Vision|Atmos|DTS|HEVC|AVC|AV1|10bit|8bit|DD5\.1|DDP5\.1)\b/gi, ' ')
    .replace(/\[\s*\]|\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    mediaType: episodeMatch ? 'tv' : 'movie',
    title: title || base,
    year,
    season: episodeMatch ? Number(episodeMatch[1]) : 0,
    episode: episodeMatch ? Number(episodeMatch[2]) : 0,
  };
}

function qualityOf(filename: string): string {
  return [
    filename.match(QUALITY_RE)?.[1]?.toLowerCase() || '',
    filename.match(SOURCE_RE)?.[1]?.toLowerCase() || '',
    (/\b(DV|Dolby Vision|HDR10\+?|HDR)\b/i.exec(filename)?.[1] || '').toUpperCase(),
    (/\b(HEVC|H\.?265|AVC|H\.?264|AV1)\b/i.exec(filename)?.[1] || '').toUpperCase(),
  ].filter(Boolean).join(' ');
}

function qualityScore(filename: string): number[] {
  const lower = filename.toLowerCase();
  return [
    lower.includes('2160p') ? 4 : lower.includes('1080p') ? 3 : lower.includes('720p') ? 2 : 1,
    /remux/.test(lower) ? 5 : /bluray|blu-ray/.test(lower) ? 4 : /web-dl/.test(lower) ? 3 : /webrip/.test(lower) ? 2 : /hdtv/.test(lower) ? 1 : 0,
    /dolby vision|\bdv\b|hdr/.test(lower) ? 1 : 0,
    /hevc|h\.?265|av1/.test(lower) ? 2 : /avc|h\.?264/.test(lower) ? 1 : 0,
  ];
}

function betterQuality(next: string, existing: string): boolean {
  const left = qualityScore(next);
  const right = qualityScore(existing);
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

function categoryFor(info: TmdbInfo, categories: OrganizeCategory[], filename: string): string {
  const lower = filename.toLowerCase();
  for (const category of categories.filter((item) => item.mediaType === info.mediaType)) {
    const checks: boolean[] = [];
    if (category.genres.length) checks.push(category.genres.some((genre) => info.genres.some((value) => value.toLowerCase() === genre.toLowerCase())));
    if (category.countries.length) checks.push(category.countries.some((country) => info.countries.some((value) => value.toUpperCase() === country.toUpperCase())));
    if (category.languages.length) checks.push(category.languages.some((language) => info.languages.some((value) => value.toLowerCase() === language.toLowerCase())));
    if (category.keywords.length) checks.push(category.keywords.some((keyword) => lower.includes(keyword.toLowerCase()) || info.title.toLowerCase().includes(keyword.toLowerCase())));
    if (checks.length === 0 || checks.every(Boolean)) return category.name;
  }
  return '其他';
}

async function listDir(client: StorageClient, dir: string): Promise<StorageEntry[]> {
  return client.list(normalizeSourcePath(dir));
}

async function ensureDir(client: StorageClient, dir: string): Promise<void> {
  if (!client.mkdir) throw new Error('当前来源不支持创建目录');
  await client.mkdir(normalizeSourcePath(dir));
}

async function scanCloud(client: StorageClient, sourcePath: string): Promise<Array<{ path: string; entry: StorageEntry }>> {
  const files: Array<{ path: string; entry: StorageEntry }> = [];
  const stack = [normalizeSourcePath(sourcePath)];
  let visited = 0;
  while (stack.length > 0 && files.length < 2500) {
    const current = stack.pop()!;
    visited += 1;
    if (visited > 800) break;
    const entries = await listDir(client, current);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = cloudJoin(current === '/' ? '' : current, entry.name);
      if (entry.isDir) stack.push(full);
      else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push({ path: full, entry });
    }
  }
  return files;
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (_match, key: string) => variables[key.toLowerCase()] ?? '');
}

function templateSegments(template: string): string[] {
  return template.split('/').map((segment) => safeComponent(segment)).filter(Boolean);
}

function targetFor(
  settings: OrganizerSettings,
  info: TmdbInfo,
  parsed: ReturnType<typeof parseName>,
  category: string,
  extension: string,
  quality: string,
): { dir: string; name: string } {
  const title = info.title || parsed.title;
  const year = info.year || parsed.year;
  const season = String(parsed.season || 1).padStart(2, '0');
  const episode = String(parsed.episode || 1).padStart(2, '0');
  const variables = {
    title,
    year,
    season,
    episode,
    quality: quality ? ` [${quality}]` : '',
    ext: extension,
    category,
  };
  if (parsed.mediaType === 'tv') {
    const folder = templateSegments(renderTemplate(settings.tvFolderTemplate, variables));
    const name = renderTemplate(settings.tvFileTemplate, variables);
    return {
      dir: cloudJoin(settings.libraryPath, 'TV', category, ...folder),
      name: name.toLowerCase().endsWith(extension.toLowerCase()) ? name : `${name}${extension}`,
    };
  }
  const folder = templateSegments(renderTemplate(settings.movieFolderTemplate, variables));
  const name = renderTemplate(settings.movieFileTemplate, variables);
  return {
    dir: cloudJoin(settings.libraryPath, 'Movies', category, ...folder),
    name: name.toLowerCase().endsWith(extension.toLowerCase()) ? name : `${name}${extension}`,
  };
}

async function existingFor(client: StorageClient, dir: string, mediaType: 'movie' | 'tv', season: number, episode: number): Promise<StorageEntry[]> {
  const entries = await listDir(client, dir).catch(() => [] as StorageEntry[]);
  const videos = entries.filter((entry) => !entry.isDir && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  if (mediaType === 'tv') {
    const pattern = new RegExp(`S0?${season}E0?${episode}`, 'i');
    return videos.filter((entry) => pattern.test(entry.name));
  }
  return videos;
}

export async function scanCloudOrganizer(settings: OrganizerSettings, client: StorageClient): Promise<OrganizeBatch> {
  if (!settings.sourceId) throw new Error('请先选择来源账号');
  if (!settings.tmdbApiKey.trim()) throw new Error('请先填写 TMDb API Key');
  if (!client.mkdir || !client.move || !client.rename || !client.remove) {
    throw new Error('当前来源不支持网盘整理，请使用 115 或 123 原生账号');
  }
  const sourcePath = normalizeSourcePath(settings.sourcePath || '/');
  const libraryPath = normalizeSourcePath(settings.libraryPath || '/Media');
  if (sourcePath === libraryPath) throw new Error('待整理目录不能与媒体库目录相同');
  const files = await scanCloud(client, sourcePath);
  const items: OrganizeItem[] = [];
  const cache = new Map<string, TmdbInfo | null>();

  for (const { path: filePath, entry } of files) {
    const parsed = parseName(entry.name);
    const base: OrganizeItem = {
      id: makeId('org'),
      sourcePath: filePath,
      relativePath: path.relative(sourcePath, filePath).replace(/\\/g, '/'),
      mediaType: parsed.mediaType,
      title: parsed.title,
      year: parsed.year,
      season: parsed.season,
      episode: parsed.episode,
      tmdbId: null,
      category: '其他',
      destinationDir: '',
      destinationName: '',
      destination: '',
      quality: qualityOf(entry.name),
      existingPaths: [],
      existingQuality: '',
      action: 'error',
      reason: '',
    };
    try {
      const key = `${parsed.mediaType}:${parsed.title.toLowerCase()}:${parsed.year}`;
      let info = cache.get(key);
      if (info === undefined) {
        info = await searchTmdb({ mediaType: parsed.mediaType, title: parsed.title, year: parsed.year, apiKey: settings.tmdbApiKey, language: settings.tmdbLanguage });
        cache.set(key, info);
      }
      if (!info) throw new Error('TMDb 未找到匹配条目');
      const category = categoryFor(info, settings.categories, entry.name);
      const target = targetFor(settings, info, parsed, category, path.extname(entry.name).toLowerCase(), qualityOf(entry.name));
      const existing = await existingFor(client, target.dir, parsed.mediaType, parsed.season, parsed.episode);
      const best = existing.sort((a, b) => {
        const left = qualityScore(a.name), right = qualityScore(b.name);
        for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return right[i] - left[i];
        return 0;
      })[0];
      let action: OrganizeItem['action'] = 'create';
      let reason = '新增入库';
      if (best) {
        if (settings.upgradeStrategy === 'off') {
          action = 'skip'; reason = '目标已存在，洗版关闭';
        } else if (settings.upgradeStrategy === 'always') {
          action = 'upgrade'; reason = '策略：总是替换';
        } else if (settings.upgradeStrategy === 'max_size') {
          if (entry.size > best.size) { action = 'upgrade'; reason = '策略：保留体积更大的版本'; }
          else { action = 'skip'; reason = '已有版本体积更大或相同'; }
        } else if (settings.upgradeStrategy === 'min_size') {
          if (entry.size < best.size) { action = 'upgrade'; reason = '策略：保留体积更小的版本'; }
          else { action = 'skip'; reason = '已有版本体积更小或相同'; }
        } else if (betterQuality(entry.name, best.name)) {
          action = 'upgrade'; reason = '新版本画质更好';
        } else {
          action = 'skip'; reason = '目标已有更好或相同版本';
        }
      }
      items.push({
        ...base,
        tmdbId: info.id,
        title: info.title,
        year: info.year || parsed.year,
        category,
        destinationDir: target.dir,
        destinationName: target.name,
        destination: cloudJoin(target.dir, target.name),
        existingPaths: existing.map((item) => cloudJoin(target.dir, item.name)),
        existingQuality: best ? qualityOf(best.name) : '',
        action,
        reason,
      });
    } catch (error) {
      items.push({ ...base, action: 'error', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const batch: OrganizeBatch = { id: makeId('batch'), sourceId: settings.sourceId, createdAt: new Date().toISOString(), items };
  batches.set(batch.id, batch);
  setTimeout(() => batches.delete(batch.id), 30 * 60_000).unref?.();
  return batch;
}

export async function executeCloudOrganizerBatch(batchId: string, client: StorageClient, settings: OrganizerSettings): Promise<{ executed: number; failed: number; skipped: number; results: string[] }> {
  const batch = batches.get(batchId);
  if (!batch) throw new Error('整理预览已过期，请重新扫描');
  if (!client.mkdir || !client.move || !client.rename || !client.remove) throw new Error('当前来源不支持整理');
  const results: string[] = [];
  let executed = 0, failed = 0, skipped = 0;
  for (const item of batch.items) {
    if (item.action === 'error') {
      try {
        if (!settings.failedPath) throw new Error('未配置识别失败目录');
        await ensureDir(client, settings.failedPath);
        await client.move(item.sourcePath, settings.failedPath);
        failed += 1;
        results.push(`! ${item.relativePath} → 识别失败目录：${item.reason}`);
      } catch (error) {
        failed += 1;
        results.push(`✗ ${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    if (item.action === 'skip') {
      try {
        if (settings.redundantPath) {
          await ensureDir(client, settings.redundantPath);
          await client.move(item.sourcePath, settings.redundantPath);
        }
        skipped += 1;
        results.push(`- ${item.relativePath} → 冗余文件目录`);
      } catch (error) {
        failed += 1;
        results.push(`✗ ${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    try {
      await ensureDir(client, item.destinationDir);
      if (item.action === 'upgrade') {
        for (const oldPath of item.existingPaths) await client.remove(oldPath);
      }
      await client.rename(item.sourcePath, item.destinationName);
      const renamedPath = cloudJoin(path.posix.dirname(item.sourcePath), item.destinationName);
      await client.move(renamedPath, item.destinationDir);
      executed += 1;
      results.push(`✓ ${item.relativePath} → ${item.destination}`);
    } catch (error) {
      failed += 1;
      results.push(`✗ ${item.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  batches.delete(batchId);
  return { executed, failed, skipped, results };
}

export function isTmdbError(error: unknown): error is TmdbError {
  return error instanceof TmdbError;
}
