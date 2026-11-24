import { ArrowRight, FileCode2, FolderInput, FolderOpen, HelpCircle, Pencil, Plus, ScanLine, SlidersHorizontal, Tags, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_AV_FILE_TEMPLATE, DEFAULT_AV_FOLDER_TEMPLATE, DEFAULT_CMS_CATEGORIES, DEFAULT_MOVIE_FILE_TEMPLATE, DEFAULT_MOVIE_FOLDER_TEMPLATE, DEFAULT_ORGANIZE_CATEGORIES, DEFAULT_TV_FILE_TEMPLATE, DEFAULT_TV_FOLDER_TEMPLATE, type OrganizeCategory, type Library, type OrganizerSettings, type Settings, type Source, type WashConfig } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Modal, Select, toast } from '../components/ui';
import { DirectoryPicker } from '../components/DirectoryPicker';

type Tab = 'settings' | 'rename' | 'categories' | 'upgrade' | 'results';
const ORGANIZE_TAB_KEY = 'sp-organize-tab';

interface OrganizeItem {
  id: string;
  relativePath: string;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  category: string;
  quality: string;
  existingQuality: string;
  destination: string;
  action: 'create' | 'upgrade' | 'skip' | 'error';
  reason: string;
}
interface Batch { id: string; items: OrganizeItem[] }

const EMPTY: OrganizerSettings = {
  sourceId: '',
  sourcePath: '',
  failedPath: '',
  redundantPath: '',
  libraryPath: '',
  libraryId: '',
  mode: 'move',
  upgradeStrategy: 'better',
  tmdbApiKey: '',
  tmdbLanguage: 'zh-CN',
  movieFolderTemplate: DEFAULT_MOVIE_FOLDER_TEMPLATE,
  movieFileTemplate: DEFAULT_MOVIE_FILE_TEMPLATE,
  tvFolderTemplate: DEFAULT_TV_FOLDER_TEMPLATE,
  tvFileTemplate: DEFAULT_TV_FILE_TEMPLATE,
  avFolderTemplate: DEFAULT_AV_FOLDER_TEMPLATE,
  avFileTemplate: DEFAULT_AV_FILE_TEMPLATE,
  washPoliciesYaml: '',
  washing: { mode: 'better', minGap: 0, minCoverage: 0.35, tie: 'keep', weights: { resolution: 30, source: 20, hdr: 5, codec: 5, size: 5 }, must: [], exclude: [] },
  categories: DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category })),
  categoryFormat: 'cms',
  cmsCategories: DEFAULT_CMS_CATEGORIES,
};

const GENRE_NAME_TO_ID: Record<string, number> = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80,
  Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36,
  Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749,
  'Science Fiction': 878, 'TV Movie': 10770, Thriller: 53, War: 10752, Western: 37,
  'Action & Adventure': 10759, Kids: 10762, News: 10763, Reality: 10764,
  'Sci-Fi & Fantasy': 10765, Soap: 10766, Talk: 10767, 'War & Politics': 10768,
};
const GENRE_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(GENRE_NAME_TO_ID).map(([name, id]) => [id, name]),
);

function splitList(value: unknown): string[] {
  return String(value ?? '').split(/[,;；\n]/).map((item) => item.trim()).filter(Boolean);
}

function simpleCategoriesToCms(categories: OrganizeCategory[]): string {
  const build = (mediaType: 'movie' | 'tv' | 'av') => {
    const block: Record<string, Record<string, string>> = {};
    for (const category of categories.filter((item) => item.mediaType === mediaType)) {
      const conditions: Record<string, string> = {};
      const genreIds = category.genres.map((name) => GENRE_NAME_TO_ID[name]).filter((id): id is number => Boolean(id));
      if (genreIds.length) conditions.genre_ids = genreIds.join(',');
      if (category.languages.length) conditions.original_language = category.languages.join(',');
      if (category.countries.length) conditions.origin_country = category.countries.join(',');
      if (category.keywords.length) conditions.keywords = category.keywords.join(',');
      block[category.name] = conditions;
    }
    return block;
  };
  return stringifyYaml({ movie: build('movie'), tv: build('tv'), av: build('av') }, { lineWidth: 0 });
}

function cmsToSimpleCategories(yamlText: string): { categories: OrganizeCategory[]; skipped: string[] } {
  const document = parseYaml(yamlText) as { movie?: unknown; tv?: unknown; av?: unknown } | null;
  const categories: OrganizeCategory[] = [];
  const skipped: string[] = [];
  if (!document || typeof document !== 'object') return { categories, skipped };
  for (const mediaType of ['movie', 'tv', 'av'] as const) {
    const block = document[mediaType];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [name, raw] of Object.entries(block as Record<string, unknown>)) {
      const conditions = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const unsupported = Object.keys(conditions).some((key) => !['genre_ids', 'original_language', 'origin_country', 'keywords'].includes(key) || /^[?+\-]/.test(key));
      if (unsupported) { skipped.push(name); continue; }
      const genres: string[] = [];
      for (const value of splitList(conditions.genre_ids)) {
        const id = Number(value);
        if (GENRE_ID_TO_NAME[id]) genres.push(GENRE_ID_TO_NAME[id]);
        else skipped.push(`${name} (类型 ${value})`);
      }
      const countries = splitList(conditions.origin_country);
      const languages = splitList(conditions.original_language);
      const keywords = splitList(conditions.keywords);
      if (countries.some((value) => value.startsWith('!')) || languages.some((value) => value.startsWith('!'))) {
        skipped.push(name);
        continue;
      }
      categories.push({
        id: `cms_${mediaType}_${categories.length}`,
        name,
        mediaType,
        genres,
        countries,
        languages,
        keywords,
      });
    }
  }
  return { categories, skipped };
}

const GENRE_OPTIONS: Record<'movie' | 'tv', Array<{ name: string; label: string }>> = {
  movie: [
    { name: 'Action', label: '动作' }, { name: 'Adventure', label: '冒险' },
    { name: 'Animation', label: '动画' }, { name: 'Comedy', label: '喜剧' },
    { name: 'Crime', label: '犯罪' }, { name: 'Documentary', label: '纪录片' },
    { name: 'Drama', label: '剧情' }, { name: 'Family', label: '家庭' },
    { name: 'Fantasy', label: '奇幻' }, { name: 'History', label: '历史' },
    { name: 'Horror', label: '恐怖' }, { name: 'Music', label: '音乐' },
    { name: 'Mystery', label: '悬疑' }, { name: 'Romance', label: '爱情' },
    { name: 'Science Fiction', label: '科幻' }, { name: 'TV Movie', label: '电视电影' },
    { name: 'Thriller', label: '惊悚' }, { name: 'War', label: '战争' }, { name: 'Western', label: '西部' },
  ],
  tv: [
    { name: 'Action & Adventure', label: '动作冒险' }, { name: 'Animation', label: '动画' },
    { name: 'Comedy', label: '喜剧' }, { name: 'Crime', label: '犯罪' },
    { name: 'Documentary', label: '纪录片' }, { name: 'Drama', label: '剧情' },
    { name: 'Family', label: '家庭' }, { name: 'Kids', label: '儿童' },
    { name: 'Mystery', label: '悬疑' }, { name: 'News', label: '新闻' },
    { name: 'Reality', label: '真人秀' }, { name: 'Sci-Fi & Fantasy', label: '科幻奇幻' },
    { name: 'Soap', label: '肥皂剧' }, { name: 'Talk', label: '脱口秀' },
    { name: 'War & Politics', label: '战争政治' }, { name: 'Western', label: '西部' },
  ],
};
const GENRE_LABELS: Record<string, string> = Object.fromEntries(
  [...GENRE_OPTIONS.movie, ...GENRE_OPTIONS.tv].map((genre) => [genre.name, genre.label]),
);

