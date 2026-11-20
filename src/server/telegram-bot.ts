import type { LibraryRecord, SourceRecord } from './types.js';
import type { Run } from '../shared/types.js';
import type { RunManager } from './runner.js';
import type { Store } from './store.js';
import { pollQrLogin, startQrLogin, takeQrSession } from './qr.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

export interface TelegramCommand {
  command: string;
  args: string;
}

export function parseTelegramCommand(text: string): TelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [raw, ...rest] = trimmed.split(/\s+/);
  const command = raw.replace(/^\//, '').split('@')[0].toLowerCase();
  if (!command) return null;
  return { command, args: rest.join(' ').trim() };
}

export function matchLibrary(libraries: LibraryRecord[], query: string): LibraryRecord[] {
  const value = query.trim().toLowerCase();
  if (!value) return [];
  const exact = libraries.filter((library) => library.id.toLowerCase() === value || library.name.toLowerCase() === value);
  if (exact.length) return exact;
  return libraries.filter((library) => library.name.toLowerCase().includes(value) || library.id.toLowerCase().includes(value));
}

function matchSource(sources: SourceRecord[], query: string): SourceRecord[] {
  const value = query.trim().toLowerCase();
  if (!value) return [];
  const exact = sources.filter((source) => source.id.toLowerCase() === value || source.name.toLowerCase() === value);
  if (exact.length) return exact;
  return sources.filter((source) => source.name.toLowerCase().includes(value));
}

