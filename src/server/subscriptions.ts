import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Subscription, SubscriptionSettings } from '../shared/types.js';
import { openPage } from './browser.js';
import { searchTmdbCandidates } from './tmdb.js';

interface WishItem {
  doubanId: string;
  title: string;
  year: string;
  mediaType: 'movie' | 'tv';
}

function fileFor(stateDir: string): string {
  return path.join(stateDir, 'subscriptions.json');
}

export async function listSubscriptions(stateDir: string): Promise<Subscription[]> {
  try {
    const raw = JSON.parse(await fs.readFile(fileFor(stateDir), 'utf8')) as Subscription[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function save(stateDir: string, items: Subscription[]): Promise<void> {
  const file = fileFor(stateDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(items, null, 2), 'utf8');
  await fs.rename(temporary, file);
}

function parseRss(xml: string): WishItem[] {
  const items: WishItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    const link = block.match(/<link>([\s\S]*?)<\/link>/i);
    const name = (title?.[1] || title?.[2] || '').trim();
    const doubanId = link?.[1]?.match(/subject\/(\d+)/)?.[1] || '';
    if (!name || !doubanId) continue;
    const year = name.match(/\((19|20)\d{2}\)/)?.[0].replace(/[()]/g, '') || '';
    items.push({ doubanId, title: name.replace(/\s*\((19|20)\d{2}\)\s*$/, '').trim(), year, mediaType: /剧|电视|TV/i.test(name) ? 'tv' : 'movie' });
  }
  return items;
}

async function fetchWishlist(settings: SubscriptionSettings): Promise<WishItem[]> {
  if (settings.doubanRssUrl.trim()) {
    const response = await fetch(settings.doubanRssUrl.trim(), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`RSSHub 读取失败（HTTP ${response.status}）`);
    return parseRss(await response.text());
  }
  const userId = settings.doubanUserId.trim();
  if (!userId) throw new Error('请填写豆瓣用户 ID');
  const page = await openPage();
  try {
    if (settings.doubanCookie.trim()) {
      for (const part of settings.doubanCookie.split(';')) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        await page.setCookie({ name: part.slice(0, index).trim(), value: part.slice(index + 1).trim(), domain: '.douban.com', path: '/' }).catch(() => undefined);
      }
    }
    await page.goto(`https://movie.douban.com/people/${encodeURIComponent(userId)}/wish`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.item, .grid-view .item', { timeout: 12_000 }).catch(() => undefined);
    const items = await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const nodes = Array.from(doc.querySelectorAll('.item')) as any[];
      return nodes.map((node) => {
        const link = node.querySelector('.title a, a[href*="/subject/"]');
        const intro = node.querySelector('.intro')?.textContent || '';
        const title = (link?.textContent || '').replace(/\s+/g, ' ').trim();
        const href = link?.href || '';
        return { title, href, intro };
      }).filter((item) => item.title && item.href);
    });
    if (!items.length) throw new Error('没有读取到想看列表；可能是私密列表，请填写豆瓣 Cookie 或 RSSHub');
    return items.map((item: any) => {
      const doubanId = String(item.href).match(/subject\/(\d+)/)?.[1] || '';
      const year = String(item.intro).match(/(19|20)\d{2}/)?.[0] || item.title.match(/\((19|20)\d{2}\)/)?.[0]?.replace(/[()]/g, '') || '';
      return {
        doubanId,
        title: String(item.title).replace(/\s*\((19|20)\d{2}\)\s*$/, '').trim(),
        year,
        mediaType: (/剧|电视|TV/i.test(`${item.title} ${item.intro}`) ? 'tv' : 'movie') as 'movie' | 'tv',
      };
    }).filter((item: WishItem) => item.doubanId && item.title);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function syncDoubanSubscriptions(
  stateDir: string,
  settings: SubscriptionSettings,
  tmdbKey: string,
  tmdbLanguage: string,
): Promise<{ added: number; total: number; items: Subscription[] }> {
  const wishlist = await fetchWishlist(settings);
  const current = await listSubscriptions(stateDir);
  const byDouban = new Map(current.map((item) => [item.doubanId, item]));
  let added = 0;
  for (const wish of wishlist.slice(0, 50)) {
    if (byDouban.has(wish.doubanId)) continue;
    let tmdbId: number | null = null;
    let mediaType = wish.mediaType;
    try {
      const candidates = await searchTmdbCandidates({
        keyword: wish.title,
        mediaType: wish.mediaType,
        year: wish.year,
        apiKey: tmdbKey,
        language: tmdbLanguage,
        limit: 1,
      });
      if (candidates[0]) {
        tmdbId = candidates[0].id;
        mediaType = candidates[0].mediaType;
      }
    } catch {
      // Subscription is still useful without a TMDb match.
    }
    const now = new Date().toISOString();
    const item: Subscription = {
      id: `sub_${randomUUID().slice(0, 12)}`,
      doubanId: wish.doubanId,
      title: wish.title,
      year: wish.year,
      mediaType,
      tmdbId,
      status: 'waiting',
      message: '等待搜索',
      createdAt: now,
      updatedAt: now,
    };
    byDouban.set(wish.doubanId, item);
    added += 1;
  }
  const items = Array.from(byDouban.values());
  await save(stateDir, items);
  return { added, total: items.length, items };
}

export async function deleteSubscription(stateDir: string, id: string): Promise<boolean> {
  const items = await listSubscriptions(stateDir);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return false;
  await save(stateDir, next);
  return true;
}
