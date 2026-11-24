import { parse } from 'yaml';

export type WashPolicyMode = 'coexist' | 'skip' | 'replace' | 'max_size' | 'min_size';
export interface WashPolicy {
  name: string;
  mode: WashPolicyMode;
  scope: 'all' | 'group';
  mediaType: '' | 'movie' | 'tv';
  categories: string[];
  priority: Array<Record<string, string[]>>;
}

export interface WashPolicyDecision {
  action: 'upgrade' | 'skip';
  reason: string;
  candidateScore: number;
  existingScore: number;
  coverage: number;
}

const MODES = new Set<WashPolicyMode>(['coexist', 'skip', 'replace', 'max_size', 'min_size']);

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(values);
  return String(value ?? '').split(/[,;；\n]/).map((item) => item.trim()).filter(Boolean);
}

export function parseWashPolicies(yamlText: string): WashPolicy[] {
  if (!yamlText.trim()) return [];
  const document = parse(yamlText) as Record<string, unknown> | null;
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('洗版策略 YAML 必须是对象');
  const policies: WashPolicy[] = [];
  for (const [name, raw] of Object.entries(document)) {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const mode = String(item.mode ?? 'replace') as WashPolicyMode;
    if (!MODES.has(mode)) throw new Error(`洗版策略「${name}」的 mode 无效：${mode}`);
    const scope = item.scope === 'group' ? 'group' : 'all';
    const mediaType = item.media_type === 'movie' || item.media_type === 'tv' ? item.media_type : '';
    const categories = values(item.category);
    const priorityRaw = Array.isArray(item.priority_level) ? item.priority_level : [];
    const priority = priorityRaw.map((level, index) => {
      if (!level || typeof level !== 'object' || Array.isArray(level)) throw new Error(`洗版策略「${name}」第 ${index + 1} 个 priority_level 无效`);
      return Object.fromEntries(Object.entries(level as Record<string, unknown>).map(([key, value]) => [key, values(value)]));
    });
    policies.push({ name, mode, scope, mediaType, categories, priority });
  }
  return policies;
}

function matchValue(actual: string, expected: string): boolean {
  if (!expected) return false;
  return actual.toLowerCase().includes(expected.toLowerCase());
}

function levelMatches(level: Record<string, string[]>, actual: Record<string, string>): boolean {
  for (const [key, expectedValues] of Object.entries(level)) {
    const actualValue = actual[key] ?? '';
    const exclusions = expectedValues.filter((value) => value.startsWith('!') || value.startsWith('-'));
    if (exclusions.some((value) => matchValue(actualValue, value.slice(1)))) return false;
    const positives = expectedValues.filter((value) => !value.startsWith('!') && !value.startsWith('-'));
    if (positives.length && !positives.some((value) => matchValue(actualValue, value))) return false;
  }
  return true;
}

function variables(filename: string): Record<string, string> {
  const lower = filename.toLowerCase();
  return {
    title: filename.replace(/\.[^.]+$/, ''),
    resource_pix: lower.match(/(2160p|1080p|720p|480p|4k)/)?.[1] || '',
    resource_type: lower.includes('remux') ? 'Remux' : lower.includes('bluray') || lower.includes('blu-ray') ? 'BluRay' : lower.includes('web-dl') ? 'WEB-DL' : lower.includes('webrip') ? 'WEBRip' : lower.includes('hdtv') ? 'HDTV' : '',
    resource_effect: /dolby vision|\bdv\b/.test(lower) ? 'DV' : /hdr10\+|hdr10/.test(lower) ? 'HDR10' : /\bhdr\b/.test(lower) ? 'HDR' : '',
    video_encode: /hevc|h\.?265/.test(lower) ? 'HEVC' : /av1/.test(lower) ? 'AV1' : /avc|h\.?264/.test(lower) ? 'AVC' : '',
    audio_encode: /atmos/.test(lower) ? 'Atmos' : /truehd/.test(lower) ? 'TrueHD' : /dts/.test(lower) ? 'DTS' : /aac/.test(lower) ? 'AAC' : '',
    resource_team: filename.match(/[-.]([A-Za-z0-9]+)$/)?.[1] || '',
  };
}

export function evaluateWashPolicies(
  policies: WashPolicy[],
  options: { mediaType: 'movie' | 'tv'; category: string; candidateName: string; candidateSize: number; existingName: string; existingSize: number },
): WashPolicyDecision | null {
  for (const policy of policies) {
    if (policy.mediaType && policy.mediaType !== options.mediaType) continue;
    if (policy.categories.length && !policy.categories.some((category) => options.category.toLowerCase().includes(category.toLowerCase()))) continue;
    const candidateVars = variables(options.candidateName);
    const existingVars = variables(options.existingName);
    const candidateIndex = policy.priority.findIndex((level) => levelMatches(level, candidateVars));
    if (candidateIndex < 0) continue;
    const existingIndex = policy.priority.findIndex((level) => levelMatches(level, existingVars));
    if (policy.mode === 'skip') return { action: 'skip', reason: `洗版策略「${policy.name}」：已有版本，跳过`, candidateScore: 0, existingScore: 0, coverage: 1 };
    if (policy.mode === 'coexist') return { action: 'skip', reason: `洗版策略「${policy.name}」：共存模式，保留现有版本`, candidateScore: 0, existingScore: 0, coverage: 1 };
    if (existingIndex >= 0 && candidateIndex > existingIndex) {
      return { action: 'skip', reason: `洗版策略「${policy.name}」：现有版本优先级更高`, candidateScore: candidateIndex, existingScore: existingIndex, coverage: 1 };
    }
    if (policy.mode === 'max_size' && existingIndex >= 0 && options.candidateSize <= options.existingSize) {
      return { action: 'skip', reason: `洗版策略「${policy.name}」：保留更大的现有版本`, candidateScore: candidateIndex, existingScore: existingIndex, coverage: 1 };
    }
    if (policy.mode === 'min_size' && existingIndex >= 0 && options.candidateSize >= options.existingSize) {
      return { action: 'skip', reason: `洗版策略「${policy.name}」：保留更小的现有版本`, candidateScore: candidateIndex, existingScore: existingIndex, coverage: 1 };
    }
    if (policy.mode === 'replace' && existingIndex === candidateIndex && options.candidateSize <= options.existingSize) {
      return { action: 'skip', reason: `洗版策略「${policy.name}」：同优先级且候选不更大`, candidateScore: candidateIndex, existingScore: existingIndex, coverage: 1 };
    }
    return { action: 'upgrade', reason: `洗版策略「${policy.name}」：匹配优先级 ${candidateIndex + 1}`, candidateScore: candidateIndex, existingScore: existingIndex, coverage: 1 };
  }
  return null;
}
