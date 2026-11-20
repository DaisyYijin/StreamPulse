import type { GuanyingSettings } from '../shared/types.js';
import { withPage } from './browser.js';

export interface GuanyingResult {
  title: string;
  year: string;
  href: string;
}

function normalizeBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('观影地址必须是 http/https');
  return url.toString().replace(/\/+$/, '');
}

export async function searchGuanying(options: {
  keyword: string;
  settings: GuanyingSettings;
}): Promise<{ results: GuanyingResult[]; warnings: string[] }> {
  const keyword = options.keyword.trim();
  if (!keyword) throw new Error('请输入搜索关键词');
  if (!options.settings.baseUrl.trim()) throw new Error('请先在设置中填写观影站点地址');
  const baseUrl = normalizeBase(options.settings.baseUrl);
  return withPage(async (page) => {
    if (options.settings.cookie.trim()) {
      const domain = new URL(baseUrl).hostname;
      for (const part of options.settings.cookie.split(';')) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        await page.setCookie({
          name: part.slice(0, index).trim(),
          value: part.slice(index + 1).trim(),
          domain,
          path: '/',
        }).catch(() => undefined);
      }
    }
    await page.goto(`${baseUrl}/search?q=${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.v5d, .search-result, .result-item', { timeout: 12_000 }).catch(() => undefined);
    const cards = await page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const nodes = Array.from(doc.querySelectorAll('.v5d, .search-result, .result-item')).slice(0, 20) as any[];
      return nodes.map((node) => {
        const titleNode = node.querySelector('.d16, .title, h3, h2, a[title]');
        const linkNode = node.querySelector('a[href]');
        return {
          title: (titleNode?.textContent || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          href: linkNode?.href || '',
        };
      }).filter((item) => item.title);
    });
    const results = cards.map((card) => {
      const year = card.title.match(/\((19|20)\d{2}\)/)?.[0].replace(/[()]/g, '') || '';
      return { title: card.title, year, href: card.href };
    });
    if (results.length === 0) {
      const body = (await page.evaluate(() => ((globalThis as any).document?.body?.innerText || ''))).slice(0, 200).replace(/\s+/g, ' ');
      return { results: [], warnings: [`观影搜索没有解析到结果${body ? `：${body}` : ''}`] };
    }
    return { results, warnings: [] };
  });
}
