import { EventEmitter } from 'node:events';

export type LiveLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LiveLogLine {
  id: number;
  at: string;
  level: LiveLogLevel;
  message: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(100);
const history: LiveLogLine[] = [];
let nextId = 1;

const METHOD_LABELS: Record<string, string> = {
  GET: '读取',
  POST: '提交',
  PUT: '更新',
  PATCH: '更新',
  DELETE: '删除',
};

const MODULE_LABELS: Array<[string, string]> = [
  ['/api/integrations/emby', 'Emby 集成'],
  ['/api/integrations/hdhive', '影巢集成'],
  ['/api/integrations/notify', '通知测试'],
  ['/api/integrations', '集成设置'],
  ['/api/organize', '整理'],
  ['/api/subscriptions', '豆瓣订阅'],
  ['/api/logs', '实时日志'],
  ['/api/settings', '系统设置'],
  ['/api/libraries', '媒体库'],
  ['/api/sources', '来源账号'],
  ['/api/runs', '任务记录'],
  ['/api/shares', '分享导入'],
  ['/api/hdhive', '影巢搜索'],
  ['/api/butailing', '不太灵搜索'],
  ['/api/guanying', '观影搜索'],
  ['/api/seedhub', 'SeedHub 搜索'],
  ['/api/metatube', 'MetaTube'],
  ['/api/auth', '登录'],
  ['/api/browse', '目录浏览'],
  ['/api/health', '健康检查'],
];

function moduleLabel(pathname: string): string {
  return MODULE_LABELS.find(([prefix]) => pathname.startsWith(prefix))?.[1] || '接口';
}

function statusLabel(status: number): string {
  if (status >= 200 && status < 300) return '成功';
  if (status === 401) return '未登录';
  if (status === 403) return '无权限';
  if (status === 404) return '不存在';
  if (status >= 400 && status < 500) return '请求失败';
  if (status >= 500) return '服务器错误';
  return '未知结果';
}

function humanizeApiLog(message: string): string | null {
  const match = /^(GET|POST|PUT|PATCH|DELETE) (\S+) → (\d{3}) \((\d+)ms\)$/.exec(message);
  if (!match) return null;
  const [, method, pathname, status, ms] = match;
  return `操作：${METHOD_LABELS[method] || method}${moduleLabel(pathname)} → ${statusLabel(Number(status))}（${ms}ms）`;
}

function translatePrefixes(message: string): string {
  const prefixes: Array<[string, string]> = [
    ['[event-watch]', '[115事件]'],
    ['[event-index]', '[事件索引]'],
    ['[subscriptions]', '[豆瓣订阅]'],
    ['[clouddrive]', '[CD2]'],
    ['[115-ws]', '[115 WebSocket]'],
    ['[scheduler]', '[调度]'],
    ['[watch]', '[轮询]'],
    ['[server]', '[服务]'],
    ['[stream]', '[302]'],
    ['[telegram]', '[Telegram]'],
    ['[emby]', '[Emby]'],
    ['[fatal]', '[致命错误]'],
  ];
  let result = message;
  for (const [from, to] of prefixes) result = result.split(from).join(to);
  return result;
}

const PHRASES: Array<[RegExp, string]> = [
  [/polling failed/gi, '轮询失败'],
  [/refresh failed/gi, '刷新失败'],
  [/received, shutting down/gi, '已收到信号，正在关闭'],
  [/listening on/gi, '监听于'],
  [/Web UI/gi, '网页界面'],
  [/302 stream/gi, '302 播放服务'],
  [/config:/gi, '配置目录：'],
  [/output:/gi, '输出目录：'],
  [/logs:/gi, '日志目录：'],
  [/auth:/gi, '认证方式：'],
  [/first-run setup/gi, '首次安装设置'],
  [/environment account/gi, '环境变量账号'],
  [/local account/gi, '本地账号'],
  [/transport closed/gi, '连接已关闭'],
  [/not found/gi, '不存在'],
  [/failed/gi, '失败'],
];

export function humanizeLog(message: string): string {
  const api = humanizeApiLog(message);
  if (api) return api;
  let result = translatePrefixes(message);
  for (const [pattern, replacement] of PHRASES) result = result.replace(pattern, replacement);
  return result;
}

export function pushLiveLog(level: LiveLogLevel, message: string): LiveLogLine {
  const line: LiveLogLine = {
    id: nextId++,
    at: new Date().toISOString(),
    level,
    message: humanizeLog(message).replace(/\s+/g, ' ').trim().slice(0, 1000),
  };
  history.push(line);
  if (history.length > 1000) history.splice(0, history.length - 1000);
  bus.emit('line', line);
  return line;
}

export function recentLiveLogs(limit = 200): LiveLogLine[] {
  return history.slice(-Math.max(1, Math.min(1000, limit)));
}

export function subscribeLiveLogs(listener: (line: LiveLogLine) => void): () => void {
  bus.on('line', listener);
  return () => bus.off('line', listener);
}
