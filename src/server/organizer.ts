import fs from 'node:fs/promises';
import path from 'node:path';
import type { OrganizeCategory, OrganizerSettings } from '../shared/types.js';
import { makeId } from './types.js';
import { searchTmdb, TmdbError, type TmdbInfo } from './tmdb.js';

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
  destination: string;
  quality: string;
  existingPath: string | null;
  existingQuality: string;
  action: 'create' | 'upgrade' | 'skip' | 'error';
  reason: string;
}

export interface OrganizeBatch {
  id: string;
  createdAt: string;
  items: OrganizeItem[];
}

const batches = new Map<string, OrganizeBatch>();

function within(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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
  const resolution = filename.match(QUALITY_RE)?.[1]?.toLowerCase() || '';
  const source = filename.match(SOURCE_RE)?.[1]?.toLowerCase() || '';
  const hdr = /\b(DV|Dolby Vision|HDR10\+?|HDR)\b/i.exec(filename)?.[1]?.toUpperCase() || '';
  const codec = /\b(HEVC|H\.?265|AVC|H\.?264|AV1)\b/i.exec(filename)?.[1]?.toUpperCase() || '';
  return [resolution, source, hdr, codec].filter(Boolean).join(' ');
}

function qualityScore(filename: string): number[] {
  const lower = filename.toLowerCase();
  const resolution = lower.includes('2160p') ? 4 : lower.includes('1080p') ? 3 : lower.includes('720p') ? 2 : 1;
  const source = /remux/.test(lower) ? 5 : /bluray|blu-ray/.test(lower) ? 4 : /web-dl/.test(lower) ? 3 : /webrip/.test(lower) ? 2 : /hdtv/.test(lower) ? 1 : 0;
  const hdr = /dolby vision|\bdv\b|hdr/.test(lower) ? 1 : 0;
  const codec = /hevc|h\.?265|av1/.test(lower) ? 2 : /avc|h\.?264/.test(lower) ? 1 : 0;
  return [resolution, source, hdr, codec];
}

function betterQuality(next: string, existing: string): boolean {
  const left = qualityScore(next);
  const right = qualityScore(existing);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
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

async function listVideoFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const stack = [root];
  while (stack.length && result.length < 2500) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(full);
    }
  }
  return result;
}

async function findExisting(destination: string, mediaType: 'movie' | 'tv', season: number, episode: number): Promise<string | null> {
  const folder = path.dirname(destination);
  const files = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const candidates = files
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(folder, entry.name));
  const scoped = mediaType === 'tv'
    ? candidates.filter((file) => new RegExp(`S0?${season}E0?${episode}`, 'i').test(path.basename(file)))
    : candidates;
  return scoped.sort((left, right) => {
    const a = qualityScore(path.basename(left));
    const b = qualityScore(path.basename(right));
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index];
    }
    return 0;
  })[0] || null;
}

function destinationFor(settings: OrganizerSettings, info: TmdbInfo, parsed: ReturnType<typeof parseName>, category: string, original: string): string {
  const title = safeComponent(info.title || parsed.title);
  const year = info.year || parsed.year;
  const quality = qualityOf(original);
  const ext = path.extname(original);
  if (parsed.mediaType === 'tv') {
    const season = parsed.season || 1;
    const episode = parsed.episode || 1;
    const root = path.join(settings.libraryDir, 'TV', category, `${title}${year ? ` (${year})` : ''}`, `Season ${String(season).padStart(2, '0')}`);
    const episodeTag = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    return path.join(root, `${title} - ${episodeTag}${quality ? ` [${quality}]` : ''}${ext}`);
  }
  const root = path.join(settings.libraryDir, 'Movies', category, `${title}${year ? ` (${year})` : ''}`);
  return path.join(root, `${title}${year ? ` (${year})` : ''}${quality ? ` [${quality}]` : ''}${ext}`);
}

