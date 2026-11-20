import { openPage } from './browser.js';
import { detectChallenge, fillChallengeCode, waitForChallenge, type ChallengeInfo } from './challenge.js';

const BASE = (process.env.SEEDHUB_BASE_URL || 'https://www.seedhub.cc').replace(/\/+$/, '');

export interface SeedhubResult {
  title: string;
  year: string;
  href: string;
}

export interface SeedhubResponse {
  results: SeedhubResult[];
  warnings: string[];
  challenge?: ChallengeInfo;
}

async function run(page: any): Promise<{ results: SeedhubResult[]; warnings: string[] }> {
  await page.waitForSelector("a[href*='/movies/']", { timeout: 12_000 }).catch(() => undefined);
  const cards = await page.evaluate(() => {
    const doc = (globalThis as any).document as any;
    const nodes = Array.from(doc.querySelectorAll("a[href*='/movies/']")) as any[];
    return nodes.slice(0, 30).map((node) => {
      const parent = node.closest('article, .card, .item, .post') || node.parentElement;
      const title = (node.textContent || node.getAttribute('title') || node.querySelector('img')?.alt || parent?.querySelector('h1,h2,h3,.title,.post-title')?.textContent || '').replace(/\s+/g, ' ').trim();
      return { title: title.slice(0, 200), href: node.href || '' };
    }).filter((item: any) => item.title && item.href);
  });
  const seen = new Set<string>();
  const results = cards.filter((item: any) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  }).map((item: any) => ({ title: item.title, year: item.title.match(/\((19|20)\d{2}\)/)?.[0].replace(/[()]/g, '') || '', href: item.href }));
  if (!results.length) {
    const body = (await page.evaluate(() => ((globalThis as any).document?.body?.innerText || ''))).slice(0, 200).replace(/\s+/g, ' ');
    return { results: [], warnings: [`SeedHub 没有解析到结果${body ? `：${body}` : ''}`] };
  }
  return { results, warnings: [] };
}

export async function searchSeedhub(keyword: string): Promise<SeedhubResponse> {
  const query = keyword.trim();
  if (!query) throw new Error('请输入搜索关键词');
  const page = await openPage();
  try {
    await page.goto(`${BASE}/s/${encodeURIComponent(query)}/`, { waitUntil: 'domcontentloaded' });
    if (await waitForChallenge(page, 5000)) {
      const challenge = await detectChallenge(page, 'SeedHub 需要验证。请填写截图中的验证码，提交后继续搜索。', async (code) => {
        await fillChallengeCode(page, code);
        return run(page);
      });
      return { results: [], warnings: [], challenge };
    }
    const result = await run(page);
    await page.close().catch(() => undefined);
    return result;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}
