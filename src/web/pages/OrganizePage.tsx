import { ArrowRight, FileCode2, FolderInput, FolderOpen, HelpCircle, Pencil, Plus, ScanLine, SlidersHorizontal, Tags, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_MOVIE_FILE_TEMPLATE, DEFAULT_MOVIE_FOLDER_TEMPLATE, DEFAULT_ORGANIZE_CATEGORIES, DEFAULT_TV_FILE_TEMPLATE, DEFAULT_TV_FOLDER_TEMPLATE, type OrganizeCategory, type OrganizerSettings, type Settings, type Source, type WashConfig } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Modal, Select, toast } from '../components/ui';
import { DirectoryPicker } from '../components/DirectoryPicker';

type Tab = 'settings' | 'rename' | 'categories' | 'upgrade' | 'results';

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
  washing: { mode: 'better', minGap: 0, minCoverage: 0.35, tie: 'keep', weights: { resolution: 30, source: 20, hdr: 5, codec: 5, size: 5 }, must: [], exclude: [] },
  categories: DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category })),
};

const ACTION_LABEL: Record<OrganizeItem['action'], string> = {
  create: '新增', upgrade: '洗版', skip: '跳过', error: '失败',
};

function toCategoryYaml(categories: OrganizeCategory[]): string {
  return stringifyYaml({ categories: categories.map(({ id: _id, ...rest }) => rest) }, { lineWidth: 0 });
}

function fromCategoryYaml(text: string): OrganizeCategory[] {
  const document = parseYaml(text) as { categories?: unknown } | null;
  if (!document || !Array.isArray(document.categories)) throw new Error('YAML 需要 categories 列表');
  if (document.categories.length === 0) throw new Error('至少需要一个分类');
  return document.categories.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const name = String(item.name ?? '').trim();
    if (!name) throw new Error(`第 ${index + 1} 个分类缺少 name`);
    const mediaType = item.mediaType === 'tv' ? 'tv' : item.mediaType === 'movie' ? 'movie' : null;
    if (!mediaType) throw new Error(`分类「${name}」的 mediaType 必须是 movie 或 tv`);
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String).map((v) => v.trim()).filter(Boolean) : [];
    return {
      id: `cat_${index}_${name}`,
      name,
      mediaType,
      genres: strings(item.genres),
      countries: strings(item.countries),
      languages: strings(item.languages),
      keywords: strings(item.keywords),
    };
  });
}

function toWashYaml(washing: WashConfig): string {
  return stringifyYaml({
    mode: washing.mode,
    min_gap: washing.minGap,
    min_coverage: washing.minCoverage,
    tie: washing.tie,
    weights: {
      resolution: washing.weights.resolution,
      source: washing.weights.source,
      hdr: washing.weights.hdr,
      codec: washing.weights.codec,
      size: washing.weights.size,
    },
    must: washing.must,
    exclude: washing.exclude,
  }, { lineWidth: 0 });
}

function fromWashYaml(text: string): WashConfig {
  const document = parseYaml(text) as Record<string, unknown> | null;
  const mode = String(document?.mode ?? 'better');
  if (!['off', 'better', 'always', 'max_size', 'min_size', 'weighted'].includes(mode)) {
    throw new Error('mode 必须是 off、better、always、max_size、min_size 或 weighted');
  }
  const weights = (document?.weights ?? {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const strings = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  return {
    mode: mode as WashConfig['mode'],
    minGap: number(document?.min_gap, 0),
    minCoverage: Math.min(1, Math.max(0, number(document?.min_coverage, 0.35))),
    tie: document?.tie === 'replace' ? 'replace' : 'keep',
    weights: {
      resolution: number(weights.resolution, 30),
      source: number(weights.source, 20),
      hdr: number(weights.hdr, 5),
      codec: number(weights.codec, 5),
      size: number(weights.size, 5),
    },
    must: strings(document?.must),
    exclude: strings(document?.exclude),
  };
}

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
    const keys = Array.from(inner.matchAll(/\{([a-z_]+)\}/gi)).map((match) => match[1].toLowerCase());
    return keys.every((key) => Boolean(samples[key])) ? inner : '';
  }).replace(/\{([a-z_]+)\}/gi, (_match, key: string) => samples[key.toLowerCase()] ?? '');
  return rendered || '未填写';
}

