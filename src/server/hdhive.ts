import type { HdhiveSettings } from '../shared/types.js';
import { searchTmdbCandidates, type TmdbCandidate } from './tmdb.js';

export interface HdhiveResource {
  slug: string;
  title: string;
  matchedTitle: string;
  matchedYear: string;
  panType: string;
  size: string;
  resolutions: string[];
  sources: string[];
  unlockPoints: number;
  isUnlocked: boolean;
  isOfficial: boolean;
  isValid: boolean;
}

export interface HdhiveSearchResult {
  candidates: TmdbCandidate[];
  results: HdhiveResource[];
  warnings: string[];
}

function base(settings: HdhiveSettings): string {
  return (settings.baseUrl || 'https://hdhive.com').trim().replace(/\/+$/, '');
}

async function request(settings: HdhiveSettings, path: string): Promise<any> {
  if (!settings.apiKey.trim()) throw new Error('请先在设置中填写影巢 API Key');
  if (!settings.userToken.trim()) throw new Error('请先在设置中填写影巢 OpenAPI 用户 Token');
  const response = await fetch(`${base(settings)}${path}`, {
    headers: {
      'X-API-Key': settings.apiKey.trim(),
      Authorization: `Bearer ${settings.userToken.trim()}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`影巢返回非 JSON（HTTP ${response.status}）`); }
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || payload?.error || `影巢请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

export async function testHdhive(settings: HdhiveSettings): Promise<{ message: string }> {
  if (!settings.apiKey.trim()) throw new Error('请填写影巢 API Key');
  const response = await fetch(`${base(settings)}/api/open/ping`, {
    headers: { 'X-API-Key': settings.apiKey.trim(), Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `影巢连接失败（HTTP ${response.status}）`);
  }
  return { message: payload?.message || '影巢 API Key 有效' };
}

function resolutionRank(value: string): number {
  const upper = value.toUpperCase();
  if (upper.includes('4K') || upper.includes('2160')) return 0;
  if (upper.includes('1080')) return 1;
  if (upper.includes('720')) return 2;
  return 3;
}

function sourceRank(value: string): number {
  if (value.includes('蓝光') || /remux/i.test(value)) return 0;
  if (/web-dl|webrip/i.test(value)) return 1;
  return 2;
}

function sortResources(items: HdhiveResource[]): HdhiveResource[] {
  return items.sort((left, right) => {
    const pan = Number(left.panType.toLowerCase() !== '115') - Number(right.panType.toLowerCase() !== '115');
    if (pan) return pan;
    const free = Number(left.unlockPoints > 0) - Number(right.unlockPoints > 0);
    if (free) return free;
    const valid = Number(!left.isValid) - Number(!right.isValid);
    if (valid) return valid;
    const resolution = Math.min(...left.resolutions.map(resolutionRank), 3) - Math.min(...right.resolutions.map(resolutionRank), 3);
    if (resolution) return resolution;
    return Math.min(...left.sources.map(sourceRank), 3) - Math.min(...right.sources.map(sourceRank), 3);
  });
}

export async function searchHdhive(options: {
  keyword: string;
  mediaType: 'movie' | 'tv' | 'auto';
  year?: string;
  settings: HdhiveSettings;
  tmdbApiKey: string;
  tmdbLanguage: string;
}): Promise<HdhiveSearchResult> {
  const keyword = options.keyword.trim();
  if (!keyword) throw new Error('请输入搜索关键词');
  const candidates = await searchTmdbCandidates({
    keyword,
    mediaType: options.mediaType,
    year: options.year,
    apiKey: options.tmdbApiKey,
    language: options.tmdbLanguage,
    limit: 6,
  });
  if (candidates.length === 0) {
    return { candidates: [], results: [], warnings: ['TMDb 没有找到匹配条目'] };
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  const results: HdhiveResource[] = [];
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const payload = await request(options.settings, `/api/open/resources/${candidate.mediaType}/${candidate.id}`);
      const list = Array.isArray(payload?.data) ? payload.data : [];
      for (const raw of list) {
        const slug = String(raw?.slug || '').trim();
        if (!slug || seen.has(slug)) continue;
        const resolutions = Array.isArray(raw?.video_resolution) ? raw.video_resolution.map(String) : [];
        const sources = Array.isArray(raw?.source) ? raw.source.map(String) : [];
        seen.add(slug);
        results.push({
          slug,
          title: String(raw?.title || candidate.title),
          matchedTitle: candidate.title,
          matchedYear: candidate.year,
          panType: String(raw?.pan_type || ''),
          size: String(raw?.share_size || ''),
          resolutions,
          sources,
          unlockPoints: Number(raw?.unlock_points || 0),
          isUnlocked: Boolean(raw?.is_unlocked),
          isOfficial: Boolean(raw?.is_official),
          isValid: raw?.is_valid === undefined || raw?.is_valid === null ? true : Boolean(raw?.is_valid),
        });
      }
    } catch (error) {
      warnings.push(`${candidate.title}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { candidates, results: sortResources(results), warnings };
}
