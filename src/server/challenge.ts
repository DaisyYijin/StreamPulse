import { randomUUID } from 'node:crypto';
import type { Page } from 'puppeteer-core';

export interface ChallengeInfo {
  sessionId: string;
  image: string;
  prompt: string;
}

interface ChallengeSession {
  page: Page;
  prompt: string;
  createdAt: number;
  resume: (code: string) => Promise<unknown>;
}

const sessions = new Map<string, ChallengeSession>();
const TTL = 10 * 60_000;

function cleanup(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL) {
      sessions.delete(id);
      void session.page.close().catch(() => undefined);
    }
  }
}

export async function hasChallenge(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document as any;
    const text = doc?.body?.innerText || '';
    if (/验证码|人机验证|安全验证|滑动验证|captcha/i.test(text)) return true;
    return Boolean(doc?.querySelector('input[placeholder*="验证码"], input[name*="captcha"], img[src*="captcha"], iframe[src*="captcha"]'));
  }).catch(() => false);
}

export async function waitForChallenge(page: Page, timeout = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await hasChallenge(page)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

export async function fillChallengeCode(page: Page, code: string): Promise<void> {
  const filled = await page.evaluate((value) => {
    const doc = (globalThis as any).document as any;
    const inputs = Array.from(doc?.querySelectorAll('input') || []) as any[];
    const target = inputs.find((input) => {
      const type = String(input.type || '').toLowerCase();
      if (type && !['text', 'tel', 'number', 'search'].includes(type)) return false;
      return input.offsetParent !== null;
    });
    if (!target) return false;
    target.focus();
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    const buttons = Array.from(doc?.querySelectorAll('button, input[type=submit], a') || []) as any[];
    const button = buttons.find((node) => /确认|提交|验证|继续|搜索|登录/i.test(node.textContent || node.value || '') && node.offsetParent !== null);
    if (button) (button as any).click();
    return true;
  }, code);
  if (!filled) throw new Error('页面没有找到可填写的验证码输入框');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  if (await hasChallenge(page)) throw new Error('验证未通过，请检查验证码后重试');
}

export async function detectChallenge(page: Page, prompt: string, customResume?: (code: string) => Promise<unknown>): Promise<ChallengeInfo> {
  cleanup();
  const screenshot = await page.screenshot({ type: 'png', encoding: 'base64', fullPage: false });
  const session: ChallengeSession = {
    page,
    prompt,
    createdAt: Date.now(),
    resume: customResume || (async (code: string) => {
      await fillChallengeCode(page, code);
      return { page };
    }),
  };
  const id = randomUUID();
  sessions.set(id, session);
  return {
    sessionId: id,
    image: `data:image/png;base64,${screenshot}`,
    prompt,
  };
}

export async function submitChallenge(sessionId: string, code: string): Promise<unknown> {
  cleanup();
  const session = sessions.get(sessionId);
  if (!session) throw new Error('验证会话已过期，请重新搜索');
  sessions.delete(sessionId);
  try {
    return await session.resume(code);
  } finally {
    await session.page.close().catch(() => undefined);
  }
}
