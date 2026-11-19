import type { RunStatus } from '../shared/types';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatFullDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return fullDateFormatter.format(date);
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '从未';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '从未';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 45) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return formatDateTime(value);
}

export function untilTime(value: string | null | undefined): string {
  if (!value) return '未安排';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '未安排';
  const seconds = Math.floor((timestamp - Date.now()) / 1000);
  if (seconds <= 0) return '即将执行';
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟后`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时后`;
  return `${Math.floor(seconds / 86400)} 天后`;
}

export function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return '—';
  const seconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat('zh-CN').format(value);
}

export interface StatusMeta {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  live?: boolean;
}

export function statusMeta(status: RunStatus): StatusMeta {
  switch (status) {
    case 'queued':
      return { label: '排队中', tone: 'neutral' };
    case 'running':
      return { label: '运行中', tone: 'info', live: true };
    case 'success':
      return { label: '已完成', tone: 'success' };
    case 'partial':
      return { label: '部分完成', tone: 'warning' };
    case 'failed':
      return { label: '失败', tone: 'danger' };
    case 'cancelled':
      return { label: '已取消', tone: 'neutral' };
    case 'interrupted':
      return { label: '已中断', tone: 'warning' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

export function triggerLabel(trigger: string): string {
  if (trigger === 'schedule') return '定时';
  if (trigger === 'all') return '批量';
  return '手动';
}

export function scheduleLabel(schedule: string): string {
  const map: Record<string, string> = {
    '0 3 * * *': '每天 03:00',
    '0 6 * * *': '每天 06:00',
    '0 */6 * * *': '每 6 小时',
    '0 4 * * 1': '每周一 04:00',
  };
  return map[schedule] ?? schedule;
}

export function uptimeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

export function isTerminal(status: RunStatus): boolean {
  return ['success', 'partial', 'failed', 'cancelled', 'interrupted'].includes(status);
}