export async function scanOrganizer(settings: OrganizerSettings): Promise<OrganizeBatch> {
  const importDir = path.resolve(settings.importDir);
  const libraryDir = path.resolve(settings.libraryDir);
  if (!within(importDir, path.join(importDir, 'probe'))) throw new Error('导入目录无效');
  if (!within(libraryDir, path.join(libraryDir, 'probe'))) throw new Error('媒体库目录无效');
  if (importDir === libraryDir) throw new Error('导入目录不能与媒体库目录相同');
  await fs.access(importDir).catch(() => { throw new Error(`导入目录不存在：${importDir}`); });
  await fs.mkdir(libraryDir, { recursive: true });
  if (!settings.tmdbApiKey.trim()) throw new Error('请先填写 TMDb API Key');

  const files = await listVideoFiles(importDir);
  const items: OrganizeItem[] = [];
  const tmdbCache = new Map<string, TmdbInfo | null>();

  for (const file of files) {
    const parsed = parseName(path.basename(file));
    const relative = path.relative(importDir, file);
    const base: OrganizeItem = {
      id: makeId('org'),
      sourcePath: file,
      relativePath: relative,
      mediaType: parsed.mediaType,
      title: parsed.title,
      year: parsed.year,
      season: parsed.season,
      episode: parsed.episode,
      tmdbId: null,
      category: '其他',
      destination: '',
      quality: qualityOf(path.basename(file)),
      existingPath: null,
      existingQuality: '',
      action: 'error',
      reason: '',
    };
    try {
      const cacheKey = `${parsed.mediaType}:${parsed.title.toLowerCase()}:${parsed.year}`;
      let info = tmdbCache.get(cacheKey);
      if (info === undefined) {
        info = await searchTmdb({ ...parsed, apiKey: settings.tmdbApiKey, language: settings.tmdbLanguage });
        tmdbCache.set(cacheKey, info);
      }
      if (!info) throw new Error('TMDb 未找到匹配条目');
      const category = categoryFor(info, settings.categories, path.basename(file));
      const destination = destinationFor(settings, info, parsed, category, path.basename(file));
      const existingPath = await findExisting(destination, parsed.mediaType, parsed.season, parsed.episode);
      const existingQuality = existingPath ? qualityOf(path.basename(existingPath)) : '';
      let action: OrganizeItem['action'] = 'create';
      let reason = '新增入库';
      if (existingPath) {
        if (settings.upgradeStrategy === 'off') {
          action = 'skip';
          reason = '已存在，洗版关闭';
        } else if (settings.upgradeStrategy === 'always') {
          action = 'upgrade';
          reason = '策略：总是替换';
        } else if (betterQuality(path.basename(file), path.basename(existingPath))) {
          action = 'upgrade';
          reason = '新版本画质更好';
        } else {
          action = 'skip';
          reason = '已有版本更好或相同';
        }
      }
      items.push({ ...base, tmdbId: info.id, title: info.title, year: info.year || parsed.year, category, destination, existingPath, existingQuality, action, reason });
    } catch (error) {
      items.push({ ...base, action: 'error', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const batch: OrganizeBatch = { id: makeId('batch'), createdAt: new Date().toISOString(), items };
  batches.set(batch.id, batch);
  setTimeout(() => batches.delete(batch.id), 30 * 60_000).unref?.();
  return batch;
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.copyFile(source, destination);
    await fs.unlink(source);
  }
}

async function writeNfo(destination: string, item: OrganizeItem): Promise<void> {
  const folder = path.dirname(destination);
  const nfo = item.mediaType === 'movie'
    ? path.join(folder, 'movie.nfo')
    : path.join(folder, '..', 'tvshow.nfo');
  const exists = await fs.access(nfo).then(() => true).catch(() => false);
  if (exists) return;
  const body = item.mediaType === 'movie'
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<movie>\n  <title>${item.title}</title>\n  <year>${item.year}</year>\n  <tmdbid>${item.tmdbId}</tmdbid>\n</movie>\n`
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<tvshow>\n  <title>${item.title}</title>\n  <year>${item.year}</year>\n  <tmdbid>${item.tmdbId}</tmdbid>\n</tvshow>\n`;
  await fs.writeFile(nfo, body, 'utf8');
}

export async function executeOrganizerBatch(batchId: string, settings: OrganizerSettings): Promise<{ executed: number; failed: number; skipped: number; results: string[] }> {
  const batch = batches.get(batchId);
  if (!batch) throw new Error('整理预览已过期，请重新扫描');
  const results: string[] = [];
  let executed = 0;
  let failed = 0;
  let skipped = 0;
  const trashRoot = path.join(settings.libraryDir, '.trash');

  for (const item of batch.items) {
    if (item.action === 'skip' || item.action === 'error') {
      skipped += 1;
      continue;
    }
    try {
      if (!within(settings.importDir, item.sourcePath)) throw new Error('源文件不在导入目录内');
      if (!within(settings.libraryDir, item.destination)) throw new Error('目标文件不在媒体库目录内');
      await fs.access(item.sourcePath);
      await fs.mkdir(path.dirname(item.destination), { recursive: true });
      if (item.existingPath && item.action === 'upgrade') {
        await fs.mkdir(trashRoot, { recursive: true });
        const trashName = `${Date.now()}-${path.basename(item.existingPath)}`;
        await moveFile(item.existingPath, path.join(trashRoot, trashName)).catch(() => undefined);
      }
      if (settings.mode === 'hardlink') await fs.link(item.sourcePath, item.destination);
      else if (settings.mode === 'copy') await fs.copyFile(item.sourcePath, item.destination);
      else await moveFile(item.sourcePath, item.destination);
      await writeNfo(item.destination, item).catch(() => undefined);
      executed += 1;
      results.push(`✓ ${item.relativePath} → ${path.relative(settings.libraryDir, item.destination)}`);
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
