import { ArrowRight, FileCode2, FolderInput, HelpCircle, Plus, ScanLine, SlidersHorizontal, Tags, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_ORGANIZE_CATEGORIES, type Library, type OrganizeCategory, type OrganizerSettings, type Settings, type Source } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Modal, Select, toast } from '../components/ui';

type Tab = 'settings' | 'categories' | 'upgrade' | 'results';

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
  sourcePath: '/Inbox',
  failedPath: '/Failed',
  redundantPath: '/Redundant',
  libraryPath: '/Media',
  libraryId: '',
  mode: 'move',
  upgradeStrategy: 'better',
  tmdbApiKey: '',
  tmdbLanguage: 'zh-CN',
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

function toUpgradeYaml(strategy: OrganizerSettings['upgradeStrategy']): string {
  return `strategy: ${strategy}\n`;
}

function fromUpgradeYaml(text: string): OrganizerSettings['upgradeStrategy'] {
  const document = parseYaml(text) as { strategy?: unknown } | null;
  const strategy = String(document?.strategy ?? '').trim();
  if (strategy !== 'off' && strategy !== 'better' && strategy !== 'always') {
    throw new Error('strategy 必须是 off、better 或 always');
  }
  return strategy;
}

const CATEGORY_SAMPLE = `categories:
  - name: 动作
    mediaType: movie
    genres: [Action, Adventure]
  - name: 科幻
    mediaType: movie
    genres: [Science Fiction]
  - name: 国产剧
    mediaType: tv
    countries: [CN]
  - name: 美剧
    mediaType: tv
    countries: [US]
`;

const UPGRADE_LABEL: Record<OrganizerSettings['upgradeStrategy'], string> = {
  off: '关闭：目标已存在就跳过',
  better: '仅当新版本画质更好',
  always: '总是替换',
};

function BadgeCategory({ type }: { type: 'movie' | 'tv' }) {
  return <span className={`category-type ${type}`}>{type === 'movie' ? '电影' : '剧集'}</span>;
}

export function OrganizePage() {
  const [tab, setTab] = useState<Tab>('settings');
  const [form, setForm] = useState<OrganizerSettings>(EMPTY);
  const [sources, setSources] = useState<Source[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [executing, setExecuting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [categoryYaml, setCategoryYaml] = useState(toCategoryYaml(EMPTY.categories));
  const [upgradeYaml, setUpgradeYaml] = useState(toUpgradeYaml(EMPTY.upgradeStrategy));
  const [categoryError, setCategoryError] = useState('');
  const [upgradeError, setUpgradeError] = useState('');

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
      setForm(organizer);
      setCategoryYaml(toCategoryYaml(organizer.categories));
      setUpgradeYaml(toUpgradeYaml(organizer.upgradeStrategy));
      setSources(list.filter((source) => source.type === '115' || source.type === '123'));
      setLibraries(libraryList);
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

  const changeUpgradeYaml = (text: string) => {
    setUpgradeYaml(text);
    try {
      const upgradeStrategy = fromUpgradeYaml(text);
      setForm((previous) => ({ ...previous, upgradeStrategy }));
      setUpgradeError('');
    } catch (error) {
      setUpgradeError(error instanceof Error ? error.message : 'YAML 解析失败');
    }
  };

  const save = async () => {
    if (categoryError || upgradeError) {
      toast.error('YAML 有错误，修正后才能保存');
      throw new Error('YAML 有错误');
    }
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
      if (!form.tmdbApiKey.trim()) throw new Error('请填写 TMDb API Key');
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
            <Field label="网盘待整理目录" hint="例如 /Inbox 或 /下载"><Input value={form.sourcePath} onChange={(event) => update('sourcePath', event.target.value)} placeholder="/Inbox" /></Field>
            <Field label="识别失败目录" hint="TMDb 识别失败的视频会移到这里"><Input value={form.failedPath} onChange={(event) => update('failedPath', event.target.value)} placeholder="/Failed" /></Field>
            <Field label="冗余文件目录" hint="目标已有更好版本时，源文件会移到这里"><Input value={form.redundantPath} onChange={(event) => update('redundantPath', event.target.value)} placeholder="/Redundant" /></Field>
            <Field label="网盘媒体库根目录" hint="例如 /Media；分类会建在它下面"><Input value={form.libraryPath} onChange={(event) => update('libraryPath', event.target.value)} placeholder="/Media" /></Field>
            <Field label="整理后同步媒体库" hint="整理成功后自动触发这个媒体库生成 STRM">
              <Select value={form.libraryId} onChange={(event) => update('libraryId', event.target.value)}>
                <option value="">暂不自动同步</option>
                {libraries.filter((library) => !form.sourceId || library.sourceId === form.sourceId).map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
              </Select>
            </Field>
            <Field label="TMDb API Key" hint="只保存在 /config/settings.json"><Input type="password" value={form.tmdbApiKey} onChange={(event) => update('tmdbApiKey', event.target.value)} placeholder="TMDb API Key" autoComplete="off" /></Field>
            <Field label="TMDb 语言"><Input value={form.tmdbLanguage} onChange={(event) => update('tmdbLanguage', event.target.value)} placeholder="zh-CN" /></Field>
          </div>
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="panel">
          <div className="panel-head">
            <div><h2>二级分类 YAML</h2><p>左侧实时解析，右侧预览；不匹配进入“其他”。</p></div>
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => changeCategoryYaml(CATEGORY_SAMPLE)}>插入示例</Button>
          </div>
          <div className="yaml-layout">
            <div className="yaml-editor-wrap">
              <div className="yaml-editor-head"><FileCode2 size={14} />categories.yaml</div>
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
        </div>
      ) : null}

      {tab === 'upgrade' ? (
        <div className="panel">
          <div className="panel-head"><div><h2>洗版策略 YAML</h2><p>只影响目标分类目录中已存在的同名电影/剧集。</p></div></div>
          <div className="yaml-layout">
            <div className="yaml-editor-wrap">
              <div className="yaml-editor-head"><FileCode2 size={14} />upgrade.yaml</div>
              <textarea className="yaml-editor" value={upgradeYaml} onChange={(event) => changeUpgradeYaml(event.target.value)} spellCheck={false} />
              {upgradeError ? <div className="yaml-error">{upgradeError}</div> : <div className="yaml-ok">YAML 有效</div>}
            </div>
            <div className="yaml-preview">
              <div className="yaml-preview-head">可视化策略</div>
              <div className="upgrade-preview">
                <strong>{UPGRADE_LABEL[form.upgradeStrategy]}</strong>
                <p>比较顺序：分辨率 → 片源 → HDR → 编码。旧版本会移入 115/123 回收站。</p>
              </div>
            </div>
          </div>
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
            <pre>{`strategy: better`}</pre>
            <p><code>off</code> 已存在就跳过；<code>better</code> 画质更好才替换；<code>always</code> 总是替换。画质比较顺序：分辨率 → 片源 → HDR → 编码。</p>
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
