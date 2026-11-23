import { openPage } from './browser.js';

export interface SearchLoginResult {
  cookie: string;
}

export async function loginSearchSite(options: {
  site: 'guanying' | 'butailing';
  baseUrl: string;
  username: string;
  password: string;
}): Promise<SearchLoginResult> {
  const baseUrl = options.site === 'butailing' ? 'https://web5.mukaku.com' : options.baseUrl.trim();
  if (!baseUrl) throw new Error('请先填写观影站点地址');
  const page = await openPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const userSelector = 'input[type="text"], input[name*="user"], input[name*="account"], input[name*="email"], input[placeholder*="账号"], input[placeholder*="用户"]';
    const passSelector = 'input[type="password"]';
    const user = await page.$(userSelector);
    const pass = await page.$(passSelector);
    if (!user || !pass) throw new Error('没有找到登录表单，请确认站点地址或该站点是否支持账号密码登录');
    await user.click({ clickCount: 3 });
    await user.type(options.username, { delay: 20 });
    await pass.click({ clickCount: 3 });
    await pass.type(options.password, { delay: 20 });
    const submit = await page.$('button[type="submit"], input[type="submit"], button[class*="login"], button[class*="submit"]');
    if (submit) await submit.click();
    else await page.keyboard.press('Enter');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const cookies = await page.cookies();
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    if (!cookie) throw new Error('登录后没有获取到 Cookie，可能登录失败或需要验证码');
    return { cookie };
  } finally {
    await page.close().catch(() => undefined);
  }
}
