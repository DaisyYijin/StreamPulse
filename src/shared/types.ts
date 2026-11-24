export const APP_NAME = 'StreamPulse';
export const APP_VERSION = '1.51.0';

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

export type SourceType = 'openlist' | '115' | '123';
export type SourceAuthType = 'token' | 'password' | 'cookie';

export interface SourceProfile {
  nickname: string;
  avatarUrl: string;
  totalBytes: number;
  usedBytes: number;
  remainingBytes: number;
  isVip: boolean;
  vipLabel: string;
  vipExpire: string;
  capturedAt: string;
}

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
  hasCookie: boolean;
  cookieCount: number;
  createdAt: string;
  updatedAt: string;
  lastCheck: SourceCheck | null;
  profile: SourceProfile | null;
}

export interface Library {
  id: string;
  name: string;
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  targetPath: string;
  urlTemplate: string;
  streamBaseUrl: string;
  extensions: string[];
  excludePatterns: string[];
  minSizeMB: number;
  enabled: boolean;
  incremental: boolean;
  deleteOrphans: boolean;
  schedule: string;
  watchInterval: number;
  downloadSidecars: boolean;
  eventWatch: boolean;
  fileCount: number;
  totalRuns: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  lastRunId: string | null;
  nextRunAt: string | null;
  coverUrl?: string;
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

export type RunTrigger = 'manual' | 'schedule' | 'watch' | 'all';

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
  mode?: 'incremental' | 'full';
  scope?: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats: RunStats;
  message: string;
  logs: LogLine[];
}

export type OrganizeMode = 'move' | 'copy' | 'hardlink';
export type UpgradeStrategy = 'off' | 'better' | 'always' | 'max_size' | 'min_size' | 'weighted';

export interface WashWeights {
  resolution: number;
  source: number;
  hdr: number;
  codec: number;
  size: number;
}

export interface WashConfig {
  mode: UpgradeStrategy;
  minGap: number;
  minCoverage: number;
  tie: 'keep' | 'replace';
  weights: WashWeights;
  must: string[];
  exclude: string[];
}

export interface OrganizeCategory {
  id: string;
  name: string;
  mediaType: 'movie' | 'tv' | 'av';
  genres: string[];
  countries: string[];
  languages: string[];
  keywords: string[];
}

export interface OrganizerSettings {
  sourceId: string;
  sourcePath: string;
  failedPath: string;
  redundantPath: string;
  libraryPath: string;
  libraryId: string;
  mode: 'move';
  upgradeStrategy: UpgradeStrategy;
  tmdbApiKey: string;
  tmdbLanguage: string;
  movieFolderTemplate: string;
  movieFileTemplate: string;
  tvFolderTemplate: string;
  tvFileTemplate: string;
  avFolderTemplate: string;
  avFileTemplate: string;
  washing: WashConfig;
  washPoliciesYaml: string;
  recognitionCleanup: string;
  releaseGroups: string[];
  minVideoSizeMB: number;
  categories: OrganizeCategory[];
  categoryFormat: 'simple' | 'cms';
  cmsCategories: string;
}

export const DEFAULT_MOVIE_FOLDER_TEMPLATE = '{title} ({year})';
export const DEFAULT_MOVIE_FILE_TEMPLATE = '{title} ({year}){quality}';
export const DEFAULT_TV_FOLDER_TEMPLATE = '{title} ({year})-Season {season}';
export const DEFAULT_TV_FILE_TEMPLATE = '{title} - S{season}E{episode}{quality}';
export const DEFAULT_AV_FOLDER_TEMPLATE = '{title}';
export const DEFAULT_AV_FILE_TEMPLATE = '{title}';

export const DEFAULT_CMS_CATEGORIES = `movie:
  电影/动画电影:
    genre_ids: "16"
  电影/华语电影:
    original_language: "zh,cn"
  电影/外语电影:
tv:
  剧集/动漫番剧:
    genre_ids: "16"
  剧集/国产剧:
    origin_country: "CN,HK,TW"
  剧集/剧集:
`;

