import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

let browserPromise: Promise<Browser> | null = null;

function browserPathFile(): string {
  return path.join(process.env.CONFIG_DIR || '/config', '.browser-path');
}

export function executablePath(): string {
  const configured = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) return configured;
  try {
    const stored = fs.readFileSync(browserPathFile(), 'utf8').trim();
    if (stored) return stored;
  } catch {
    // No downloaded browser yet.
  }
  return '/usr/bin/chromium';
}

export async function installBrowser(): Promise<string> {
  const { Browser, detectBrowserPlatform, install, resolveBuildId } = await import('@puppeteer/browsers');
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('当前平台不支持自动下载浏览器');
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
  const result = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir: path.join(process.env.CONFIG_DIR || '/config', 'browsers'),
  });
  fs.mkdirSync(path.dirname(browserPathFile()), { recursive: true });
  fs.writeFileSync(browserPathFile(), result.executablePath, 'utf8');
  await closeBrowser();
  return result.executablePath;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: executablePath(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--lang=zh-CN',
      ],
    }).catch((error) => {
      browserPromise = null;
      throw new Error(`浏览器启动失败，请先在设置中下载浏览器：${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return browserPromise;
}

export async function openPage(): Promise<Page> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(35_000);
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' });
  return page;
}

export async function withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
  const page = await openPage();
  try {
    return await run(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  const browser = await pending.catch(() => null);
  await browser?.close().catch(() => undefined);
}