function RenameTemplateField({
  label, hint, value, onChange, sampleType,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  sampleType: 'movie' | 'tv';
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
    <Field label={label} hint={hint}>
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
      <div className="template-example">示例：<code>{templatePreview(value, samples)}</code></div>
    </Field>
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

function BadgeCategory({ type }: { type: 'movie' | 'tv' }) {
  return <span className={`category-type ${type}`}>{type === 'movie' ? '电影' : '剧集'}</span>;
}

export function OrganizePage() {
  const [tab, setTab] = useState<Tab>('settings');
  const [categoryMode, setCategoryMode] = useState<'simple' | 'yaml'>('simple');
  const [washMode, setWashMode] = useState<'simple' | 'yaml'>('simple');
  const [pickerField, setPickerField] = useState<'sourcePath' | 'failedPath' | 'redundantPath' | 'libraryPath' | null>(null);
  const [form, setForm] = useState<OrganizerSettings>(EMPTY);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [executing, setExecuting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [categoryYaml, setCategoryYaml] = useState(toCategoryYaml(EMPTY.categories));
  const [categoryError, setCategoryError] = useState('');
  const [washYaml, setWashYaml] = useState(toWashYaml(EMPTY.washing));
  const [washError, setWashError] = useState('');
  const [simExisting, setSimExisting] = useState('Movie.2024.1080p.WEB-DL.mkv');
  const [simCandidate, setSimCandidate] = useState('Movie.2024.2160p.BluRay.HEVC.mkv');
  const [recognizeName, setRecognizeName] = useState('Movie.2024.2160p.BluRay.HEVC.mkv');
  const [recognizeBusy, setRecognizeBusy] = useState(false);
  const [recognizeResult, setRecognizeResult] = useState<{ title: string; year: string; mediaType: string; tmdbId: number | null } | null>(null);
  const [simResult, setSimResult] = useState<{ action: string; reason: string; candidateScore: number; existingScore: number; coverage: number } | null>(null);

  useEffect(() => {
    void Promise.all([
      api.get<{ settings: Settings }>('/api/settings'),
      api.get<Source[]>('/api/sources'),
    ]).then(([data, list]) => {
      const organizer = {
        ...EMPTY,
        ...(data.settings.organizer ?? {}),
        categories: data.settings.organizer?.categories?.length ? data.settings.organizer.categories : DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category })),
      };
      setForm(organizer);
      setCategoryYaml(toCategoryYaml(organizer.categories));
      setWashYaml(toWashYaml(organizer.washing ?? EMPTY.washing));
      setSources(list.filter((source) => source.type === '115' || source.type === '123'));
    }).catch((error) => toast.error(error instanceof Error ? error.message : '读取整理设置失败'))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof OrganizerSettings>(key: K, value: OrganizerSettings[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const changeCategoryYaml = (text: string) => {
    setCategoryYaml(text);
    try {
      const categories = fromCategoryYaml(text);
      setForm((previous) => ({ ...previous, categories }));
      setCategoryError('');
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'YAML 解析失败');
    }
  };

  const resetCategories = () => {
    const categories = DEFAULT_ORGANIZE_CATEGORIES.map((category) => ({ ...category }));
    setForm((previous) => ({ ...previous, categories }));
    setCategoryYaml(toCategoryYaml(categories));
    setCategoryError('');
    toast.success('已恢复默认二级分类，保存后生效');
  };

  const resetWashing = () => {
    const washing = EMPTY.washing;
    setForm((previous) => ({ ...previous, washing }));
    setWashYaml(toWashYaml(washing));
    setWashError('');
    toast.success('已恢复默认洗版策略，保存后生效');
  };

  const updateCategory = (index: number, patch: Partial<OrganizeCategory>) => {
    const categories = form.categories.map((category, current) => current === index ? { ...category, ...patch } : category);
    setForm((previous) => ({ ...previous, categories }));
    setCategoryYaml(toCategoryYaml(categories));
  };

  const addCategory = () => {
    const categories = [...form.categories, { id: `cat_${Date.now().toString(36)}`, name: '新分类', mediaType: 'movie' as const, genres: [], countries: [], languages: [], keywords: [] }];
    setForm((previous) => ({ ...previous, categories }));
    setCategoryYaml(toCategoryYaml(categories));
  };

  const removeCategory = (index: number) => {
    if (form.categories.length <= 1) {
      toast.error('至少保留一个分类');
      return;
    }
    const categories = form.categories.filter((_, current) => current !== index);
    setForm((previous) => ({ ...previous, categories }));
    setCategoryYaml(toCategoryYaml(categories));
  };

  const updateWash = (patch: Partial<WashConfig>) => {
    const washing = { ...form.washing, ...patch };
    setForm((previous) => ({ ...previous, washing }));
    setWashYaml(toWashYaml(washing));
  };

  const updateWashWeights = (key: keyof WashConfig['weights'], value: number) => {
    updateWash({ weights: { ...form.washing.weights, [key]: Number.isFinite(value) ? value : 0 } });
  };

  const changeWashYaml = (text: string) => {
    setWashYaml(text);
    try {
      const washing = fromWashYaml(text);
      setForm((previous) => ({ ...previous, washing }));
      setWashError('');
    } catch (error) {
      setWashError(error instanceof Error ? error.message : '洗版 YAML 解析失败');
    }
  };

  const recognize = async () => {
    setRecognizeBusy(true);
    try {
      const result = await api.post<{ parsed: { title: string; year: string; mediaType: string; season: number; episode: number }; tmdb: { id: number } | null }>('/api/organize/recognize', { filename: recognizeName });
      setRecognizeResult({ title: result.parsed.title, year: result.parsed.year, mediaType: result.parsed.mediaType, tmdbId: result.tmdb?.id ?? null });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '识别测试失败');
    } finally {
      setRecognizeBusy(false);
    }
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

  const validatePaths = () => {
    if (!form.sourceId) throw new Error('请选择来源账号');
    if (!form.sourcePath.trim()) throw new Error('请选择网盘待整理目录');
    if (!form.failedPath.trim()) throw new Error('请选择识别失败目录');
    if (!form.redundantPath.trim()) throw new Error('请选择冗余文件目录');
    if (!form.libraryPath.trim()) throw new Error('请选择网盘媒体库根目录');
  };

  const save = async () => {
    if (categoryError || washError) {
      toast.error('YAML 有错误，修正后才能保存');
      throw new Error('YAML 有错误');
    }
    validatePaths();
    setSaving(true);
    try {
      await api.patch('/api/settings', { organizer: form });
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
      await save();
      const result = await api.post<Batch>('/api/organize/scan');
      setBatch(result);
      setTab('results');
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
        <button role="tab" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><SlidersHorizontal size={15} />基本设置</button>
        <button role="tab" className={tab === 'rename' ? 'active' : ''} onClick={() => setTab('rename')}><Pencil size={15} />重命名规则</button>
        <button role="tab" className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}><Tags size={15} />二级分类 <span>{form.categories.length}</span></button>
        <button role="tab" className={tab === 'upgrade' ? 'active' : ''} onClick={() => setTab('upgrade')}><WandSparkles size={15} />洗版策略</button>
        <button role="tab" className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}><ScanLine size={15} />扫描结果 {batch ? <span>{batch.items.length}</span> : null}</button>
      </div>

      {tab === 'settings' ? (
        <div className="panel">
          <div className="panel-head"><div><h2>基本设置</h2><p>待整理目录和媒体库目录都在同一个 115 / 123 账号内。</p></div></div>
          <div className="form-grid two-col">
            <Field label="来源账号" hint="仅支持 115 / 123 原生账号">
              <Select value={form.sourceId} onChange={(event) => update('sourceId', event.target.value)}>
                <option value="">请选择账号</option>
                {sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.type === '115' ? '115' : '123'}</option>)}
              </Select>
            </Field>
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
            <Field label="网盘媒体库根目录" hint="例如 /Media；分类会建在它下面">
              <div className="path-input">
                <Input value={form.libraryPath} onChange={(event) => update('libraryPath', event.target.value)} placeholder="/Media" />
                <Button type="button" variant="secondary" size="sm" icon={<FolderOpen size={14} />} disabled={!form.sourceId} onClick={() => setPickerField('libraryPath')}>选择</Button>
              </div>
            </Field>
            <Field label="识别测试" hint="输入实际文件名，不移动文件">
              <Input value={recognizeName} onChange={(event) => setRecognizeName(event.target.value)} />
              <div className="inline-action">
                <Button type="button" variant="secondary" size="sm" loading={recognizeBusy} onClick={() => void recognize()}>测试识别</Button>
                {recognizeResult ? <span>{recognizeResult.title} ({recognizeResult.year}) · {recognizeResult.mediaType} · TMDb {recognizeResult.tmdbId ?? '未匹配'}</span> : null}
              </div>
            </Field>
          </div>
        </div>
      ) : null}

      {tab === 'rename' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>重命名规则</h2><p>先按规则生成文件夹和文件名，再移动到媒体库；文件夹不存在会自动创建。</p></div>
          </div>
          <div className="tab-help">
            <div className="tab-help-title"><HelpCircle size={15} /> 重命名说明</div>
            <div className="tab-help-grid">
              <div>
                <strong>文件夹模板</strong>
                <p>决定媒体库里的目标文件夹。可以用 <code>/</code> 多级目录，例如剧集按季分目录。</p>
              </div>
              <div>
                <strong>文件模板</strong>
                <p>决定最终文件名；模板没写扩展名时自动补原文件扩展名。</p>
              </div>
              <div>
                <strong>条件块</strong>
                <p><code>&lt;.&#123;resource_pix&#125;&gt;</code> 只有在变量非空时才输出，适合可选画质/编码/小组。</p>
              </div>
              <div>
                <strong>执行顺序</strong>
                <p>创建目标文件夹 → 重命名文件 → 移动到媒体库 → 生成 STRM。</p>
              </div>
            </div>
            <div className="tab-help-vars">
              <span>可用变量</span>
              {['{title}', '{year}', '{season}', '{episode}', '{quality}', '{category}', '{ext}', '{resource_pix}', '{resource_type}', '{resource_effect}', '{video_encode}', '{audio_encode}', '{resource_team}', '{first_letter}', '{fps}', '{resource_version}'].map((item) => <code key={item}>{item}</code>)}
            </div>
          </div>
          <div className="form-grid two-col">
            <RenameTemplateField label="电影文件夹" hint="支持 / 多级目录；点击输入框可选择变量" value={form.movieFolderTemplate} onChange={(value) => update('movieFolderTemplate', value)} sampleType="movie" />
            <RenameTemplateField label="电影文件" hint="不带扩展名时自动补原扩展名" value={form.movieFileTemplate} onChange={(value) => update('movieFileTemplate', value)} sampleType="movie" />
            <RenameTemplateField label="剧集文件夹" hint="支持 / 分季；例如 {title} ({year})/Season {season}" value={form.tvFolderTemplate} onChange={(value) => update('tvFolderTemplate', value)} sampleType="tv" />
            <RenameTemplateField label="剧集文件" hint="例如 {title} - S{season}E{episode}{quality}" value={form.tvFileTemplate} onChange={(value) => update('tvFileTemplate', value)} sampleType="tv" />
          </div>
          <div className="rename-preview">
            <div className="yaml-preview-head">整理后路径预览</div>
            <code>{form.libraryPath}/Movies/{'{分类}'}/{form.movieFolderTemplate}/{form.movieFileTemplate}</code>
            <code>{form.libraryPath}/TV/{'{分类}'}/{form.tvFolderTemplate}/{form.tvFileTemplate}</code>
            <p>变量：{'{title}'} {'{year}'} {'{season}'} {'{episode}'} {'{quality}'} {'{category}'} {'{ext}'}，以及 {'{resource_pix}'} {'{resource_type}'} {'{resource_effect}'} {'{video_encode}'} {'{audio_encode}'} {'{resource_team}'} {'{first_letter}'}。</p>
            <p>执行顺序：创建目标目录 → 重命名文件 → 移动到媒体库 → 可选自动生成 STRM。</p>
          </div>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>二级分类</h2><p>按类型、国家、语言、关键词匹配；不匹配进入“其他”。</p></div>
            <div className="editor-switch">
              <button type="button" className={categoryMode === 'simple' ? 'active' : ''} onClick={() => setCategoryMode('simple')}>简单表单</button>
              <button type="button" className={categoryMode === 'yaml' ? 'active' : ''} onClick={() => { setCategoryMode('yaml'); setCategoryYaml(toCategoryYaml(form.categories)); }}>高级 YAML</button>
            </div>
          </div>
          <div className="tab-help">
            <div className="tab-help-title"><HelpCircle size={15} /> 分类匹配说明</div>
            <div className="tab-help-grid">
              <div><strong>从上到下</strong><p>按列表顺序匹配，命中第一个分类就停止；最后应保留一个“其他”兜底。</p></div>
              <div><strong>字段之间</strong><p>同一分类里的类型、国家、语言、关键词是 AND，需要同时满足。</p></div>
              <div><strong>字段内部</strong><p>一个字段填多个值是 OR，例如类型填 <code>Action, Adventure</code>。</p></div>
              <div><strong>目录</strong><p>分类目录会自动创建在媒体库根目录下，不需要填写云盘 CID。</p></div>
            </div>
            <p className="tab-help-note">例如“国产剧”可以设置：类型=剧集，国家=CN, TW, HK。没有命中任何条件时进入“其他”。</p>
          </div>
          {categoryMode === 'simple' ? (
            <div className="simple-category-list">
              {form.categories.map((category, index) => (
                <div className="simple-category-row" key={category.id}>
                  <div className="simple-category-name">
                    <Input value={category.name} onChange={(event) => updateCategory(index, { name: event.target.value })} placeholder="分类名" />
                    <Select value={category.mediaType} onChange={(event) => updateCategory(index, { mediaType: event.target.value as 'movie' | 'tv' })}>
                      <option value="movie">电影</option>
                      <option value="tv">剧集</option>
                    </Select>
                  </div>
                  <Input value={category.genres.join(', ')} onChange={(event) => updateCategory(index, { genres: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="类型，如 Action, Adventure" />
                  <Input value={category.countries.join(', ')} onChange={(event) => updateCategory(index, { countries: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="国家，如 CN, US" />
                  <Input value={category.languages.join(', ')} onChange={(event) => updateCategory(index, { languages: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="语言，如 zh, en" />
                  <Input value={category.keywords.join(', ')} onChange={(event) => updateCategory(index, { keywords: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="关键词（可选）" />
                  <button type="button" className="simple-remove" onClick={() => removeCategory(index)} aria-label="删除分类">×</button>
                </div>
              ))}
              <div className="simple-category-footer">
                <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addCategory}>添加分类</Button>
                <Button type="button" variant="ghost" size="sm" onClick={resetCategories}>恢复默认</Button>
              </div>
              <p className="settings-hint">同一分类内多个字段是 AND，字段内多个值是 OR；从上到下匹配，最后“其他”兜底。分类目录会自动创建，不需要填写云盘 CID。</p>
            </div>
          ) : (
            <div className="yaml-layout">
              <div className="yaml-editor-wrap">
                <div className="yaml-editor-head"><FileCode2 size={14} />categories.yaml <button type="button" className="yaml-reset" onClick={resetCategories}>恢复默认</button></div>
                <textarea className="yaml-editor" value={categoryYaml} onChange={(event) => changeCategoryYaml(event.target.value)} spellCheck={false} />
                {categoryError ? <div className="yaml-error">{categoryError}</div> : <div className="yaml-ok">YAML 有效 · {form.categories.length} 个分类</div>}
              </div>
              <div className="yaml-preview">
                <div className="yaml-preview-head">可视化分类</div>
                {form.categories.length === 0 ? <p className="empty-note">暂无分类。</p> : null}
                {form.categories.map((category) => (
                  <div className="category-preview" key={category.id}>
                    <div className="category-preview-top">
                      <strong>{category.name}</strong>
                      <BadgeCategory type={category.mediaType} />
                    </div>
                    <div className="category-chips">
                      {category.genres.map((value) => <span key={`g-${value}`}>类型 · {value}</span>)}
                      {category.countries.map((value) => <span key={`c-${value}`}>国家 · {value}</span>)}
                      {category.languages.map((value) => <span key={`l-${value}`}>语言 · {value}</span>)}
                      {category.keywords.map((value) => <span key={`k-${value}`}>关键词 · {value}</span>)}
                      {!category.genres.length && !category.countries.length && !category.languages.length && !category.keywords.length ? <span className="muted">兜底分类</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'upgrade' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>洗版策略</h2><p>简单模式直接选规则；高级模式支持权重、分差、覆盖率和排除条件。</p></div>
            <div className="editor-switch">
              <button type="button" className={washMode === 'simple' ? 'active' : ''} onClick={() => setWashMode('simple')}>简单表单</button>
              <button type="button" className={washMode === 'yaml' ? 'active' : ''} onClick={() => { setWashMode('yaml'); setWashYaml(toWashYaml(form.washing)); }}>高级 YAML</button>
            </div>
          </div>
          <div className="tab-help">
            <div className="tab-help-title"><HelpCircle size={15} /> 洗版说明</div>
            <div className="tab-help-grid">
              <div><strong>关闭 / 更好 / 总是</strong><p><code>off</code> 已存在就跳过；<code>better</code> 画质更好才替换；<code>always</code> 总是替换。</p></div>
              <div><strong>按体积</strong><p><code>max_size</code> 保留更大版本，<code>min_size</code> 保留更小版本。</p></div>
              <div><strong>权重洗版</strong><p>按分辨率、片源、HDR、编码、体积打分；分差达到阈值才替换。</p></div>
              <div><strong>保护条件</strong><p>最低覆盖率避免信息不足误判；必须/排除条件用于字幕、DV、片源等硬性要求。</p></div>
            </div>
            <p className="tab-help-note">高级 YAML 右侧可以输入现有/候选文件名做模拟比较，结果不会移动任何文件。</p>
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
              <div className="yaml-editor-head"><FileCode2 size={14} />washing.yaml <button type="button" className="yaml-reset" onClick={resetWashing}>恢复默认</button></div>
              <textarea className="yaml-editor" value={washYaml} onChange={(event) => changeWashYaml(event.target.value)} spellCheck={false} />
              {washError ? <div className="yaml-error">{washError}</div> : <div className="yaml-ok">YAML 有效</div>}
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

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="整理规则说明" description="二级分类、洗版策略和目录规范。" footer={<Button variant="secondary" onClick={() => setHelpOpen(false)}>关闭</Button>}>
        <div className="rule-help">
          <section>
            <h3>目录职责</h3>
            <ul>
              <li><strong>待整理目录</strong>：扫描视频的来源，例如 /Inbox。</li>
              <li><strong>识别失败目录</strong>：TMDb 找不到或解析失败的视频移到这里。</li>
              <li><strong>冗余文件目录</strong>：目标已有更好版本时，源文件移到这里。</li>
              <li><strong>媒体库根目录</strong>：分类和媒体目录会建在它下面，例如 /Media。</li>
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