function splitMessage(text: string, size = 3800): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const cut = Math.max(rest.lastIndexOf('\n', size), rest.lastIndexOf(' ', size));
    const at = cut > size / 2 ? cut : size;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function statusText(run: Run): string {
  const labels: Record<string, string> = {
    queued: '排队', running: '运行中', success: '成功', partial: '部分成功',
    failed: '失败', cancelled: '已取消', interrupted: '已中断',
  };
  return labels[run.status] || run.status;
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

export class TelegramBot {
  private readonly store: Store;
  private readonly runner: RunManager;
  private running = false;
  private controller: AbortController | null = null;
  private offset = 0;
  private initializedToken = '';
  private loopPromise: Promise<void> | null = null;

  constructor(store: Store, runner: RunManager) {
    this.store = store;
    this.runner = runner;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    await this.loopPromise?.catch(() => undefined);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const notifications = this.store.snapshot.settings.notifications;
      if (!notifications.telegramCommands || !notifications.telegramBotToken.trim() || !notifications.telegramChatId.trim()) {
        await this.sleep(10_000);
        continue;
      }
      try {
        await this.poll(notifications.telegramBotToken.trim(), notifications.telegramChatId.trim());
      } catch (error) {
        if (!this.running) return;
        console.warn('[telegram] polling failed:', error instanceof Error ? error.message : String(error));
        await this.sleep(5_000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const abort = () => { clearTimeout(timer); resolve(); };
      this.controller?.signal.addEventListener('abort', abort, { once: true });
    });
  }

  private async poll(token: string, chatId: string): Promise<void> {
    if (this.initializedToken !== token) {
      this.offset = 0;
      this.initializedToken = token;
      await this.api(token, 'getUpdates', { offset: -1, limit: 1, timeout: 0 });
    }
    const signal = this.controller
      ? AbortSignal.any([this.controller.signal, AbortSignal.timeout(40_000)])
      : AbortSignal.timeout(40_000);
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${this.offset}&timeout=25&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`,
      { signal },
    );
    if (!response.ok) throw new Error(`Telegram getUpdates HTTP ${response.status}`);
    const payload = await response.json() as { ok?: boolean; result?: TelegramUpdate[]; description?: string };
    if (!payload.ok) throw new Error(payload.description || 'Telegram getUpdates 失败');
    for (const update of payload.result || []) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      const message = update.message;
      if (!message?.text) continue;
      if (String(message.chat?.id || '') !== chatId) {
        await this.send(token, String(message.chat?.id || ''), '未授权：此 Chat ID 不在 StreamPulse 配置中。');
        continue;
      }
      await this.handle(token, chatId, message.text);
    }
  }

  private async api(token: string, method: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.controller
        ? AbortSignal.any([this.controller.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
    if (!response.ok || payload.ok === false) throw new Error(payload.description || `Telegram ${method} 失败`);
    return payload;
  }

  private async send(token: string, chatId: string, text: string): Promise<void> {
    for (const chunk of splitMessage(text)) {
      await this.api(token, 'sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true });
    }
  }

  private async sendPhoto(token: string, chatId: string, dataUrl: string, caption: string): Promise<void> {
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) throw new Error('二维码图片无效');
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('photo', new Blob([new Uint8Array(Buffer.from(base64, 'base64'))], { type: 'image/png' }), 'qrcode.png');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: this.controller
        ? AbortSignal.any([this.controller.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Telegram sendPhoto HTTP ${response.status}`);
  }

  private async handle(token: string, chatId: string, text: string): Promise<void> {
    const parsed = parseTelegramCommand(text);
    if (!parsed) return;
    try {
      switch (parsed.command) {
        case 'start':
        case 'help':
          await this.send(token, chatId, this.help());
          return;
        case 'status':
          await this.send(token, chatId, this.status());
          return;
        case 'libraries':
          await this.send(token, chatId, this.libraries());
          return;
        case 'run':
        case 'sync':
          await this.send(token, chatId, await this.runLibrary(parsed.args, false));
          return;
        case 'full':
          await this.send(token, chatId, await this.runLibrary(parsed.args, true));
          return;
        case 'runs':
          await this.send(token, chatId, this.runs());
          return;
        case 'cancel':
          await this.send(token, chatId, await this.cancel(parsed.args));
          return;
        case 'login':
          await this.login(token, chatId, parsed.args);
          return;
        default:
          await this.send(token, chatId, `未知命令：/${parsed.command}\n\n${this.help()}`);
      }
    } catch (error) {
      await this.send(token, chatId, `操作失败：${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
    }
  }

  private help(): string {
    return [
      'StreamPulse 命令',
      '/status - 运行状态',
      '/libraries - 媒体库列表',
      '/run <名称或ID> - 增量同步',
      '/full <名称或ID> - 全量同步',
      '/runs - 最近任务',
      '/cancel <任务ID或媒体库> - 取消任务',
      '/login <来源名称> - 扫码更新 115/123 登录',
      '/help - 帮助',
      '',
      '只接受设置中填写的 Telegram Chat ID。',
    ].join('\n');
  }

  private status(): string {
    const snapshot = this.store.snapshot;
    const enabled = snapshot.libraries.filter((library) => library.enabled).length;
    const recent = snapshot.runs[0];
    return [
      `StreamPulse · ${this.store.snapshot.settings.timezone}`,
      `来源：${snapshot.sources.length} 个`,
      `媒体库：${enabled}/${snapshot.libraries.length} 启用`,
      `运行中：${this.runner.runningCount} · 排队：${this.runner.queuedCount}`,
      recent ? `最近任务：${recent.libraryName} · ${statusText(recent)} · ${ago(recent.createdAt)}` : '还没有任务记录',
    ].join('\n');
  }

  private libraries(): string {
    const libraries = this.store.snapshot.libraries;
    if (!libraries.length) return '还没有媒体库。';
    return libraries.slice(0, 40).map((library) => {
      const run = this.store.snapshot.runs.find((item) => item.libraryId === library.id);
      const last = run ? `${statusText(run)} · ${ago(run.createdAt)}` : '未运行';
      return `${library.enabled ? '●' : '○'} ${library.name}\n   ${library.id} · ${last}`;
    }).join('\n');
  }

  private runs(): string {
    const runs = this.store.snapshot.runs.slice(0, 8);
    if (!runs.length) return '还没有任务记录。';
    return runs.map((run) => `${run.id}\n${run.libraryName} · ${statusText(run)} · 生成 ${run.stats.generated} / 失败 ${run.stats.failed} · ${ago(run.createdAt)}`).join('\n\n');
  }

  private async runLibrary(query: string, full: boolean): Promise<string> {
    if (!query) return `用法：/${full ? 'full' : 'run'} <媒体库名称或ID>`;
    const libraries = this.store.snapshot.libraries;
    const matches = matchLibrary(libraries, query);
    if (matches.length === 0) return `没有找到媒体库：${query}`;
    if (matches.length > 1) {
      return `匹配到多个媒体库，请使用更精确的名称或 ID：\n${matches.slice(0, 8).map((library) => `${library.name} · ${library.id}`).join('\n')}`;
    }
    const library = matches[0];
    const run = await this.runner.start(library.id, 'manual', { full });
    return `已开始${full ? '全量' : '增量'}同步：${library.name}\n任务：${run.id}`;
  }

  private async cancel(query: string): Promise<string> {
    if (!query) return '用法：/cancel <任务ID或媒体库名称>';
    let run = this.store.snapshot.runs.find((item) => item.id === query);
    if (!run) {
      const matches = matchLibrary(this.store.snapshot.libraries, query);
      if (matches.length === 1) {
        run = this.store.snapshot.runs.find((item) =>
          item.libraryId === matches[0].id && (item.status === 'queued' || item.status === 'running'),
        );
      }
    }
    if (!run) return `没有找到可取消的任务：${query}`;
    await this.runner.cancel(run.id);
    return `已请求取消：${run.libraryName} · ${run.id}`;
  }

  private async login(token: string, chatId: string, query: string): Promise<void> {
    if (!query) {
      await this.send(token, chatId, '用法：/login <来源名称>\n支持 115 和 123。');
      return;
    }
    const matches = matchSource(this.store.snapshot.sources, query);
    if (matches.length === 0) {
      await this.send(token, chatId, `没有找到来源：${query}`);
      return;
    }
    if (matches.length > 1) {
      await this.send(token, chatId, `匹配到多个来源：\n${matches.map((source) => `${source.name} · ${source.id}`).join('\n')}`);
      return;
    }
    const source = matches[0];
    if (source.type !== '115' && source.type !== '123') {
      await this.send(token, chatId, '只有 115 / 123 原生来源支持扫码登录。');
      return;
    }
    const session = await startQrLogin({
      provider: source.type,
      device: source.type === '115' ? 'wechatmini' : 'web',
      name: source.name,
      sourceId: source.id,
    });
    try {
      await this.sendPhoto(token, chatId, session.qrDataUrl, `${source.name} 登录二维码\n5 分钟内有效，扫码后会自动更新凭据。`);
    } catch {
      await this.send(token, chatId, `${source.name} 二维码已生成，但 Telegram 图片发送失败。请在网页来源页扫码。`);
    }
    const deadline = new Date(session.expiresAt).getTime();
    while (this.running && Date.now() < deadline) {
      await this.sleep(3000);
      const view = await pollQrLogin(session.id);
      if (!view) {
        await this.send(token, chatId, '二维码会话已结束，请重新 /login。');
        return;
      }
      if (view.status === 'confirmed') {
        const credentials = view.credentials;
        if (credentials?.cookie) {
          source.cookie = credentials.cookie;
          source.cookies = [credentials.cookie];
        }
        if (credentials?.token) source.token = credentials.token;
        if (credentials?.username) source.username = credentials.username;
        source.lastCheck = { ok: true, message: '扫码登录成功', at: new Date().toISOString() };
        await this.store.save();
        takeQrSession(session.id);
        await this.send(token, chatId, `${source.name} 登录成功，凭据已更新。`);
        return;
      }
      if (view.status === 'expired' || view.status === 'error') {
        takeQrSession(session.id);
        await this.send(token, chatId, `${source.name} 登录失败：${view.message}`);
        return;
      }
    }
    takeQrSession(session.id);
    await this.send(token, chatId, '二维码已过期，请重新 /login。');
  }
}
