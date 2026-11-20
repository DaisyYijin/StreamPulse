import type { NotificationSettings } from '../shared/types.js';

async function sendTelegram(settings: NotificationSettings, text: string): Promise<void> {
  if (!settings.telegramBotToken || !settings.telegramChatId) return;
  await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: settings.telegramChatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function sendWecom(settings: NotificationSettings, text: string): Promise<void> {
  if (!settings.wecomWebhookUrl) return;
  await fetch(settings.wecomWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

export async function notify(settings: NotificationSettings, text: string): Promise<void> {
  await Promise.all([sendTelegram(settings, text), sendWecom(settings, text)]);
}

export function notifyRun(settings: NotificationSettings, result: { status: string; library: string; message: string; generated: number; skipped: number; failed: number }): void {
  if (result.status === 'success' && !settings.notifyOnSuccess) return;
  if (result.status !== 'success' && !settings.notifyOnFailure) return;
  const text = [
    `StreamPulse · ${result.library}`,
    `状态：${result.status}`,
    `生成 ${result.generated} / 跳过 ${result.skipped} / 失败 ${result.failed}`,
    result.message,
  ].join('\n');
  void notify(settings, text);
}

export function notifyCookieInvalid(settings: NotificationSettings, sourceName: string): void {
  if (!settings.notifyCookieInvalid) return;
  void notify(settings, `StreamPulse\n来源「${sourceName}」登录失效，请重新扫码或更新 Cookie。`);
}