const COUNTRY_OPTIONS = [
  { value: 'CN', label: '中国大陆' }, { value: 'HK', label: '中国香港' }, { value: 'TW', label: '中国台湾' },
  { value: 'JP', label: '日本' }, { value: 'KR', label: '韩国' }, { value: 'KP', label: '朝鲜' },
  { value: 'TH', label: '泰国' }, { value: 'IN', label: '印度' }, { value: 'SG', label: '新加坡' },
  { value: 'MY', label: '马来西亚' }, { value: 'ID', label: '印度尼西亚' }, { value: 'PH', label: '菲律宾' },
  { value: 'VN', label: '越南' }, { value: 'TR', label: '土耳其' }, { value: 'IL', label: '以色列' },
  { value: 'AE', label: '阿联酋' }, { value: 'IR', label: '伊朗' }, { value: 'KZ', label: '哈萨克斯坦' },
  { value: 'US', label: '美国' }, { value: 'GB', label: '英国' }, { value: 'CA', label: '加拿大' },
  { value: 'AU', label: '澳大利亚' }, { value: 'NZ', label: '新西兰' }, { value: 'IE', label: '爱尔兰' },
  { value: 'FR', label: '法国' }, { value: 'DE', label: '德国' }, { value: 'ES', label: '西班牙' },
  { value: 'IT', label: '意大利' }, { value: 'PT', label: '葡萄牙' }, { value: 'NL', label: '荷兰' },
  { value: 'BE', label: '比利时' }, { value: 'CH', label: '瑞士' }, { value: 'SE', label: '瑞典' },
  { value: 'NO', label: '挪威' }, { value: 'DK', label: '丹麦' }, { value: 'FI', label: '芬兰' },
  { value: 'PL', label: '波兰' }, { value: 'CZ', label: '捷克' }, { value: 'RU', label: '俄罗斯' },
  { value: 'UA', label: '乌克兰' }, { value: 'HU', label: '匈牙利' }, { value: 'GR', label: '希腊' },
  { value: 'RO', label: '罗马尼亚' }, { value: 'AT', label: '奥地利' }, { value: 'IS', label: '冰岛' },
  { value: 'BR', label: '巴西' }, { value: 'MX', label: '墨西哥' }, { value: 'AR', label: '阿根廷' },
  { value: 'CO', label: '哥伦比亚' }, { value: 'CL', label: '智利' }, { value: 'ZA', label: '南非' },
  { value: 'EG', label: '埃及' }, { value: 'NG', label: '尼日利亚' }, { value: 'JO', label: '约旦' },
  { value: 'SA', label: '沙特' }, { value: 'QA', label: '卡塔尔' }, { value: 'LB', label: '黎巴嫩' },
  { value: 'MA', label: '摩洛哥' }, { value: 'PE', label: '秘鲁' }, { value: 'VE', label: '委内瑞拉' },
  { value: 'UY', label: '乌拉圭' }, { value: 'KE', label: '肯尼亚' }, { value: 'GH', label: '加纳' },
  { value: 'DZ', label: '阿尔及利亚' }, { value: 'TN', label: '突尼斯' }, { value: 'IQ', label: '伊拉克' },
  { value: 'KW', label: '科威特' }, { value: 'BD', label: '孟加拉国' }, { value: 'PK', label: '巴基斯坦' },
  { value: 'LK', label: '斯里兰卡' }, { value: 'MM', label: '缅甸' }, { value: 'KH', label: '柬埔寨' },
  { value: 'LA', label: '老挝' }, { value: 'MN', label: '蒙古' }, { value: 'NP', label: '尼泊尔' },
];
const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文（普通话）' }, { value: 'cn', label: '粤语' }, { value: 'bo', label: '藏语' },
  { value: 'za', label: '壮语' }, { value: 'ja', label: '日语' }, { value: 'ko', label: '韩语' },
  { value: 'en', label: '英语' }, { value: 'fr', label: '法语' }, { value: 'de', label: '德语' },
  { value: 'es', label: '西班牙语' }, { value: 'it', label: '意大利语' }, { value: 'pt', label: '葡萄牙语' },
  { value: 'ru', label: '俄语' }, { value: 'th', label: '泰语' }, { value: 'hi', label: '印地语' },
  { value: 'ta', label: '泰米尔语' }, { value: 'te', label: '泰卢固语' }, { value: 'ml', label: '马拉雅拉姆语' },
  { value: 'kn', label: '卡纳达语' }, { value: 'ar', label: '阿拉伯语' }, { value: 'he', label: '希伯来语' },
  { value: 'fa', label: '波斯语' }, { value: 'tr', label: '土耳其语' }, { value: 'pl', label: '波兰语' },
  { value: 'nl', label: '荷兰语' }, { value: 'sv', label: '瑞典语' }, { value: 'no', label: '挪威语' },
  { value: 'da', label: '丹麦语' }, { value: 'fi', label: '芬兰语' }, { value: 'cs', label: '捷克语' },
  { value: 'el', label: '希腊语' }, { value: 'hu', label: '匈牙利语' }, { value: 'ro', label: '罗马尼亚语' },
  { value: 'uk', label: '乌克兰语' }, { value: 'vi', label: '越南语' }, { value: 'id', label: '印尼语' },
  { value: 'ms', label: '马来语' }, { value: 'tl', label: '菲律宾语' }, { value: 'km', label: '高棉语' },
];

