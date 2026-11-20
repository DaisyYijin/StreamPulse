import { z } from 'zod';
import { DEFAULT_EXTENSIONS } from '../../shared/types.js';
import { isValidCron } from '../scheduler.js';
import { HttpError } from '../types.js';

function httpUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, `${label}不是有效的 URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, `${label}必须使用 http 或 https`);
  }
  if (parsed.search || parsed.hash) {
    throw new HttpError(400, `${label}不能包含查询参数或锚点`);
  }
  return value.replace(/\/+$/, '');
}

export function normalizeBaseUrl(value: string): string {
  return httpUrl(value, '来源地址');
}

export function normalizePublicUrl(value: string): string {
  if (!value.trim()) return '';
  return httpUrl(value, '公开访问地址');
}

export function normalizeStreamBaseUrl(value: string): string {
  if (!value.trim()) return '';
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new HttpError(400, '302 服务地址不是有效的 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, '302 服务地址必须使用 http 或 https');
  }
  if (parsed.search || parsed.hash) {
    throw new HttpError(400, '302 服务地址不能包含查询参数或锚点');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new HttpError(400, '302 服务地址请填写协议、主机和端口，不要包含路径');
  }
  return parsed.origin;
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const field = issue.path.length > 0 ? `${issue.path.join('.')}：` : '';
        return `${field}${issue.message}`;
      })
      .join('；');
    throw new HttpError(400, message || '请求参数无效', result.error.issues);
  }
  return result.data;
}

const name = z.string().trim().min(1, '名称不能为空').max(80, '名称不能超过 80 个字符');
const pathValue = z.string().min(1, '路径不能为空').max(2000, '路径过长');

export const sourceCreateSchema = z.object({
  name,
  type: z.enum(['openlist', '115', '123']).default('openlist'),
  baseUrl: z.string().trim().max(2000).optional().default(''),
  publicUrl: z.string().trim().max(2000).optional().default(''),
  authType: z.enum(['token', 'password', 'cookie']).default('token'),
  username: z.string().trim().max(200).optional().default(''),
  token: z.string().trim().max(4000).optional().default(''),
  password: z.string().max(1000).optional().default(''),
  cookie: z.string().max(20000).optional().default(''),
});

export const sourceUpdateSchema = z.object({
  name: name.optional(),
  type: z.enum(['openlist', '115', '123']).optional(),
  baseUrl: z.string().trim().max(2000).optional(),
  publicUrl: z.string().trim().max(2000).optional(),
  authType: z.enum(['token', 'password', 'cookie']).optional(),
  username: z.string().trim().max(200).optional(),
  token: z.string().trim().max(4000).optional(),
  password: z.string().max(1000).optional(),
  cookie: z.string().max(20000).optional(),
});

export type SourceCreateBody = z.infer<typeof sourceCreateSchema>;
export type SourceUpdateBody = z.infer<typeof sourceUpdateSchema>;

const libraryFields = {
  name,
  sourceId: z.string().trim().min(1, '请选择来源'),
  sourcePath: pathValue,
  targetPath: z.string().trim().min(1, '输出目录不能为空').max(500),
  urlTemplate: z.string().trim().min(1).max(1000),
  extensions: z.array(z.string().max(30)).min(1, '至少保留一种视频扩展名').max(50),
  excludePatterns: z.array(z.string().max(300)).max(100).optional().default([]),
  minSizeMB: z.number().min(0).max(10_000_000).optional().default(0),
  enabled: z.boolean().optional().default(true),
  incremental: z.boolean().optional().default(true),
  deleteOrphans: z.boolean().optional().default(false),
  schedule: z.string().trim().max(120).optional().default(''),
  watchInterval: z.number().int().min(0).max(60).optional().default(0),
};

export const libraryCreateSchema = z.object(libraryFields);

export const libraryUpdateSchema = z.object({
  ...libraryFields,
  name: name.optional(),
  sourceId: libraryFields.sourceId.optional(),
  sourcePath: libraryFields.sourcePath.optional(),
  targetPath: libraryFields.targetPath.optional(),
  urlTemplate: libraryFields.urlTemplate.optional(),
  extensions: z.array(z.string().max(30)).min(1, '至少保留一种视频扩展名').max(50).optional(),
  excludePatterns: z.array(z.string().max(300)).max(100).optional(),
  minSizeMB: z.number().min(0).max(10_000_000).optional(),
  enabled: z.boolean().optional(),
  incremental: z.boolean().optional(),
  deleteOrphans: z.boolean().optional(),
  schedule: z.string().trim().max(120).optional(),
  watchInterval: z.number().int().min(0).max(60).optional(),
});

export const organizeExecuteSchema = z.object({
  batchId: z.string().trim().min(1).max(120),
});

export const runOptionsSchema = z.object({
  mode: z.enum(['incremental', 'full']).optional(),
});

export const qrStartSchema = z.object({
  provider: z.enum(['115', '123']),
  device: z.enum(['web', 'android', 'ios', 'tv', 'wechatmini', 'alipaymini']).optional(),
  name: z.string().trim().min(1, '名称不能为空').max(80),
  sourceId: z.string().trim().min(1).optional(),
});

const organizeCategorySchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  mediaType: z.enum(['movie', 'tv']),
  genres: z.array(z.string().trim().max(80)).max(30).default([]),
  countries: z.array(z.string().trim().max(20)).max(30).default([]),
  languages: z.array(z.string().trim().max(20)).max(30).default([]),
  keywords: z.array(z.string().trim().max(80)).max(30).default([]),
});

const organizerSchema = z.object({
  sourceId: z.string().trim().min(1, '请选择来源账号'),
  sourcePath: z.string().trim().min(1).max(2000),
  libraryPath: z.string().trim().min(1).max(2000),
  mode: z.literal('move'),
  upgradeStrategy: z.enum(['off', 'better', 'always']),
  tmdbApiKey: z.string().trim().max(500),
  tmdbLanguage: z.string().trim().min(2).max(20),
  categories: z.array(organizeCategorySchema).max(100),
});

export const settingsUpdateSchema = z.object({
  organizer: organizerSchema.optional(),
  outputDir: z.string().trim().min(1).max(2000).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  defaultUrlTemplate: z.string().trim().min(1).max(1000).optional(),
  streamBaseUrl: z.string().trim().max(2000).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(4).optional(),
  runRetention: z.number().int().min(10).max(500).optional(),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入账号').max(64),
  password: z.string().min(1, '请输入密码').max(1000),
});

export const setupSchema = z.object({
  username: z.string().trim().min(3, '账号至少需要 3 个字符').max(32),
  password: z.string().min(8, '密码至少需要 8 个字符').max(200),
});

export const accountUpdateSchema = z.object({
  currentPassword: z.string().min(1).max(1000),
  username: z.string().trim().min(3, '账号至少需要 3 个字符').max(32),
  newPassword: z.string().min(8, '新密码至少需要 8 个字符').max(200).optional(),
});

export function validateSchedule(schedule: string): void {
  if (schedule && !isValidCron(schedule)) {
    throw new HttpError(400, 'Cron 表达式无效，例如：0 3 * * *');
  }
}

export function defaultLibraryFields() {
  return {
    extensions: [...DEFAULT_EXTENSIONS],
    excludePatterns: [] as string[],
    minSizeMB: 0,
    enabled: true,
    incremental: true,
    deleteOrphans: false,
    schedule: '',
  };
}
