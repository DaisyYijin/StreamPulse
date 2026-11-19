import { ArrowRight, FolderInput, Plus, ScanLine, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OrganizeCategory, OrganizerSettings, Settings } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Select, toast } from '../components/ui';

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
interface Batch {
  id: string;
  items: OrganizeItem[];
}

const EMPTY: OrganizerSettings = {
  importDir: '/import',
  libraryDir: '/media',
  mode: 'move',
  upgradeStrategy: 'better',
  tmdbApiKey: '',
  tmdbLanguage: 'zh-CN',
  categories: [],
};

const ACTION_LABEL: Record<OrganizeItem['action'], string> = {
  create: '新增',
  upgrade: '洗版',
  skip: '跳过',
  error: '失败',
};

export function OrganizePage() {
  const [form, setForm] = useState<OrganizerSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    void api.get<{ settings: Settings }>('/api/settings').then((data) => {
      setForm({ ...EMPTY, ...(data.settings.organizer ?? {}), categories: data.settings.organizer?.categories ?? [] });
    }).catch((error) => toast.error(error instanceof Error ? error.message : '读取整理设置失败'))
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof OrganizerSettings>(key: K, value: OrganizerSettings[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const updateCategory = (id: string, patch: Partial<OrganizeCategory>) => {
    update('categories', form.categories.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const addCategory = () => {
    update('categories', [...form.categories, {
      id: `cat_${Date.now().toString(36)}`,
      name: '新分类',
      mediaType: 'movie',
      genres: [],
      countries: [],
      languages: [],
      keywords: [],
    }]);
  };

  const save = async () => {
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
      const result = await api.post<{ executed: number; failed: number; skipped: number }>('/api/organize/execute', { batchId: batch.id });
      toast.success(`整理完成：执行 ${result.executed}，跳过 ${result.skipped}，失败 ${result.failed}`);
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
          <h1>整理</h1>
          <p>本地下载目录 → TMDb 识别 → 二级分类 → 洗版 → 媒体库。</p>
        </div>
        <div className="page-head-actions">
          <Button variant="ghost" onClick={() => void save().catch(() => undefined)} loading={saving} icon={<WandSparkles size={16} />}>保存设置</Button>
          <Button variant="primary" onClick={() => void scan()} loading={scanning} icon={<ScanLine size={16} />}>扫描预览</Button>
        </div>
      </header>

      <div className="panel">
        <div className="panel-head"><div><h2>整理设置</h2><p>源目录和目标目录都在容器内，需要在 compose 中挂载。</p></div></div>
        <div className="form-grid two-col">
          <Field label="导入目录" hint="例如挂载 ./import:/import"><Input value={form.importDir} onChange={(event) => update('importDir', event.target.value)} placeholder="/import" /></Field>
          <Field label="媒体库目录" hint="例如挂载 ./media:/media"><Input value={form.libraryDir} onChange={(event) => update('libraryDir', event.target.value)} placeholder="/media" /></Field>
          <Field label="入库方式"><Select value={form.mode} onChange={(event) => update('mode', event.target.value as OrganizerSettings['mode'])}><option value="move">移动</option><option value="copy">复制</option><option value="hardlink">硬链接</option></Select></Field>
          <Field label="洗版策略"><Select value={form.upgradeStrategy} onChange={(event) => update('upgradeStrategy', event.target.value as OrganizerSettings['upgradeStrategy'])}><option value="off">关闭：已存在就跳过</option><option value="better">仅当新版本画质更好</option><option value="always">总是替换</option></Select></Field>
          <Field label="TMDb API Key" hint="在 TMDb 设置中申请 API Key；只保存在 /config/settings.json"><Input type="password" value={form.tmdbApiKey} onChange={(event) => update('tmdbApiKey', event.target.value)} placeholder="TMDb API Key" autoComplete="off" /></Field>
          <Field label="TMDb 语言"><Input value={form.tmdbLanguage} onChange={(event) => update('tmdbLanguage', event.target.value)} placeholder="zh-CN" /></Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h2>二级分类</h2><p>按 TMDb 类型、国家、语言或文件名关键词匹配；不匹配进入“其他”。</p></div>
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addCategory}>添加分类</Button>
        </div>
        <div className="organize-categories">
          {form.categories.length === 0 ? <p className="empty-note">还没有分类。例如：电影 / 动作 / Action；剧集 / 国产剧 / CN。</p> : null}
          {form.categories.map((category) => (
            <div className="organize-category" key={category.id}>
              <Select value={category.mediaType} onChange={(event) => updateCategory(category.id, { mediaType: event.target.value as 'movie' | 'tv' })}>
                <option value="movie">电影</option><option value="tv">剧集</option>
              </Select>
              <Input value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} placeholder="分类名，如 动作" />
              <Input value={category.genres.join(',')} onChange={(event) => updateCategory(category.id, { genres: event.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="类型：Action,科幻" />
              <Input value={category.countries.join(',')} onChange={(event) => updateCategory(category.id, { countries: event.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="国家：CN,US" />
              <Input value={category.languages.join(',')} onChange={(event) => updateCategory(category.id, { languages: event.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="语言：zh,en" />
              <Input value={category.keywords.join(',')} onChange={(event) => updateCategory(category.id, { keywords: event.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="关键词：剧场版" />
              <button type="button" className="icon-button danger" onClick={() => update('categories', form.categories.filter((item) => item.id !== category.id))} aria-label="删除分类"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h2>扫描结果</h2><p>{batch ? `共 ${batch.items.length} 个视频，执行前请核对洗版和跳过项。` : '先扫描，确认 TMDb 匹配、分类和目标路径。'}</p></div>
          {batch ? <Button variant="primary" onClick={() => void execute()} loading={executing} icon={<FolderInput size={16} />}>执行整理</Button> : null}
        </div>
        {loading ? <p className="empty-note">读取设置中…</p> : null}
        {!batch && !loading ? <p className="empty-note">还没有扫描结果。</p> : null}
        {batch ? (
          <div className="organize-results">
            {batch.items.map((item) => (
              <div className="organize-result" key={item.id}>
                <div className="organize-result-main">
                  <strong>{item.title} {item.year ? `(${item.year})` : ''}</strong>
                  <span>{item.relativePath} <ArrowRight size={12} /> {item.category}</span>
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
    </section>
  );
}