function CodePicker({ value, options, onChange, placeholder }: {
  value: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const labelOf = (code: string) => options.find((option) => option.value === code)?.label ?? code;
  const filtered = options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((item) => item !== code) : [...value, code]);
  };
  return (
    <div className="genre-picker" ref={ref}>
      <button type="button" className="input genre-picker-trigger" onClick={() => setOpen((current) => !current)}>
        {value.length ? value.map((code) => <span className="genre-chip" key={code}>{labelOf(code)}</span>) : <span className="genre-placeholder">{placeholder}</span>}
        <span className="genre-arrow">▾</span>
      </button>
      {open ? (
        <div className="genre-picker-menu code-picker-menu">
          <div className="genre-picker-head"><span>{placeholder}</span><button type="button" onClick={() => onChange([])}>清空</button></div>
          <input className="code-picker-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索中文或代码" autoFocus />
          <div className="genre-picker-list code-picker-list">
            {filtered.map((option) => (
              <button key={option.value} type="button" className={value.includes(option.value) ? 'active' : ''} onClick={() => toggle(option.value)}>
                <span className="genre-check">{value.includes(option.value) ? '✓' : ''}</span>
                <span>{option.label}</span>
                <em>{option.value}</em>
              </button>
            ))}
            {filtered.length === 0 ? <p className="code-picker-empty">没有匹配项</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GenrePicker({ value, mediaType, onChange }: {
  value: string[];
  mediaType: 'movie' | 'tv';
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);
  };
  return (
    <div className="genre-picker" ref={ref}>
      <button type="button" className="input genre-picker-trigger" onClick={() => setOpen((current) => !current)}>
        {value.length ? value.map((name) => <span className="genre-chip" key={name}>{GENRE_LABELS[name] ?? name}</span>) : <span className="genre-placeholder">选择类型</span>}
        <span className="genre-arrow">▾</span>
      </button>
      {open ? (
        <div className="genre-picker-menu">
          <div className="genre-picker-head"><span>选择类型</span><button type="button" onClick={() => onChange([])}>清空</button></div>
          <div className="genre-picker-list">
            {GENRE_OPTIONS[mediaType].map((genre) => (
              <button key={genre.name} type="button" className={value.includes(genre.name) ? 'active' : ''} onClick={() => toggle(genre.name)}>
                <span className="genre-check">{value.includes(genre.name) ? '✓' : ''}</span>
                <span>{genre.label}</span>
                <em>{genre.name}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const CATEGORY_PRESETS = {
  compact: `movie:\n  电影/动画电影:\n    genre_ids: "16"\n  电影/外语电影:\ntv:\n  剧集/动漫番剧:\n    genre_ids: "16"\n  剧集/其他:\nav:\n  AV/有码:\n  AV/无码:\n`,
  standard: `movie:\n  电影/动画电影:\n    genre_ids: "16"\n  电影/华语电影:\n    original_language: "zh,cn"\n  电影/外语电影:\ntv:\n  剧集/动漫番剧:\n    genre_ids: "16"\n  剧集/国产剧:\n    origin_country: "CN,HK,TW"\n  剧集/其他:\nav:\n  AV/有码:\n  AV/无码:\n`,
  detailed: `movie:\n  电影/动画电影:\n    genre_ids: "16"\n  电影/华语电影:\n    original_language: "zh,cn"\n  电影/日韩电影:\n    origin_country: "JP,KR"\n  电影/欧美电影:\n    origin_country: "US,GB,CA,AU,FR,DE"\n  电影/外语电影:\ntv:\n  剧集/动漫番剧:\n    genre_ids: "16"\n  剧集/国产剧:\n    origin_country: "CN,HK,TW"\n  剧集/日韩剧:\n    origin_country: "JP,KR"\n  剧集/欧美剧:\n    origin_country: "US,GB,CA,AU"\n  剧集/其他:\nav:\n  AV/有码:\n  AV/无码:\n`,
};

const WASH_POLICY_PRESETS = {
  compact: `电影洗版策略:\n  mode: replace\n  media_type: movie\n  priority_level:\n    - resource_pix: "2160p,4k"\n    - resource_pix: "1080p"\n剧集洗版策略:\n  mode: replace\n  media_type: tv\n  priority_level:\n    - resource_pix: "2160p,4k"\n    - resource_pix: "1080p"\n电影兜底:\n  mode: max_size\n  media_type: movie\n剧集兜底:\n  mode: max_size\n  media_type: tv\n`,
  standard: `电影洗版策略:\n  mode: replace\n  media_type: movie\n  priority_level:\n    - resource_team: "WiKi"\n      resource_effect: "!DV"\n    - resource_pix: "2160p,4k"\n      resource_type: "BluRay"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n      resource_type: "BluRay"\n    - resource_pix: "2160p,4k"\n      resource_type: "WEB-DL"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n剧集洗版策略:\n  mode: replace\n  media_type: tv\n  priority_level:\n    - resource_pix: "2160p,4k"\n      resource_type: "BluRay"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n      resource_type: "BluRay"\n    - resource_pix: "2160p,4k"\n      resource_type: "WEB-DL"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n电影兜底:\n  mode: max_size\n  media_type: movie\n剧集兜底:\n  mode: max_size\n  media_type: tv\n`,
  detailed: `电影洗版策略:\n  mode: replace\n  scope: group\n  media_type: movie\n  priority_level:\n    - resource_team: "WiKi"\n      resource_effect: "!DV"\n    - resource_pix: "2160p,4k"\n      resource_type: "BluRay"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n      resource_type: "BluRay"\n    - resource_pix: "2160p,4k"\n      resource_type: "WEB-DL"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n剧集洗版策略:\n  mode: replace\n  scope: group\n  media_type: tv\n  priority_level:\n    - resource_pix: "2160p,4k"\n      resource_type: "BluRay"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n      resource_type: "BluRay"\n    - resource_pix: "2160p,4k"\n      resource_type: "WEB-DL"\n      resource_effect: "!DV"\n    - resource_pix: "1080p"\n电影兜底:\n  mode: max_size\n  media_type: movie\n剧集兜底:\n  mode: max_size\n  media_type: tv\n`,
};

function washModeFromPolicies(text: string): WashConfig['mode'] | null {
  try {
    const document = parseYaml(text) as Record<string, unknown> | null;
    const first = document && typeof document === 'object' ? Object.values(document)[0] : null;
    const mode = first && typeof first === 'object' && !Array.isArray(first) ? (first as Record<string, unknown>).mode : null;
    if (mode === 'replace') return 'better';
    if (mode === 'skip') return 'off';
    if (mode === 'max_size' || mode === 'min_size') return mode;
    if (mode === 'coexist') return 'better';
  } catch {
    return null;
  }
  return null;
}

const RENAME_VARIANTS: Record<'movieFolder' | 'movieFile' | 'tvFolder' | 'tvFile' | 'avFolder' | 'avFile', Array<{ label: string; value: string }>> = {
  movieFolder: [
    { label: '精简', value: '{title}' },
    { label: '标准', value: '{title} ({year})' },
    { label: '详细', value: '{first_letter}-{title} ({year})' },
  ],
  movieFile: [
    { label: '精简', value: '{title}' },
    { label: '标准', value: '{title} ({year}){quality}' },
    { label: '详细', value: '{title}.{year}<.{resource_pix}><.{resource_type}><.{resource_effect}><.{video_encode}><.{audio_encode}>-<{resource_team}>' },
  ],
  tvFolder: [
    { label: '精简', value: '{title}-Season {season}' },
    { label: '标准', value: '{title} ({year})-Season {season}' },
    { label: '详细', value: '{first_letter}-{title} ({year})-Season {season}' },
  ],
  avFolder: [
    { label: '精简', value: '{title}' },
    { label: '标准', value: '{first_letter}-{title}' },
    { label: '详细', value: '{first_letter}-{title}-{year}' },
  ],
  avFile: [
    { label: '精简', value: '{title}' },
    { label: '标准', value: '{title}-{resource_pix}' },
    { label: '详细', value: '{title}-{resource_pix}-<{resource_team}>' },
  ],
  tvFile: [
    { label: '精简', value: '{title}.S{season}E{episode}' },
    { label: '标准', value: '{title}.S{season}E{episode}{quality}' },
    { label: '详细', value: '{title}.S{season}E{episode}<.{resource_pix}><.{resource_type}><.{resource_effect}><.{video_encode}><.{audio_encode}>-<{resource_team}>' },
  ],
};

const ACTION_LABEL: Record<OrganizeItem['action'], string> = {
  create: '新增', upgrade: '洗版', skip: '跳过', error: '失败',
};

const TEMPLATE_VARIABLES: Array<{ name: string; label: string }> = [
  { name: 'title', label: '标题' },
  { name: 'year', label: '年份' },
  { name: 'season', label: '季' },
  { name: 'episode', label: '集' },
  { name: 'quality', label: '画质' },
  { name: 'category', label: '分类' },
  { name: 'ext', label: '扩展名' },
  { name: 'resource_pix', label: '分辨率' },
  { name: 'resource_type', label: '片源' },
  { name: 'resource_effect', label: 'HDR' },
  { name: 'video_encode', label: '视频编码' },
  { name: 'audio_encode', label: '音频编码' },
  { name: 'resource_team', label: '制作组' },
  { name: 'first_letter', label: '首字母' },
  { name: 'fps', label: '帧率' },
  { name: 'resource_version', label: '版本' },
];

const TEMPLATE_SAMPLES = {
  movie: {
    title: '沙丘2', year: '2024', season: '01', episode: '01', quality: ' [2160p BluRay]',
    category: '科幻', ext: '.mkv', resource_pix: '2160p', resource_type: 'BluRay',
    resource_effect: 'DV', video_encode: 'HEVC', audio_encode: 'DTS',
    resource_team: 'WiKi', first_letter: 'S', fps: '24', resource_version: 'v2',
  },
  av: {
    title: 'SSIS-001', year: '2024', season: '01', episode: '01', quality: ' [1080p]',
    category: 'AV', ext: '.mp4', resource_pix: '1080p', resource_type: 'WEB-DL',
    resource_effect: '', video_encode: 'H264', audio_encode: 'AAC',
    resource_team: 'MetaTube', first_letter: 'S', fps: '30', resource_version: '',
  },
  tv: {
    title: '怪奇物语', year: '2025', season: '05', episode: '01', quality: ' [1080p WEB-DL]',
    category: '美剧', ext: '.mkv', resource_pix: '1080p', resource_type: 'WEB-DL',
    resource_effect: 'HDR', video_encode: 'HEVC', audio_encode: 'AAC',
    resource_team: 'WiKi', first_letter: 'G', fps: '24', resource_version: 'v2',
  },
};

function templatePreview(template: string, samples: Record<string, string>): string {
  if (!template.trim()) return '未填写';
  const rendered = template.replace(/<([^<>]+)>/g, (_match, inner: string) => {
    const keys = Array.from(inner.matchAll(/\{[-+]?([a-z_]+)\}/gi)).map((match) => match[1].toLowerCase());
    if (!keys.every((key) => Boolean(samples[key]))) return '';
    return inner.replace(/\{([-+]?)([a-z_]+)\}/gi, (_innerMatch, prefix: string, key: string) => `${prefix}${samples[key.toLowerCase()] ?? ''}`);
  }).replace(/\{([a-z_]+)\}/gi, (_match, key: string) => samples[key.toLowerCase()] ?? '');
  return rendered.replace(/[.\-/]+$/g, '').replace(/\s+/g, ' ').trim() || '未填写';
}

function RenameTemplateField({
  label, hint, value, onChange, sampleType, variants,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  sampleType: 'movie' | 'tv' | 'av';
  variants: Array<{ label: string; value: string }>;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const samples = TEMPLATE_SAMPLES[sampleType];

  const insert = (name: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const token = `{${name}}`;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      input?.focus();
      const position = start + token.length;
      input?.setSelectionRange(position, position);
    });
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="template-field">
        <input
          ref={inputRef}
          className="input mono-input"
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 160)}
          onChange={(event) => onChange(event.target.value)}
          placeholder="点击选择变量，或手动输入"
        />
        {open ? (
          <div className="template-variable-popover">
            <div className="template-variable-head"><span>变量</span><span>示例值</span></div>
            <div className="template-variable-list">
              {TEMPLATE_VARIABLES.map((variable) => (
                <button key={variable.name} type="button" onMouseDown={(event) => { event.preventDefault(); insert(variable.name); }}>
                  <code>{`{${variable.name}}`}</code>
                  <span>{samples[variable.name as keyof typeof samples]}<i>{variable.label}</i></span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="template-variants">
        {variants.map((variant) => (
          <button type="button" key={variant.label} className={value === variant.value ? 'active' : ''} onClick={() => onChange(variant.value)}>
            {variant.label}
          </button>
        ))}
      </div>
      <div className="template-example">示例：<code>{templatePreview(value, samples)}</code></div>
      <span className="field-hint">{hint}</span>
    </div>
  );
}

const UPGRADE_LABEL: Record<OrganizerSettings['upgradeStrategy'], string> = {
  off: '关闭：目标已存在就跳过',
  better: '仅当新版本画质更好',
  always: '总是替换',
  max_size: '体积更大才替换',
  min_size: '体积更小才替换',
  weighted: '权重洗版',
};

function OrganizerHelp({ topic }: { topic: 'rename' | 'categories' | 'upgrade' }) {
  if (topic === 'rename') {
    return (
      <div className="rule-help">
        <section>
          <h3>模板语法</h3>
          <ul>
            <li><code>{'{变量名}'}</code> 取变量值；认不出的变量名会原样保留。</li>
            <li><code>&lt;...{'{变量}'}...&gt;</code> 条件块：块内变量都有值才输出整块。</li>
            <li><code>[[ ]]</code> 输出真正的花括号。</li>
            <li>文件夹规则建议用 <code>-</code> 连接；如需多级目录仍可使用 <code>/</code>。</li>
            <li><code>{'{变量.replace(\'.\', \' \')}'}</code> 替换字符；<code>{'{变量.lower()}'}</code> / <code>{'{变量.upper()}'}</code> 转大小写。</li>
            <li>自动清理连续和首尾的 <code>.</code> <code>/</code> <code>-</code>；年份为空时不会留下尾巴。</li>
          </ul>
        </section>
        <section>
          <h3>基本信息</h3>
          <ul>
            <li><code>{'{title}'}</code> TMDb 标题；<code>{'{en_title}'}</code> 英文标题</li>
            <li><code>{'{year}'}</code> 年份；<code>{'{tmdb_id}'}</code> TMDb ID</li>
            <li><code>{'{first_letter}'}</code> 拼音首字母（大写）；<code>{'{ext}'}</code> 扩展名（含点）</li>
            <li><code>{'{original_name}'}</code> 原文件名；<code>{'{custom_regex_match}'}</code> 自定义正则（可空）</li>
          </ul>
        </section>
        <section>
          <h3>剧集专用</h3>
          <ul>
            <li><code>{'{season_episode}'}</code> SxxExx；<code>{'{season_num}'}</code> 季号；<code>{'{episode_num}'}</code> 集号</li>
            <li><code>{'{season_name}'}</code> 季名；<code>{'{season_year}'}</code> 季年份；<code>{'{episode_name}'}</code> 集名；<code>{'{disc_num}'}</code> 盘号（可能为空）</li>
          </ul>
        </section>
        <section>
          <h3>资源信息</h3>
          <ul>
            <li><code>{'{resource_pix}'}</code> 分辨率；<code>{'{fps}'}</code> 帧率；<code>{'{resource_version}'}</code> 版本</li>
            <li><code>{'{resource_source}'}</code> 来源；<code>{'{resource_type}'}</code> 质量；<code>{'{resource_effect}'}</code> 特效</li>
            <li><code>{'{video_encode}'}</code> 视频编码；<code>{'{audio_encode}'}</code> 音频编码；<code>{'{resource_team}'}</code> 发布组</li>
          </ul>
        </section>
        <section>
          <h3>执行顺序</h3>
          <p>创建目标文件夹 → 重命名文件 → 移动到媒体库 → 生成 STRM。模板没写扩展名时自动补原扩展名。</p>
        </section>
      </div>
    );
  }
  if (topic === 'categories') {
    return (
      <div className="rule-help">
        <section>
          <h3>YAML 分类规则</h3>
          <pre>{`categories:
  - name: 电影/动画电影
    mediaType: movie
    genres: [Animation]
  - name: 电影/华语电影
    mediaType: movie
    languages: [zh, cn]
  - name: 电影/外语电影
    mediaType: movie
  - name: 剧集/动漫番剧
    mediaType: tv
    genres: [Animation]
    countries: [JP]
  - name: 剧集/国产剧
    mediaType: tv
    countries: [CN, HK, TW]`}</pre>
          <p>分类名写什么就落到媒体库根下的什么位置，不再自动加 <code>Movies</code>/<code>TV</code> 前缀。最后一条不写条件就是兜底。</p>
        </section>
        <section>
          <h3>当前支持的字段</h3>
          <ul>
            <li><code>movie</code> / <code>tv</code>：顶层必须二选一。</li>
            <li>分类名：目录名，可用 <code>/</code> 建多级；没有条件的规则是兜底。</li>
            <li><code>genre_ids</code> / <code>original_language</code> / <code>origin_country</code> / <code>production_countries</code> / <code>release_year</code>。</li>
            <li><code>keywords</code> / <code>include_keywords</code> / <code>series_keywords</code> / <code>series_actors</code> / <code>series_directors</code>。</li>
            <li><code>custom_regex</code>；<code>?</code> 可选、<code>+</code> 必须、<code>-</code>/<code>!</code> 排除。</li>
          </ul>
        </section>
        <section>
          <h3>匹配规则</h3>
          <ul>
            <li>按列表从上到下匹配，命中第一个分类就停止。</li>
            <li>同一分类里的多个字段是“且”，字段内多个值是“或”。</li>
            <li>没有命中任何分类时进入 <code>电影/未分类</code> 或 <code>剧集/未分类</code>。</li>
            <li>分类目录自动创建，不需要 CID。</li>
          </ul>
        </section>
        <section>
          <h3>简单分类模式</h3>
          <p>简单模式用表单填写分类；YAML 模式直接解析上面的规则。</p>
        </section>
      </div>
    );
  }
  return (
    <div className="rule-help">
      <section>
        <h3>洗版模式</h3>
        <ul>
          <li><code>off</code> 已存在就跳过；<code>better</code> 画质更好才替换；<code>always</code> 总是替换。</li>
          <li><code>max_size</code> 保留更大版本；<code>min_size</code> 保留更小版本。</li>
          <li><code>weighted</code> 按分辨率、片源、HDR、编码、体积打分。</li>
        </ul>
      </section>
      <section>
        <h3>保护条件</h3>
        <ul>
          <li>最小分差：候选至少高多少分才替换。</li>
          <li>最低覆盖率：识别出的质量信息不足时倾向保留现有版本。</li>
          <li>必须/排除：字幕、DV、片源等硬性条件。</li>
          <li>高级 YAML 可以模拟比较，不会移动文件。</li>
        </ul>
      </section>
    </div>
  );
}

export function OrganizePage() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const stored = localStorage.getItem(ORGANIZE_TAB_KEY);
      return stored === 'rename' || stored === 'categories' || stored === 'upgrade' || stored === 'results' ? stored : 'settings';
    } catch {
      return 'settings';
    }
  });
  const [categoryMode, setCategoryMode] = useState<'simple' | 'yaml'>('simple');
  const [simpleCategoryType, setSimpleCategoryType] = useState<'movie' | 'tv' | 'av'>('movie');
  const [cmsYaml, setCmsYaml] = useState(DEFAULT_CMS_CATEGORIES);
  const [washMode, setWashMode] = useState<'simple' | 'yaml'>('simple');
  const [washPoliciesYaml, setWashPoliciesYaml] = useState('');
  const [pickerField, setPickerField] = useState<'sourcePath' | 'failedPath' | 'redundantPath' | null>(null);
  const [form, setForm] = useState<OrganizerSettings>(EMPTY);
  const [sources, setSources] = useState<Source[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [executing, setExecuting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState<'rename' | 'categories' | 'upgrade' | null>(null);
  const [simExisting, setSimExisting] = useState('Movie.2024.1080p.WEB-DL.mkv');
  const [simCandidate, setSimCandidate] = useState('Movie.2024.2160p.BluRay.HEVC.mkv');
  const [simResult, setSimResult] = useState<{ action: string; reason: string; candidateScore: number; existingScore: number; coverage: number } | null>(null);

  const changeTab = (next: Tab) => {
    setTab(next);
    try { localStorage.setItem(ORGANIZE_TAB_KEY, next); } catch { /* ignore */ }
  };

  useEffect(() => {
    void Promise.all([
      api.get<{ settings: Settings }>('/api/settings'),
      api.get<Source[]>('/api/sources'),
      api.get<Library[]>('/api/libraries'),
    ]).then(([data, list, libraryList]) => {
      const organizer = {
        ...EMPTY,
        ...(data.settings.organizer ?? {}),
        categories: data.settings.organizer?.categories?.length ? data.settings.organizer.categories : DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category })),
      };
      const selectedLibrary = libraryList.find((library) => library.id === organizer.libraryId)
        ?? libraryList.find((library) => library.sourceId === organizer.sourceId && library.sourcePath === organizer.libraryPath)
        ?? libraryList.find((library) => library.sourceId === organizer.sourceId);
      if (selectedLibrary) {
        organizer.libraryId = selectedLibrary.id;
        organizer.libraryPath = selectedLibrary.sourcePath;
      }
      setLibraries(libraryList);
      setForm(organizer);
      const initialCms = organizer.cmsCategories || simpleCategoriesToCms(organizer.categories);
      organizer.cmsCategories = initialCms;
      setForm(organizer);
      setCmsYaml(initialCms);
      setCategoryMode(organizer.categoryFormat === 'cms' ? 'yaml' : 'simple');
      setWashPoliciesYaml(organizer.washPoliciesYaml ?? '');
      const loadedWashMode = washModeFromPolicies(organizer.washPoliciesYaml ?? '');
      if (loadedWashMode) organizer.washing = { ...organizer.washing, mode: loadedWashMode };
      setSources(list.filter((source) => source.type === '115' || source.type === '123'));
    }).catch((error) => toast.error(error instanceof Error ? error.message : '读取整理设置失败'))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof OrganizerSettings>(key: K, value: OrganizerSettings[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const applySimpleCategories = (categories: OrganizeCategory[]) => {
    const cms = simpleCategoriesToCms(categories);
    setCmsYaml(cms);
    setForm((previous) => ({ ...previous, categories, cmsCategories: cms, categoryFormat: 'simple' }));
  };

  const applyCmsYaml = (text: string) => {
    setCmsYaml(text);
    try {
      const { categories, skipped } = cmsToSimpleCategories(text);
      setForm((previous) => ({ ...previous, cmsCategories: text, ...(categories.length ? { categories } : {}) }));
      if (skipped.length) toast.info(`YAML 已保存；${skipped.length} 条复杂规则无法同步到简单模式`);
    } catch {
      setForm((previous) => ({ ...previous, cmsCategories: text }));
    }
  };

  const updateCategory = (index: number, patch: Partial<OrganizeCategory>) => {
    const categories = form.categories.map((category, current) => current === index ? { ...category, ...patch } : category);
    applySimpleCategories(categories);
  };

  const resetCategories = () => {
    applySimpleCategories(DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category })));
    toast.success('已恢复默认简单分类');
  };

  const resetWashing = () => {
    setForm((previous) => ({ ...previous, washing: EMPTY.washing }));
    toast.success('已恢复默认洗版策略');
  };

  const addCategory = (mediaType: 'movie' | 'tv' | 'av') => {
    const categories = [...form.categories, { id: `cat_${Date.now().toString(36)}`, name: mediaType === 'movie' ? '新电影分类' : mediaType === 'tv' ? '新剧集分类' : '新AV分类', mediaType, genres: [], countries: [], languages: [], keywords: [] }];
    applySimpleCategories(categories);
  };

  const removeCategory = (index: number) => {
    if (form.categories.length <= 1) {
      toast.error('至少保留一个分类');
      return;
    }
    const categories = form.categories.filter((_, current) => current !== index);
    applySimpleCategories(categories);
  };

  const updateWash = (patch: Partial<WashConfig>) => {
    const washing = { ...form.washing, ...patch };
    setForm((previous) => ({ ...previous, washing }));
  };

  const updateWashWeights = (key: keyof WashConfig['weights'], value: number) => {
    updateWash({ weights: { ...form.washing.weights, [key]: Number.isFinite(value) ? value : 0 } });
  };

  const applyWashPolicyYaml = (text: string) => {
    setWashPoliciesYaml(text);
    const mode = washModeFromPolicies(text);
    setForm((previous) => ({ ...previous, washPoliciesYaml: text, ...(mode ? { washing: { ...previous.washing, mode } } : {}) }));
  };

  const simulateWash = async () => {
    try {
      await save();
      const result = await api.post<{ action: string; reason: string; candidateScore: number; existingScore: number; coverage: number }>('/api/organize/simulate', {
        candidateName: simCandidate,
        candidateSize: 0,
        existingName: simExisting,
        existingSize: 0,
      });
      setSimResult(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模拟失败');
    }
  };

  const validateForScan = () => {
    if (!form.sourceId) throw new Error('扫描前请选择来源账号');
    if (!form.sourcePath.trim()) throw new Error('扫描前请选择网盘待整理目录');
    if (!form.failedPath.trim()) throw new Error('扫描前请选择识别失败目录');
    if (!form.redundantPath.trim()) throw new Error('扫描前请选择冗余文件目录');
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await api.patch<{ settings: Settings }>('/api/settings', { organizer: form });
      const saved = response.settings.organizer;
      if (saved) {
        setForm(saved);
      }
      toast.success('整理设置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setBatch(null);
    try {
      validateForScan();
      await save();
      const result = await api.post<Batch>('/api/organize/scan');
      setBatch(result);
      changeTab('results');
      toast.success(`扫描完成，共 ${result.items.length} 个视频`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const execute = async () => {
    if (!batch) return;
    setExecuting(true);
    try {
      const result = await api.post<{ executed: number; failed: number; skipped: number; runId: string | null; syncError: string }>('/api/organize/execute', { batchId: batch.id });
      toast.success(`整理完成：执行 ${result.executed}，跳过 ${result.skipped}，失败 ${result.failed}${result.runId ? '，已触发 STRM 同步' : ''}`);
      if (result.syncError) toast.error(`整理完成，但同步媒体库失败：${result.syncError}`);
      setBatch(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '整理失败');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">ORGANIZE</span>
          <h1>网盘整理</h1>
          <p>115 / 123 网盘目录 → TMDb 识别 → 二级分类 → 洗版 → 网盘媒体库。</p>
        </div>
        <div className="page-head-actions">
          <Button variant="ghost" onClick={() => setHelpOpen(true)} icon={<HelpCircle size={16} />}>规则说明</Button>
          <Button variant="ghost" onClick={() => void save().catch(() => undefined)} loading={saving} icon={<WandSparkles size={16} />}>保存设置</Button>
          <Button variant="primary" onClick={() => void scan()} loading={scanning} icon={<ScanLine size={16} />}>扫描预览</Button>
        </div>
      </header>

      <div className="settings-tabs" role="tablist" aria-label="整理设置分类">
        <button role="tab" className={tab === 'settings' ? 'active' : ''} onClick={() => changeTab('settings')}><SlidersHorizontal size={15} />基本设置</button>
        <button role="tab" className={tab === 'rename' ? 'active' : ''} onClick={() => changeTab('rename')}><Pencil size={15} />重命名规则</button>
        <button role="tab" className={tab === 'categories' ? 'active' : ''} onClick={() => changeTab('categories')}><Tags size={15} />二级分类 <span>{form.categories.length}</span></button>
        <button role="tab" className={tab === 'upgrade' ? 'active' : ''} onClick={() => changeTab('upgrade')}><WandSparkles size={15} />洗版策略</button>
        <button role="tab" className={tab === 'results' ? 'active' : ''} onClick={() => changeTab('results')}><ScanLine size={15} />扫描结果 {batch ? <span>{batch.items.length}</span> : null}</button>
      </div>

      {tab === 'settings' ? (
        <div className="panel">
          <div className="panel-head"><div><h2>基本设置</h2><p>待整理目录和媒体库目录都在同一个 115 / 123 账号内。</p></div></div>
          <div className="source-tabs" role="tablist" aria-label="选择网盘账号">
            {sources.length === 0 ? <p className="settings-hint">还没有 115 / 123 账号，请先到“来源”添加。</p> : null}
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                role="tab"
                aria-selected={form.sourceId === source.id}
                className={form.sourceId === source.id ? 'active' : ''}
                onClick={() => {
                  const library = libraries.find((item) => item.id === form.libraryId);
                  setForm((previous) => ({ ...previous, sourceId: source.id, ...(library && library.sourceId !== source.id ? { libraryId: '', libraryPath: '' } : {}) }));
                }}
              >
                <strong>{source.name}</strong>
                <span>{source.type === '115' ? '115' : '123'}</span>
              </button>
            ))}
          </div>
          <div className="form-grid two-col">
            <Field label="网盘待整理目录" hint="从网盘目录中选择，也可以手动修改">
              <div className="path-input">
                <Input value={form.sourcePath} onChange={(event) => update('sourcePath', event.target.value)} placeholder="/Inbox" />
                <Button type="button" variant="secondary" size="sm" icon={<FolderOpen size={14} />} disabled={!form.sourceId} onClick={() => setPickerField('sourcePath')}>选择</Button>
              </div>
            </Field>
            <Field label="识别失败目录" hint="TMDb 识别失败的视频会移到这里">
              <div className="path-input">
                <Input value={form.failedPath} onChange={(event) => update('failedPath', event.target.value)} placeholder="/Failed" />
                <Button type="button" variant="secondary" size="sm" icon={<FolderOpen size={14} />} disabled={!form.sourceId} onClick={() => setPickerField('failedPath')}>选择</Button>
              </div>
            </Field>
            <Field label="冗余文件目录" hint="目标已有更好版本时，源文件会移到这里">
              <div className="path-input">
                <Input value={form.redundantPath} onChange={(event) => update('redundantPath', event.target.value)} placeholder="/Redundant" />
                <Button type="button" variant="secondary" size="sm" icon={<FolderOpen size={14} />} disabled={!form.sourceId} onClick={() => setPickerField('redundantPath')}>选择</Button>
              </div>
            </Field>
          </div>
        </div>
      ) : null}

      {tab === 'rename' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>重命名规则</h2><p>先按规则生成文件夹和文件名，再移动到媒体库；文件夹不存在会自动创建。</p></div>
            <Button type="button" variant="ghost" size="sm" icon={<HelpCircle size={14} />} onClick={() => setHelpTopic(helpTopic === 'rename' ? null : 'rename')}>填写说明</Button>
          </div>
          <div className="form-grid two-col">
            <RenameTemplateField label="电影文件夹" hint="点击输入框选择变量；快速模板会填入 - 分隔格式" value={form.movieFolderTemplate} onChange={(value) => update('movieFolderTemplate', value)} sampleType="movie" variants={RENAME_VARIANTS.movieFolder} />
            <RenameTemplateField label="电影文件" hint="不带扩展名时自动补原扩展名" value={form.movieFileTemplate} onChange={(value) => update('movieFileTemplate', value)} sampleType="movie" variants={RENAME_VARIANTS.movieFile} />
            <RenameTemplateField label="剧集文件夹" hint="例如 {title} ({year})-Season {season}" value={form.tvFolderTemplate} onChange={(value) => update('tvFolderTemplate', value)} sampleType="tv" variants={RENAME_VARIANTS.tvFolder} />
            <RenameTemplateField label="剧集文件" hint="例如 {title} - S{season}E{episode}{quality}" value={form.tvFileTemplate} onChange={(value) => update('tvFileTemplate', value)} sampleType="tv" variants={RENAME_VARIANTS.tvFile} />
            <RenameTemplateField label="AV 文件夹" hint="AV 番号的目录模板" value={form.avFolderTemplate} onChange={(value) => update('avFolderTemplate', value)} sampleType="av" variants={RENAME_VARIANTS.avFolder} />
            <RenameTemplateField label="AV 文件" hint="AV 番号的文件名模板" value={form.avFileTemplate} onChange={(value) => update('avFileTemplate', value)} sampleType="av" variants={RENAME_VARIANTS.avFile} />
          </div>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>二级分类</h2><p>按类型、国家、语言、关键词匹配；不匹配进入“其他”。</p></div>
            <div className="editor-switch">
              <button type="button" className={categoryMode === 'simple' ? 'active' : ''} onClick={() => { setCategoryMode('simple'); const converted = cmsToSimpleCategories(cmsYaml); if (converted.categories.length) update('categories', converted.categories); update('categoryFormat', 'simple'); }}>简单模式</button>
              <button type="button" className={categoryMode === 'yaml' ? 'active' : ''} onClick={() => { setCategoryMode('yaml'); update('categoryFormat', 'cms'); }}>YAML 模式</button>
            </div>
            <Button type="button" variant="ghost" size="sm" icon={<HelpCircle size={14} />} onClick={() => setHelpTopic(helpTopic === 'categories' ? null : 'categories')}>填写说明</Button>
          </div>
                    {categoryMode === 'yaml' ? (
            <div className="cms-category-editor">
              <div className="template-presets">
                <span>快速模板</span>
                {(Object.keys(CATEGORY_PRESETS) as Array<keyof typeof CATEGORY_PRESETS>).map((key) => (
                  <button key={key} type="button" onClick={() => { applyCmsYaml(CATEGORY_PRESETS[key]); update('categoryFormat', 'cms'); }}>{key === 'compact' ? '精简' : key === 'standard' ? '标准' : '详细'}</button>
                ))}
                <em>点击生成 YAML</em>
              </div>
              <textarea
                className="yaml-editor"
                value={cmsYaml}
                onChange={(event) => applyCmsYaml(event.target.value)}
                spellCheck={false}
                placeholder={'movie:\n  电影/动画电影:\n    genre_ids: "16"\ntv:\n  剧集/动漫番剧:\n    genre_ids: "16"'}
              />
              <div className="cms-category-preview">
                <strong>YAML 分类说明</strong>
                <p>顶层写 <code>movie</code> / <code>tv</code>，下一层是分类目录名，再下一层是条件。分类名写什么就落到媒体库根下的什么位置，不再自动加 Movies/TV 前缀。</p>
                <p>支持 <code>genre_ids</code>、<code>original_language</code>、<code>origin_country</code>、<code>production_countries</code>、<code>release_year</code>、<code>keywords</code>、<code>include_keywords</code>、<code>series_*</code>、<code>custom_regex</code>、可选 <code>?</code> 和排除 <code>-</code>/<code>!</code> 条件。</p>
                <p>不写条件的分类作为兜底；没有命中时进入 <code>电影/未分类</code> 或 <code>剧集/未分类</code>。</p>
              </div>
            </div>
          ) : (
            <div className="simple-category-list">
              <div className="simple-category-toolbar">
                <div className="editor-switch">
                  <button type="button" className={simpleCategoryType === 'movie' ? 'active' : ''} onClick={() => setSimpleCategoryType('movie')}>电影分类 <span>{form.categories.filter((category) => category.mediaType === 'movie').length}</span></button>
                  <button type="button" className={simpleCategoryType === 'tv' ? 'active' : ''} onClick={() => setSimpleCategoryType('tv')}>剧集分类 <span>{form.categories.filter((category) => category.mediaType === 'tv').length}</span></button>
                  <button type="button" className={simpleCategoryType === 'av' ? 'active' : ''} onClick={() => setSimpleCategoryType('av')}>AV 分类 <span>{form.categories.filter((category) => category.mediaType === 'av').length}</span></button>
                </div>
                <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => addCategory(simpleCategoryType)}>
                  添加{simpleCategoryType === 'movie' ? '电影' : simpleCategoryType === 'tv' ? '剧集' : 'AV'}分类
                </Button>
              </div>
              {form.categories.map((category, index) => category.mediaType !== simpleCategoryType ? null : (
                <div className="simple-category-row" key={category.id}>
                  <div className="simple-category-name">
                    <span className={`category-type ${category.mediaType}`}>{category.mediaType === 'movie' ? '电影' : category.mediaType === 'tv' ? '剧集' : 'AV'}</span>
                    <Input value={category.name} onChange={(event) => updateCategory(index, { name: event.target.value })} placeholder="分类名" />
                  </div>
                  <GenrePicker value={category.genres} mediaType={category.mediaType === 'tv' ? 'tv' : 'movie'} onChange={(genres) => updateCategory(index, { genres })} />
                  <CodePicker value={category.countries} options={COUNTRY_OPTIONS} onChange={(countries) => updateCategory(index, { countries })} placeholder="选择国家" />
                  <CodePicker value={category.languages} options={LANGUAGE_OPTIONS} onChange={(languages) => updateCategory(index, { languages })} placeholder="选择语言" />
                  <Input value={category.keywords.join(', ')} onChange={(event) => updateCategory(index, { keywords: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="关键词（可选）" />
                  <button type="button" className="simple-remove" onClick={() => removeCategory(index)} aria-label="删除分类">×</button>
                </div>
              ))}
              {form.categories.filter((category) => category.mediaType === simpleCategoryType).length === 0 ? (
                <p className="settings-hint">还没有{simpleCategoryType === 'movie' ? '电影' : simpleCategoryType === 'tv' ? '剧集' : 'AV'}分类，点击上方按钮添加。</p>
              ) : null}
              <div className="simple-category-footer">
                <Button type="button" variant="ghost" size="sm" onClick={resetCategories}>恢复默认分类</Button>
              </div>
              <p className="settings-hint">电影和剧集分类分开管理；同一分类内多个字段是 AND，字段内多个值是 OR；不命中时进入“其他”。</p>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'upgrade' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>洗版策略</h2><p>简单模式直接选规则；高级模式支持权重、分差、覆盖率和排除条件。</p></div>
            <div className="editor-switch">
              <button type="button" className={washMode === 'simple' ? 'active' : ''} onClick={() => setWashMode('simple')}>简单模式</button>
              <button type="button" className={washMode === 'yaml' ? 'active' : ''} onClick={() => setWashMode('yaml')}>YAML 模式</button>
            </div>
            <Button type="button" variant="ghost" size="sm" icon={<HelpCircle size={14} />} onClick={() => setHelpTopic(helpTopic === 'upgrade' ? null : 'upgrade')}>填写说明</Button>
          </div>
                    {washMode === 'simple' ? (
            <div className="simple-wash">
              <div className="form-grid form-grid-2">
                <Field label="洗版模式" hint="决定已有版本时如何处理">
                  <Select value={form.washing.mode} onChange={(event) => updateWash({ mode: event.target.value as WashConfig['mode'] })}>
                    {Object.entries(UPGRADE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                </Field>
                <Field label="同分处理">
                  <Select value={form.washing.tie} onChange={(event) => updateWash({ tie: event.target.value as 'keep' | 'replace' })}>
                    <option value="keep">保留现有版本</option>
                    <option value="replace">替换为候选版本</option>
                  </Select>
                </Field>
                <Field label="最小分差" hint="候选至少高多少分才替换">
                  <Input type="number" min={0} value={form.washing.minGap} onChange={(event) => updateWash({ minGap: Number(event.target.value) })} />
                </Field>
                <Field label="最低覆盖率" hint="0.5 表示至少识别出一半的质量信息">
                  <Input type="number" min={0} max={1} step={0.05} value={form.washing.minCoverage} onChange={(event) => updateWash({ minCoverage: Number(event.target.value) })} />
                </Field>
              </div>
              <div className="simple-wash-weights">
                <span className="yaml-preview-head">权重</span>
                {([
                  ['resolution', '分辨率'], ['source', '片源'], ['hdr', 'HDR'], ['codec', '编码'], ['size', '体积'],
                ] as const).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input type="number" min={0} value={form.washing.weights[key]} onChange={(event) => updateWashWeights(key, Number(event.target.value))} />
                  </Field>
                ))}
              </div>
              <div className="form-grid form-grid-2">
                <Field label="必须包含" hint="逗号分隔，例如 中字, 1080p">
                  <Input value={form.washing.must.join(', ')} onChange={(event) => updateWash({ must: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
                </Field>
                <Field label="排除" hint="逗号分隔，例如 DV, CAM">
                  <Input value={form.washing.exclude.join(', ')} onChange={(event) => updateWash({ exclude: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
                </Field>
              </div>
              <p className="settings-hint">画质比较：分辨率 → 片源 → HDR → 编码；体积也按权重参与。权重洗版只在信息足够且分差达到要求时替换。</p>
            </div>
          ) : (
          <div className="yaml-layout">
            <div className="yaml-editor-wrap">
              <div className="template-presets">
                <span>快速模板</span>
                {(Object.keys(WASH_POLICY_PRESETS) as Array<keyof typeof WASH_POLICY_PRESETS>).map((key) => (
                  <button key={key} type="button" onClick={() => applyWashPolicyYaml(WASH_POLICY_PRESETS[key])}>{key === 'compact' ? '精简' : key === 'standard' ? '标准' : '详细'}</button>
                ))}
                <em>点击生成 YAML</em>
              </div>
              <div className="yaml-editor-head"><FileCode2 size={14} />wash-policies.yaml <button type="button" className="yaml-reset" onClick={resetWashing}>恢复默认</button></div>
              <textarea className="yaml-editor" value={washPoliciesYaml} onChange={(event) => applyWashPolicyYaml(event.target.value)} spellCheck={false} placeholder={`电影洗版策略:\n  mode: replace\n  media_type: movie\n  priority_level:\n    - resource_pix: "2160p,4k"`} />
              <div className="yaml-ok">保存时校验 YAML</div>
            </div>
            <div className="yaml-preview">
              <div className="yaml-preview-head">可视化策略</div>
              <div className="upgrade-preview">
                <strong>{UPGRADE_LABEL[form.washing.mode]}</strong>
                <p>最小分差 {form.washing.minGap} · 最低覆盖率 {(form.washing.minCoverage * 100).toFixed(0)}% · 同分{form.washing.tie === 'keep' ? '保留现有' : '替换'}</p>
                <p>权重：分辨率 {form.washing.weights.resolution} / 片源 {form.washing.weights.source} / HDR {form.washing.weights.hdr} / 编码 {form.washing.weights.codec} / 体积 {form.washing.weights.size}</p>
                {form.washing.must.length ? <p>必须：{form.washing.must.join(', ')}</p> : null}
                {form.washing.exclude.length ? <p>排除：{form.washing.exclude.join(', ')}</p> : null}
              </div>
              <div className="yaml-preview-head">模拟比较</div>
              <Field label="现有文件名"><Input value={simExisting} onChange={(event) => setSimExisting(event.target.value)} /></Field>
              <Field label="候选文件名"><Input value={simCandidate} onChange={(event) => setSimCandidate(event.target.value)} /></Field>
              <Button type="button" variant="secondary" size="sm" onClick={() => void simulateWash()}>模拟比较</Button>
              {simResult ? (
                <div className="simulate-result">
                  <strong>{simResult.action === 'upgrade' ? '候选胜出，允许洗版' : '保留现有版本'}</strong>
                  <span>{simResult.reason}</span>
                  <span>候选 {simResult.candidateScore.toFixed(1)} / 现有 {simResult.existingScore.toFixed(1)} · 覆盖率 {(simResult.coverage * 100).toFixed(0)}%</span>
                </div>
              ) : null}
            </div>
          </div>
          )}
        </div>
      ) : null}

      {tab === 'results' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>扫描结果</h2><p>{batch ? `共 ${batch.items.length} 个视频，执行前请核对洗版和跳过项。` : '先扫描，确认 TMDb 匹配、分类和目标路径。'}</p></div>
            {batch ? <Button variant="primary" onClick={() => void execute()} loading={executing} icon={<FolderInput size={16} />}>执行整理</Button> : null}
          </div>
          {loading ? <p className="empty-note">读取设置中…</p> : null}
          {!batch && !loading ? <p className="empty-note">还没有扫描结果。切到基本设置填写 TMDb Key，再点右上角“扫描预览”。</p> : null}
          {batch ? (
            <div className="organize-results">
              {batch.items.map((item) => (
                <div className="organize-result" key={item.id}>
                  <div className="organize-result-main">
                    <strong>{item.title} {item.year ? `(${item.year})` : ''}</strong>
                    <span>{item.relativePath} <ArrowRight size={12} /> {item.destination}</span>
                  </div>
                  <span className={`organize-action ${item.action}`}>{ACTION_LABEL[item.action]}</span>
                  <div className="organize-result-meta">
                    <span>{item.quality || '未知画质'}</span>
                    {item.existingQuality ? <span className="muted">旧：{item.existingQuality}</span> : null}
                    <span className="muted">{item.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <DirectoryPicker
        open={pickerField !== null}
        sourceId={form.sourceId}
        sourceName={sources.find((source) => source.id === form.sourceId)?.name ?? ''}
        initialPath={pickerField ? form[pickerField] || '/' : '/'}
        onClose={() => setPickerField(null)}
        onSelect={(path) => {
          if (pickerField) update(pickerField, path);
          setPickerField(null);
        }}
      />

      <Modal
        open={helpTopic !== null}
        onClose={() => setHelpTopic(null)}
        title={helpTopic === 'rename' ? '重命名规则说明' : helpTopic === 'categories' ? '二级分类说明' : '洗版策略说明'}
        description="规则语法和可用变量"
        footer={<Button variant="secondary" onClick={() => setHelpTopic(null)}>关闭</Button>}
      >
        {helpTopic ? <OrganizerHelp topic={helpTopic} /> : null}
      </Modal>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="整理规则说明" description="二级分类、洗版策略和目录规范。" footer={<Button variant="secondary" onClick={() => setHelpOpen(false)}>关闭</Button>}>
        <div className="rule-help">
          <section>
            <h3>目录职责</h3>
            <ul>
              <li><strong>待整理目录</strong>：扫描视频的来源，例如 /Inbox。</li>
              <li><strong>识别失败目录</strong>：TMDb 找不到或解析失败的视频移到这里。</li>
              <li><strong>冗余文件目录</strong>：目标已有更好版本时，源文件移到这里。</li>
              <li><strong>媒体库根目录</strong>：在“媒体库”页面设置；整理时自动使用同来源媒体库的根目录。</li>
            </ul>
          </section>
          <section>
            <h3>二级分类 YAML</h3>
            <pre>{`categories:
  - name: 动作
    mediaType: movie
    genres: [Action, Adventure]
  - name: 国产剧
    mediaType: tv
    countries: [CN]`}</pre>
            <p>字段：<code>name</code>、<code>mediaType</code>（movie/tv）、<code>genres</code>、<code>countries</code>、<code>languages</code>、<code>keywords</code>。同一分类内多个条件之间是 AND；数组内多个值之间是 OR。从上到下匹配，第一个符合条件的分类生效。</p>
          </section>
          <section>
            <h3>洗版策略 YAML</h3>
            <pre>{`washing:
  mode: weighted
  min_gap: 5
  min_coverage: 0.5
  weights:
    resolution: 30
    source: 20
    hdr: 5
    codec: 5
    size: 5`}</pre>
            <p><code>off</code> 已存在就跳过；<code>better</code> 画质更好才替换；<code>always</code> 总是替换；<code>max_size</code> / <code>min_size</code> 按体积取舍；<code>weighted</code> 按权重和最小分差。画质比较顺序：分辨率 → 片源 → HDR → 编码。</p>
          </section>
          <section>
            <h3>重命名模板</h3>
            <pre>{`电影文件夹：{title} ({year})
电影文件：{title} ({year}){quality}
剧集文件夹：{title} ({year})/Season {season}
剧集文件：{title} - S{season}E{episode}{quality}`}</pre>
            <p>可用变量：<code>&#123;title&#125;</code> <code>&#123;year&#125;</code> <code>&#123;season&#125;</code> <code>&#123;episode&#125;</code> <code>&#123;quality&#125;</code> <code>&#123;ext&#125;</code> <code>&#123;category&#125;</code> <code>&#123;resource_pix&#125;</code> <code>&#123;resource_type&#125;</code> <code>&#123;resource_effect&#125;</code> <code>&#123;video_encode&#125;</code> <code>&#123;audio_encode&#125;</code> <code>&#123;resource_team&#125;</code> <code>&#123;first_letter&#125;</code>。用 <code>&lt;...&gt;</code> 包住的块只在其中变量都非空时输出。目录会自动创建，不需要填写云盘 ID。</p>
          </section>
          <section>
            <h3>媒体库同步</h3>
            <p>整理执行成功后，如果选择了“整理后同步媒体库”，会自动触发该媒体库生成/更新 STRM。旧版本文件会进入 115/123 回收站。</p>
          </section>
        </div>
      </Modal>
    </section>
  );
}
