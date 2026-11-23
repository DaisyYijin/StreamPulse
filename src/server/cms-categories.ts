import { parse } from 'yaml';
import type { TmdbInfo } from './tmdb.js';

export interface CmsRule {
  name: string;
  mediaType: 'movie' | 'tv';
  conditions: Array<{ key: string; values: string[]; optional: boolean; required: boolean; exclude: boolean }>;
  customRegex: string;
  fallback: boolean;
}

export interface CmsCategoryConfig {
  movie: CmsRule[];
  tv: CmsRule[];
}

export interface CmsMatch {
  name: string;
  rule: CmsRule;
}

const KNOWN_FIELDS = new Set([
  'genre_ids', 'original_language', 'origin_country', 'production_countries', 'release_year',
  'keywords', 'include_keywords', 'series_keywords', 'series_actors', 'series_directors',
  'custom_regex', 'ext', 'library',
]);

function splitValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitValues);
  return String(value ?? '').split(/[,;；\n]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeKey(raw: string): { key: string; optional: boolean; required: boolean; exclude: boolean } {
  let key = raw.trim();
  let optional = false;
  let required = false;
  let exclude = false;
  if (key.startsWith('?')) { optional = true; key = key.slice(1); }
  else if (key.startsWith('？')) { optional = true; key = key.slice(1); }
  if (key.startsWith('+')) { required = true; key = key.slice(1); }
  if (key.startsWith('-')) { exclude = true; key = key.slice(1); }
  return { key, optional, required, exclude };
}

function normalizeRule(raw: unknown, mediaType: 'movie' | 'tv', name: string): CmsRule {
  const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const conditions: CmsRule['conditions'] = [];
  let customRegex = '';
  for (const [rawKey, rawValue] of Object.entries(item)) {
    const { key, optional, required, exclude } = normalizeKey(rawKey);
    if (!KNOWN_FIELDS.has(key)) throw new Error(`未知分类条件：${rawKey}`);
    if (key === 'custom_regex') { customRegex = String(rawValue ?? ''); continue; }
    if (key === 'library') continue;
    if (key === 'ext') continue; // Reserved; current organizer does not match by ext.
    const values = splitValues(rawValue);
    if (!values.length) throw new Error(`分类「${name}」的条件 ${rawKey} 为空`);
    conditions.push({ key, values, optional, required, exclude });
  }
  const fallback = conditions.length === 0 && !customRegex;
  return { name, mediaType, conditions, customRegex, fallback };
}

export function parseCmsCategories(yamlText: string): CmsCategoryConfig {
  const document = parse(yamlText) as Record<string, unknown> | null;
  if (!document || typeof document !== 'object') throw new Error('分类 YAML 必须是对象');
  const result: CmsCategoryConfig = { movie: [], tv: [] };
  for (const mediaType of ['movie', 'tv'] as const) {
    const block = document[mediaType];
    if (block === undefined) continue;
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error(`${mediaType} 必须是分类名到条件的映射`);
    for (const [name, conditions] of Object.entries(block as Record<string, unknown>)) {
      result[mediaType].push(normalizeRule(conditions, mediaType, name));
    }
    result[mediaType].sort((left, right) => Number(left.fallback) - Number(right.fallback));
  }
  return result;
}

function parseRange(value: string): [number, number] | null {
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(value);
  if (range) return [Number(range[1]), Number(range[2])];
  if (/^\d+$/.test(value)) return [Number(value), Number(value)];
  return null;
}

function matchesValue(field: string, expected: string, info: TmdbInfo, extension: string): boolean {
  const value = expected.trim();
  const lowerValues = (values: string[]) => values.map((item) => item.toLowerCase());
  const targetValues = field === 'original_language' ? info.languages
    : field === 'origin_country' ? info.countries
      : field === 'production_countries' ? info.productionCountries
        : field === 'include_keywords' ? info.keywords
          : field === 'keywords' ? [info.title, info.originalTitle ?? '']
            : field === 'series_keywords' ? [info.title, info.originalTitle ?? '']
              : field === 'series_actors' ? info.cast
                : field === 'series_directors' ? info.directors
                  : [];
  if (field === 'genre_ids') {
    const range = parseRange(value);
    return range ? info.genreIds.some((id) => id >= range[0] && id <= range[1]) : info.genreIds.includes(Number(value));
  }
  if (field === 'release_year') {
    const range = parseRange(value);
    return range ? Number(info.year) >= range[0] && Number(info.year) <= range[1] : info.year === value;
  }
  if (field === 'ext') return extension.toLowerCase() === value.toLowerCase();
  return lowerValues(targetValues).some((candidate) => candidate.includes(value.toLowerCase()));
}

function seriesTerm(rule: CmsRule, info: TmdbInfo): string {
  for (const condition of rule.conditions) {
    if (!condition.key.startsWith('series_')) continue;
    if (condition.key === 'series_keywords') {
      const term = condition.values.find((value) => !value.startsWith('!') && matchesValue('keywords', value, info, ''));
      if (term) return term;
    }
    if (condition.key === 'series_actors') {
      const term = info.cast.find((name) => condition.values.some((value) => name.includes(value)));
      if (term) return term;
    }
    if (condition.key === 'series_directors') {
      const term = info.directors.find((name) => condition.values.some((value) => name.includes(value)));
      if (term) return term;
    }
  }
  return '';
}

export function matchCmsCategory(config: CmsCategoryConfig, info: TmdbInfo, extension: string, filename: string): CmsMatch | null {
  for (const rule of config[info.mediaType]) {
    if (rule.customRegex) {
      try {
        if (new RegExp(rule.customRegex, 'i').test(`${info.title} ${info.originalTitle ?? ''} ${filename}`)) {
          return { name: rule.name, rule };
        }
      } catch {
        // Invalid regex is ignored at match time.
      }
    }
    if (rule.fallback) return { name: rule.name, rule };
    const candidateResults: boolean[] = [];
    const optionalResults: boolean[] = [];
    let failed = false;
    for (const condition of rule.conditions) {
      const exclusions = condition.values.filter((value) => condition.exclude || value.startsWith('!') || value.startsWith('-'));
      const positives = condition.values.filter((value) => !exclusions.includes(value));
      const positiveMatched = positives.length === 0 || positives.some((value) => matchesValue(condition.key, value, info, extension));
      const exclusionMatched = exclusions.some((value) => matchesValue(condition.key, value.replace(/^[!-]/, ''), info, extension));
      if (exclusionMatched) { failed = true; break; }
      if (condition.required && !positiveMatched) { failed = true; break; }
      if (positives.length === 0) continue;
      if (condition.optional) optionalResults.push(positiveMatched);
      else candidateResults.push(positiveMatched);
    }
    if (failed) continue;
    if (optionalResults.length && !optionalResults.some(Boolean)) continue;
    if (candidateResults.some((value) => !value)) continue;
    const term = seriesTerm(rule, info);
    return { name: term ? `${rule.name}/${term}系列` : rule.name, rule };
  }
  return null;
}
