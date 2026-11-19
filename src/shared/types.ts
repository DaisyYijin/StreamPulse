export const APP_NAME = 'StreamPulse';
export const APP_VERSION = '1.3.0';

export const DEFAULT_URL_TEMPLATE = '{streamBase}/r/{streamToken}{encodedPath}';

export const URL_TEMPLATE_VARIABLES = [
  { token: '{streamBase}', label: '302 服务地址', description: 'StreamPulse 2048 端口的公开访问地址，例如 http://192.168.1.10:2048' },
  { token: '{streamToken}', label: '302 密钥', description: '该来源的随机路由密钥，由 StreamPulse 自动生成' },
  { token: '{sourceUrl}', label: '源站地址', description: '来源的公开访问地址（未配置时使用 API 地址）' },
  { token: '{encodedPath}', label: '编码路径', description: '完整文件路径，空格等字符已进行 URL 编码' },
  { token: '{path}', label: '原始路径', description: '完整文件路径，保持原始字符' },
  { token: '{file}', label: '文件名', description: '含扩展名的文件名' },
  { token: '{name}', label: '文件主名', description: '不含扩展名的文件名' },
  { token: '{ext}', label: '扩展名', description: '不含点的扩展名，例如 mkv' },
  { token: '{dir}', label: '目录', description: '文件所在目录（不含文件名）' },
] as const;

export const DEFAULT_EXTENSIONS = [
  'mkv',
  'mp4',
  'avi',
  'ts',
  'm2ts',
  'mov',
  'wmv',
  'flv',
  'webm',
  'rmvb',
  'iso',
];

export const SCHEDULE_PRESETS = [
  { label: '每天 03:00', value: '0 3 * * *' },
  { label: '每天 06:00', value: '0 6 * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每周一 04:00', value: '0 4 * * 1' },
] as const;

export type SourceType = 'openlist';
export type SourceAuthType = 'token' | 'password';

export interface SourceCheck {
  ok: boolean;
  message: string;
  at: string;
}

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  baseUrl: string;
  publicUrl: string;
  authType: SourceAuthType;
  username: string;
  tokenHint: string | null;
  hasToken: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheck: SourceCheck | null;
}

export interface Library {
  id: string;
  name: string;
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  targetPath: string;
  urlTemplate: string;
  extensions: string[];
  excludePatterns: string[];
  minSizeMB: number;
  enabled: boolean;
  incremental: boolean;
  deleteOrphans: boolean;
  schedule: string;
  fileCount: number;
  totalRuns: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  lastRunId: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type RunTrigger = 'manual' | 'schedule' | 'all';

export interface RunStats {
  scanned: number;
  matched: number;
  generated: number;
  skipped: number;
  deleted: number;
  failed: number;
}

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface LogLine {
  at: string;
  level: LogLevel;
  message: string;
}

export interface Run {
  id: string;
  libraryId: string;
  libraryName: string;
  trigger: RunTrigger;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats: RunStats;
  message: string;
  logs: LogLine[];
}

export interface Settings {
  outputDir: string;
  timezone: string;
  defaultUrlTemplate: string;
  streamBaseUrl: string;
  maxConcurrentRuns: number;
  runRetention: number;
}

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  envManaged: boolean;
  username: string;
  appName: string;
  version: string;
}

export interface SystemInfo {
  version: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  dataDir: string;
  outputDir: string;
  outputWritable: boolean;
  logDir: string;
  logWritable: boolean;
  manifestCount: number;
  streamPort: number;
  authMode: 'env' | 'local' | 'setup';
}

export interface Overview {
  counts: {
    sources: number;
    libraries: number;
    files: number;
    activeRuns: number;
    queuedRuns: number;
  };
  last7d: {
    runs: number;
    generated: number;
    failed: number;
    successRate: number;
  };
  activity: Array<{ date: string; generated: number; failed: number }>;
  recentRuns: Run[];
  libraries: Library[];
  nextRun: { libraryId: string; libraryName: string; at: string } | null;
  system: SystemInfo;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export interface BrowseResult {
  path: string;
  entries: BrowseEntry[];
}

export interface PreviewFile {
  sourcePath: string;
  strmPath: string;
  url: string;
  size: number;
  modified: string;
}

export interface PreviewResult {
  totalMatched: number;
  scanned: number;
  extensions: Record<string, number>;
  samples: PreviewFile[];
  truncated: boolean;
}

export interface SourceInput {
  name: string;
  baseUrl: string;
  publicUrl?: string;
  authType: SourceAuthType;
  username?: string;
  token?: string;
  password?: string;
}

export interface LibraryInput {
  name: string;
  sourceId: string;
  sourcePath: string;
  targetPath: string;
  urlTemplate: string;
  extensions: string[];
  excludePatterns: string[];
  minSizeMB: number;
  enabled: boolean;
  incremental: boolean;
  deleteOrphans: boolean;
  schedule: string;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  sampleCount?: number;
}
