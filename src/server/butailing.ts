import type { Page } from 'puppeteer-core';
import { openPage } from './browser.js';
import { detectChallenge, fillChallengeCode, waitForChallenge, type ChallengeInfo } from './challenge.js';

const ORIGIN = 'https://web5.mukaku.com';
const BASE_URL = `${ORIGIN}/prod/api/v1/`;
const APP_ID = '83768d9ad4';
const IDENTITY = '23734adac0301bccdcb107c4aa21f96c';

export interface ButailingResult {
  title: string;
  size: string;
  quality: string;
  magnet: string;
  detailUrl: string;
}

export interface ButailingSearchResponse {
  results: ButailingResult[];
  warnings: string[];
  challenge?: ChallengeInfo;
}

async function open(page: Page): Promise<void> {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function api<T>(page: Page, action: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ app_id: APP_ID, identity: IDENTITY, ...params });
  return page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`不太灵返回非 JSON（HTTP ${response.status}）`);
    }
  }, `${BASE_URL}${action}?${query}`) as Promise<T>;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s:：·._-]+/g, '');
}

async function runButailing(page: Page, options: { keyword: string; mediaType: 'movie' | 'tv' | 'auto'; year?: string }): Promise<{ results: ButailingResult[]; warnings: string[] }> {
  const keyword = options.keyword.trim();
  const list = await api<any>(page, 'getVideoList', { sb: keyword, page: '1', limit: '24' });
  const rows: any[] = Array.isArray(list?.data?.data) ? list.data.data : [];
  const targetType = options.mediaType === 'movie' ? 1 : options.mediaType === 'tv' ? 2 : 0;
  const matched = rows.filter((row) => {
    if (targetType && Number(row?.type || 0) !== targetType) return false;
    if (options.year && String(row?.years || '').slice(0, 4) !== options.year) return false;
    return normalize(String(row?.title || '')).includes(normalize(keyword))
      || String(row?.alias || '').includes(keyword);
  });
  const candidates = (matched.length ? matched : rows).slice(0, 3);
  const warnings: string[] = [];
  const results: ButailingResult[] = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    const doubanId = Number(row?.doub_id || 0);
    if (!doubanId) continue;
    try {
      const detailPayload = await api<any>(page, 'getVideoDetail', { id: String(doubanId) });
      const detail = detailPayload?.data || {};
      for (const seed of Array.isArray(detail?.all_seeds) ? detail.all_seeds : []) {
        const magnet = String(seed?.zlink || '').trim();
        if (!magnet.toLowerCase().startsWith('magnet:?') || seen.has(magnet)) continue;
        seen.add(magnet);
        results.push({
          title: String(seed?.zname || detail?.title || row?.title || keyword),
          size: String(seed?.zsize || ''),
          quality: String(seed?.zqxd || ''),
          magnet,
          detailUrl: `${ORIGIN}/mv/${doubanId}`,
        });
      }
    } catch (error) {
      warnings.push(`${row?.title || doubanId}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { results, warnings };
}

export async function searchButailing(options: {
  keyword: string;
  mediaType: 'movie' | 'tv' | 'auto';
  year?: string;
}): Promise<ButailingSearchResponse> {
  if (!options.keyword.trim()) throw new Error('请输入搜索关键词');
  const page = await openPage();
  try {
    await open(page);
    if (await waitForChallenge(page, 5000)) {
      const challenge = await detectChallenge(page, '不太灵需要人机验证。请填写截图中的验证码，提交后继续搜索。', async (code) => {
        await fillChallengeCode(page, code);
        return runButailing(page, options);
      });
      return { results: [], warnings: [], challenge };
    }
    const result = await runButailing(page, options);
    await page.close().catch(() => undefined);
    return result;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}
