import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  FolderOpen,
  HardDrive,
  Layers3,
  Link2,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  DEFAULT_EXTENSIONS,
  SCHEDULE_PRESETS,
  URL_TEMPLATE_VARIABLES,
  type Library,
  type LibraryInput,
  type Source,
} from '../../shared/types';
import { api } from '../api';
import { DirectoryPicker } from './DirectoryPicker';
import { Button, Field, Input, Modal, Select, Textarea, Toggle, toast } from './ui';

export function LibraryModal({
  open,
  library,
  sources,
  defaultUrlTemplate,
  defaultStreamBaseUrl,
  outputDir,
  onClose,
  onSaved,
  onGoSources,
}: {
  open: boolean;
  library: Library | null;
  sources: Source[];
  defaultUrlTemplate: string;
  defaultStreamBaseUrl: string;
  outputDir: string;
  onClose: () => void;
  onSaved: (library: Library) => void;
  onGoSources: () => void;
}) {
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [sourcePath, setSourcePath] = useState('/');
  const [targetPath, setTargetPath] = useState('');
  const [urlTemplate, setUrlTemplate] = useState(defaultUrlTemplate);
  const [streamBaseUrl, setStreamBaseUrl] = useState(defaultStreamBaseUrl);
  const [extensions, setExtensions] = useState(DEFAULT_EXTENSIONS.join(', '));
  const [excludePatterns, setExcludePatterns] = useState('');
  const [minSizeMB, setMinSizeMB] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [incremental, setIncremental] = useState(true);
  const [deleteOrphans, setDeleteOrphans] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [watchInterval, setWatchInterval] = useState(0);
  const [downloadSidecars, setDownloadSidecars] = useState(true);
  const [eventWatch, setEventWatch] = useState(false);
  const [customSchedule, setCustomSchedule] = useState('0 3 * * *');
  const [scheduleCustom, setScheduleCustom] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(library?.name ?? '');
    setSourceId(library?.sourceId ?? sources[0]?.id ?? '');
    setSourcePath(library?.sourcePath ?? '/');
    setTargetPath(library?.targetPath ?? '');
    setUrlTemplate(library?.urlTemplate ?? defaultUrlTemplate);
    setStreamBaseUrl(library?.streamBaseUrl || defaultStreamBaseUrl);
    setExtensions((library?.extensions ?? DEFAULT_EXTENSIONS).join(', '));
    setExcludePatterns((library?.excludePatterns ?? []).join('\n'));
    setMinSizeMB(String(library?.minSizeMB ?? 0));
    setEnabled(library?.enabled ?? true);
    setIncremental(library?.incremental ?? true);
    setDeleteOrphans(library?.deleteOrphans ?? false);
    const known = SCHEDULE_PRESETS.some((preset) => preset.value === library?.schedule);
    setSchedule(known || !library?.schedule ? library?.schedule ?? '' : '');
    setWatchInterval(library?.watchInterval ?? 0);
    setDownloadSidecars(library?.downloadSidecars ?? true);
    setEventWatch(library?.eventWatch ?? false);
    setCustomSchedule(library?.schedule || '0 3 * * *');
    setScheduleCustom(Boolean(library?.schedule && !known));
    setError('');
    setPickerOpen(false);
  }, [open, library, sources, defaultUrlTemplate, defaultStreamBaseUrl]);

  const selectedSource = sources.find((source) => source.id === sourceId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('请填写媒体库名称');
      return;
    }
    if (!sourceId) {
      setError('请选择一个来源');
      return;
    }
    if (!targetPath.trim()) {
      setError('请填写输出目录');
      return;
    }
    if (!/^https?:\/\//.test(streamBaseUrl.trim())) {
      setError('请填写 STRM 生成地址，例如 http://192.168.1.10:2048');
      return;
    }
    if (!urlTemplate.includes('{encodedPath}') && !urlTemplate.includes('{path}')) {
      setError('URL 模板必须包含 {encodedPath} 或 {path}');
      return;
    }
    const effectiveSchedule = scheduleCustom ? customSchedule.trim() : schedule;
    if (enabled && effectiveSchedule && effectiveSchedule.split(/\s+/).length < 5) {
      setError('Cron 表达式需要 5 个字段，例如 0 3 * * *');
      return;
    }
    const parsedExtensions = extensions
      .split(/[,;\s]+/)
      .map((value) => value.trim().replace(/^\.+/, '').toLowerCase())
      .filter(Boolean);
    if (parsedExtensions.length === 0) {
      setError('至少填写一种视频扩展名');
      return;
    }
    setBusy(true);
    try {
      const payload: LibraryInput = {
        name: name.trim(),
        sourceId,
        sourcePath: sourcePath.trim() || '/',
        targetPath: targetPath.trim(),
        urlTemplate: urlTemplate.trim(),
        streamBaseUrl: streamBaseUrl.trim(),
        extensions: parsedExtensions,
        excludePatterns: excludePatterns
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        minSizeMB: Number(minSizeMB) || 0,
        enabled,
        incremental,
        deleteOrphans,
        schedule: effectiveSchedule,
        watchInterval,
        downloadSidecars,
        eventWatch,
      };
      const saved = library
        ? await api.patch<Library>(`/api/libraries/${library.id}`, payload)
        : await api.post<Library>('/api/libraries', payload);
      toast.success(library ? '媒体库已更新' : '媒体库已创建');
      onSaved(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  if (sources.length === 0) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="创建媒体库"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              稍后
            </Button>
            <Button variant="primary" onClick={onGoSources} icon={<Sparkles size={16} />}>
              去连接来源
            </Button>
          </>
        }
      >
        <div className="form-callout">
          <AlertTriangle size={20} />
          <div>
            <strong>还没有连接来源</strong>
            <p>媒体库需要一个 OpenList / AList 来源作为目录索引。先完成连接，再回来创建媒体库。</p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={library ? '编辑媒体库' : '创建媒体库'}
        description="把来源目录镜像为 STRM 媒体库；目录结构会原样保留。"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" onClick={submit} loading={busy} icon={<ArrowRight size={16} />}>
              {library ? '保存更改' : '创建媒体库'}
            </Button>
          </>
        }
      >
        <form className="library-form" onSubmit={submit}>
          <div className="form-section">
            <div className="form-section-head">
              <span className="form-step">01</span>
              <div>
                <h3>基础信息</h3>
                <p>这个媒体库在播放器中对应的内容。</p>
              </div>
            </div>
            <div className="form-grid form-grid-2">
              <Field label="媒体库名称">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：电影 · 4K"
                  autoFocus
                />
              </Field>
              <Field label="来源">
                <Select
                  value={sourceId}
                  onChange={(event) => {
                    setSourceId(event.target.value);
                    setSourcePath('/');
                  }}
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} · {source.baseUrl}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="form-grid form-grid-2">
              <Field label="来源目录" hint="从来源中选择媒体所在的文件夹">
                <div className="path-input">
                  <span>
                    <HardDrive size={15} />
                  </span>
                  <Input
                    value={sourcePath}
                    onChange={(event) => setSourcePath(event.target.value)}
                    placeholder="/Movies"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<FolderOpen size={14} />}
                    onClick={() => setPickerOpen(true)}
                    disabled={!sourceId}
                  >
                    浏览
                  </Button>
                </div>
              </Field>
              <Field
                label="输出目录"
                hint={`相对于输出根目录 · ${outputDir}/${targetPath.trim() || '...'}`}
              >
                <div className="input-with-icon">
                  <Layers3 size={16} />
                  <Input
                    value={targetPath}
                    onChange={(event) => setTargetPath(event.target.value)}
                    placeholder="Movies/4K"
                  />
                </div>
              </Field>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="form-step">02</span>
              <div>
                <h3>STRM 链接</h3>
                <p>默认使用 302 服务：Emby 请求 2048 端口，再跳转到网盘直链。</p>
              </div>
            </div>
            <Field
              label="STRM 生成地址"
              hint="Emby 实际访问的 302 地址，必须填写，例如 http://192.168.1.10:2048"
            >
              <div className="input-with-icon">
                <Link2 size={16} />
                <Input
                  value={streamBaseUrl}
                  onChange={(event) => setStreamBaseUrl(event.target.value)}
                  placeholder="http://192.168.1.10:2048"
                  spellCheck={false}
                />
              </div>
            </Field>
            <Field
              label="URL 模板"
              hint="点击变量可追加到模板末尾。默认走 StreamPulse 的 302 跳转。"
            >
              <div className="template-input">
                <Link2 size={16} />
                <Input
                  value={urlTemplate}
                  onChange={(event) => setUrlTemplate(event.target.value)}
                  className="mono-input"
                  spellCheck={false}
                />
              </div>
            </Field>
            <div className="template-vars">
              {URL_TEMPLATE_VARIABLES.map((variable) => (
                <button
                  key={variable.token}
                  type="button"
                  className="template-var"
                  title={variable.description}
                  onClick={() => setUrlTemplate((value) => `${value}${variable.token}`)}
                >
                  {variable.token}
                  <span>{variable.label}</span>
                </button>
              ))}
            </div>
            {selectedSource && !selectedSource.publicUrl && urlTemplate.includes('{sourceUrl}') ? (
              <div className="form-hint-line">
                <AlertTriangle size={14} />
                当前模板使用 <code>{'{sourceUrl}'}</code> 直连，但此来源没有公开访问地址，播放器可能无法访问。
              </div>
            ) : null}
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="form-step">03</span>
              <div>
                <h3>扫描与同步</h3>
                <p>过滤文件、安排自动同步，并决定是否清理失效条目。</p>
              </div>
            </div>
            <div className="form-grid form-grid-2">
              <Field label="视频扩展名" hint="逗号分隔，不带点">
                <Input
                  value={extensions}
                  onChange={(event) => setExtensions(event.target.value)}
                  placeholder="mkv, mp4, iso"
                />
              </Field>
              <Field label="最小文件大小 (MB)" hint="0 表示不限制，用于过滤样片与花絮">
                <Input
                  type="number"
                  min={0}
                  value={minSizeMB}
                  onChange={(event) => setMinSizeMB(event.target.value)}
                />
              </Field>
            </div>
            <Field label="排除规则" optional hint="每行一个 glob，例如 **/Samples/**、*.trailer.mkv">
              <Textarea
                value={excludePatterns}
                onChange={(event) => setExcludePatterns(event.target.value)}
                rows={3}
                placeholder={'**/Sample/**\n**/Trailers/**\n*.nfo'}
                spellCheck={false}
              />
            </Field>

            <div className="schedule-row">
              <div className="schedule-label">
                <Clock3 size={17} />
                <div>
                  <strong>自动同步</strong>
                  <span>使用 Cron 表达式，留空则仅手动运行</span>
                </div>
              </div>
              <div className="schedule-control">
                <Select
                  value={scheduleCustom ? 'custom' : schedule}
                  onChange={(event) => {
                    if (event.target.value === 'custom') {
                      setScheduleCustom(true);
                    } else {
                      setScheduleCustom(false);
                      setSchedule(event.target.value);
                    }
                  }}
                >
                  <option value="">仅手动运行</option>
                  {SCHEDULE_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">自定义 Cron</option>
                </Select>
                {scheduleCustom ? (
                  <Input
                    value={customSchedule}
                    onChange={(event) => setCustomSchedule(event.target.value)}
                    className="mono-input"
                    placeholder="0 3 * * *"
                    spellCheck={false}
                  />
                ) : null}
              </div>
            </div>

            <div className="schedule-row">
              <div className="schedule-label">
                <Clock3 size={17} />
                <div>
                  <strong>实时同步</strong>
                  <span>按分钟轮询来源，适合小目录；大目录建议使用 Cron</span>
                </div>
              </div>
              <div className="schedule-control">
                <Select
                  value={String(watchInterval)}
                  onChange={(event) => setWatchInterval(Number(event.target.value))}
                >
                  <option value="0">关闭</option>
                  <option value="1">每 1 分钟</option>
                  <option value="5">每 5 分钟</option>
                  <option value="15">每 15 分钟</option>
                  <option value="30">每 30 分钟</option>
                  <option value="60">每 60 分钟</option>
                </Select>
              </div>
            </div>

            <div className="toggle-list">
              <div className="toggle-row">
                <div>
                  <strong>启用媒体库</strong>
                  <span>关闭后不会出现在自动同步中，但仍可手动运行</span>
                </div>
                <Toggle checked={enabled} onChange={setEnabled} label="启用媒体库" />
              </div>
              <div className="toggle-row">
                <div>
                  <strong>增量同步</strong>
                  <span>文件大小、修改时间与链接未变化时跳过写入</span>
                </div>
                <Toggle checked={incremental} onChange={setIncremental} label="增量同步" />
              </div>
              {selectedSource?.type === '115' ? (
                <div className="toggle-row">
                  <div>
                    <strong>115 生活事件增量</strong>
                    <span>只在 115 最近记录有变化时触发增量，仍需先完成一次全量同步</span>
                  </div>
                  <Toggle checked={eventWatch} onChange={setEventWatch} label="115 生活事件增量" />
                </div>
              ) : null}
              <div className="toggle-row">
                <div>
                  <strong>下载附属文件</strong>
                  <span>把同目录字幕、NFO、图片下载到 STRM 旁边（单文件最大 30MB）</span>
                </div>
                <Toggle checked={downloadSidecars} onChange={setDownloadSidecars} label="下载附属文件" />
              </div>
              <div className="toggle-row">
                <div>
                  <strong>清理失效条目</strong>
                  <span>删除由 StreamPulse 记录、但源文件已消失的 .strm</span>
                </div>
                <Toggle checked={deleteOrphans} onChange={setDeleteOrphans} label="清理失效条目" />
              </div>
            </div>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" hidden />
        </form>
      </Modal>

      <DirectoryPicker
        open={pickerOpen}
        sourceId={sourceId}
        sourceName={selectedSource?.name ?? ''}
        initialPath={sourcePath}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setSourcePath(path);
          setPickerOpen(false);
          if (!targetPath) {
            setTargetPath(path.split('/').filter(Boolean).slice(-1)[0] ?? '');
          }
        }}
      />
    </>
  );
}