export const DEFAULT_ORGANIZE_CATEGORIES: OrganizeCategory[] = [
  { id: 'default_action', name: '动作', mediaType: 'movie', genres: ['Action', 'Adventure'], countries: [], languages: [], keywords: [] },
  { id: 'default_scifi', name: '科幻', mediaType: 'movie', genres: ['Science Fiction'], countries: [], languages: [], keywords: [] },
  { id: 'default_animation', name: '动画', mediaType: 'movie', genres: ['Animation'], countries: [], languages: [], keywords: [] },
  { id: 'default_drama', name: '剧情', mediaType: 'movie', genres: ['Drama'], countries: [], languages: [], keywords: [] },
  { id: 'default_comedy', name: '喜剧', mediaType: 'movie', genres: ['Comedy'], countries: [], languages: [], keywords: [] },
  { id: 'default_documentary', name: '纪录片', mediaType: 'movie', genres: ['Documentary'], countries: [], languages: [], keywords: [] },
  { id: 'default_cn_tv', name: '国产剧', mediaType: 'tv', genres: [], countries: ['CN'], languages: [], keywords: [] },
  { id: 'default_us_tv', name: '美剧', mediaType: 'tv', genres: [], countries: ['US'], languages: [], keywords: [] },
  { id: 'default_jp_tv', name: '日剧', mediaType: 'tv', genres: [], countries: ['JP'], languages: [], keywords: [] },
  { id: 'default_kr_tv', name: '韩剧', mediaType: 'tv', genres: [], countries: ['KR'], languages: [], keywords: [] },
  { id: 'default_anime_tv', name: '动漫', mediaType: 'tv', genres: ['Animation', 'Sci-Fi & Fantasy'], countries: [], languages: [], keywords: [] },
];

export interface SubscriptionSettings {
  doubanUserId: string;
  doubanCookie: string;
  doubanRssUrl: string;
  autoSync: boolean;
  intervalHours: number;
}

export interface Subscription {
  id: string;
  doubanId: string;
  title: string;
  year: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number | null;
  status: 'waiting' | 'searching' | 'pending' | 'downloading' | 'organizing' | 'completed' | 'failed' | 'skipped';
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuanyingSettings {
  baseUrl: string;
  cookie: string;
}

export interface HdhiveSettings {
  baseUrl: string;
  apiKey: string;
  userToken: string;
}

export interface TmdbSettings {
  apiKey: string;
  language: string;
}

export interface MetaTubeSettings {
  baseUrl: string;
  token: string;
}

export interface CloudDriveSettings {
  webhookToken: string;
}

export interface EmbyServer {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  libraryIds: string[];
  refreshAfterRun: boolean;
}

export interface EmbyLibrary {
  id: string;
  name: string;
  collectionType: string;
  locations: string[];
}

export interface NotificationSettings {
  telegramBotToken: string;
  telegramChatId: string;
  telegramCommands: boolean;
  wecomWebhookUrl: string;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyCookieInvalid: boolean;
}

export interface Settings {
  outputDir: string;
  timezone: string;
  defaultUrlTemplate: string;
  streamBaseUrl: string;
  maxConcurrentRuns: number;
  runRetention: number;
  organizer: OrganizerSettings;
  embyServers: EmbyServer[];
  hdhive: HdhiveSettings;
  guanying: GuanyingSettings;
  subscriptions: SubscriptionSettings;
  cloudDrive: CloudDriveSettings;
  metaTube: MetaTubeSettings;
  tmdb: TmdbSettings;
  notifications: NotificationSettings;
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
  configDir: string;
  stateDir: string;
  credentialsDir: string;
  accountsDir: string;
  librariesDir: string;
  runsDir: string;
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
  type?: SourceType;
  baseUrl?: string;
  publicUrl?: string;
  authType: SourceAuthType;
  username?: string;
  token?: string;
  password?: string;
  cookie?: string;
  cookies?: string[];
}

export interface LibraryInput {
  name: string;
  sourceId: string;
  sourcePath: string;
  targetPath: string;
  urlTemplate: string;
  streamBaseUrl: string;
  extensions: string[];
  excludePatterns: string[];
  minSizeMB: number;
  enabled: boolean;
  incremental: boolean;
  deleteOrphans: boolean;
  schedule: string;
  watchInterval: number;
  downloadSidecars: boolean;
  eventWatch: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  sampleCount?: number;
}
