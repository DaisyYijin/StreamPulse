import {
  ArrowRight,
  CalendarClock,
  Eye,
  FolderTree,
  Layers3,
  LibraryBig,
  Pencil,
  Play,
  RefreshCcw,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_URL_TEMPLATE } from '../../shared/types';
import type { Library, PreviewResult, Run, Settings, Source } from '../../shared/types';
import { api } from '../api';
import { LibraryModal } from '../components/LibraryModal';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Skeleton,
  toast,
} from '../components/ui';
import {
  cx,
  formatBytes,
  formatDateTime,
  scheduleLabel,
  statusMeta,
  timeAgo,
} from '../utils';

export function LibrariesPage({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Library | null>(null);
  const [deleting, setDeleting] = useState<Library | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [runningId, setRunningId] = useState('');
  const [previewTarget, setPreviewTarget] = useState<Library | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const load = async (quiet = false) => {
    try {
      const [libraryList, sourceList, settingsData] = await Promise.all([
        api.get<Library[]>('/api/libraries'),
        api.get<Source[]>('/api/sources'),
        api.get<{ settings: Settings }>('/api/settings'),
      ]);
      setLibraries(libraryList);
      setSources(sourceList);
      setSettings(settingsData.settings);
      setError('');
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!libraries) return [];
    const normalized = query.trim().toLowerCase();
    return libraries.filter((library) => {
      if (filter === 'enabled' && !library.enabled) return false;
      if (filter === 'paused' && library.enabled) return false;
      if (!normalized) return true;
      return (
        library.name.toLowerCase().includes(normalized) ||
        library.sourceName.toLowerCase().includes(normalized) ||
        library.sourcePath.toLowerCase().includes(normalized) ||
        library.targetPath.toLowerCase().includes(normalized)
      );
    });
  }, [libraries, query, filter]);

  const runLibrary = async (library: Library, full = false) => {
    setRunningId(library.id);
    try {
      const run = await api.post<Run>(
        `/api/libraries/${library.id}/run`,
        full ? { mode: 'full' } : undefined,
      );
      toast.success(`「${library.name}」已开始同步`);
      onOpenRun(run.id);
      window.setTimeout(() => void load(true), 1200);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '启动失败');
    } finally {
      setRunningId('');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/api/libraries/${deleting.id}`);
      toast.success('媒体库已删除，已生成的 STRM 文件保留在输出目录');
      setDeleting(null);
      await load(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setDeleteBusy(false);
    }
  };

  const openPreview = async (library: Library) => {
    setPreviewTarget(library);
    setPreview(null);
    setPreviewError('');
    setPreviewLoading(true);
    try {
      setPreview(await api.post<PreviewResult>(`/api/libraries/${library.id}/preview`));
    } catch (caught) {
      setPreviewError(caught instanceof Error ? caught.message : '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Layers3 size={14} />
            LIBRARY MIRRORS
          </span>
          <h1>媒体库</h1>
          <p>为来源目录建立镜像，把视频文件转译成播放器可识别的 STRM。</p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            创建媒体库
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented">
          {[
            { id: 'all', label: '全部', count: libraries?.length ?? 0 },
            {
              id: 'enabled',
              label: '已启用',
              count: libraries?.filter((library) => library.enabled).length ?? 0,
            },
            {
              id: 'paused',
              label: '已停用',
              count: libraries?.filter((library) => !library.enabled).length ?? 0,
            },
          ].map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? 'active' : ''}
              onClick={() => setFilter(item.id as typeof filter)}
            >
              {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={16} />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索媒体库、来源或路径"
          />
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {!libraries ? (
        <div className="library-grid">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton className="skeleton-library" key={item} />
          ))}
        </div>
      ) : libraries.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<LibraryBig size={28} />}
            title="还没有媒体库"
            description="从 OpenList / AList 的一个目录开始，StreamPulse 会为每个视频生成一条 STRM 条目。"
            action={
              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                创建第一个媒体库
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Search size={26} />}
            title="没有匹配的媒体库"
            description="尝试更换搜索关键词或筛选条件。"
            compact
          />
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((library) => {
            const meta = library.lastRunStatus ? statusMeta(library.lastRunStatus) : null;
            const busy = runningId === library.id;
            return (
              <article className={cx('library-card', !library.enabled && 'library-paused')} key={library.id}>
                <div className="library-card-head">
                  <span className="library-avatar">
                    <LibraryBig size={19} />
                  </span>
                  <div className="library-title">
                    <h3>{library.name}</h3>
                    <p>
                      {library.sourceName}
                      <span>·</span>
                      {library.enabled ? '自动同步已开启' : '已暂停'}
                    </p>
                  </div>
                  <div className="library-badges">
                    {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
                    {!library.enabled ? <Badge tone="neutral">停用</Badge> : null}
                  </div>
                </div>

                <div className="library-paths">
                  <div>
                    <span>来源</span>
                    <code title={library.sourcePath}>{library.sourcePath}</code>
                  </div>
                  <ArrowRight size={14} />
                  <div>
                    <span>输出</span>
                    <code title={library.targetPath}>{library.targetPath}</code>
                  </div>
                </div>

                <div className="library-metrics">
                  <div>
                    <strong>{library.fileCount}</strong>
                    <span>STRM 文件</span>
                  </div>
                  <div>
                    <strong>
                      {library.watchInterval > 0
                        ? `实时 ${library.watchInterval} 分钟`
                        : library.schedule
                          ? scheduleLabel(library.schedule)
                          : '手动'}
                    </strong>
                    <span>同步计划</span>
                  </div>
                  <div>
                    <strong>{timeAgo(library.lastRunAt)}</strong>
                    <span>最后同步</span>
                  </div>
                </div>

                <div className="library-last-run">
                  <CalendarClock size={14} />
                  {library.nextRunAt ? (
                    <span>
                      下次 <b>{formatDateTime(library.nextRunAt)}</b>
                    </span>
                  ) : (
                    <span>未安排自动同步</span>
                  )}
                  <span className="library-run-count">{library.totalRuns} 次运行</span>
                </div>

                <div className="library-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={14} />}
                    loading={busy}
                    onClick={() => void runLibrary(library)}
                  >
                    立即同步
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCcw size={14} />}
                    loading={busy}
                    onClick={() => void runLibrary(library, true)}
                  >
                    全量
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Eye size={14} />}
                    onClick={() => void openPreview(library)}
                  >
                    预览
                  </Button>
                  <div className="library-actions-right">
                    <IconButton
                      label="编辑媒体库"
                      onClick={() => {
                        setEditing(library);
                        setModalOpen(true);
                      }}
                    >
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      label="删除媒体库"
                      className="danger-hover"
                      onClick={() => setDeleting(library)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {libraries && libraries.length > 0 ? (
        <div className="page-note">
          <Zap size={14} />
          <span>增量同步会比对文件大小、修改时间与链接，未变化的文件不会重复写入。</span>
        </div>
      ) : null}

      <LibraryModal
        open={modalOpen}
        library={editing}
        sources={sources}
        defaultUrlTemplate={settings?.defaultUrlTemplate ?? DEFAULT_URL_TEMPLATE}
        defaultStreamBaseUrl={settings?.streamBaseUrl ?? ''}
        outputDir={settings?.outputDir ?? '/strm'}
        onClose={() => setModalOpen(false)}
        onSaved={(saved) => {
          setLibraries((current) => {
            if (!current) return [saved];
            const exists = current.some((library) => library.id === saved.id);
            return exists
              ? current.map((library) => (library.id === saved.id ? saved : library))
              : [saved, ...current];
          });
          void load(true);
        }}
        onGoSources={() => {
          setModalOpen(false);
          window.location.hash = '#/sources';
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除媒体库？"
        description={
          <>
            将停止「{deleting?.name}」的自动同步并清除其清单记录。
            <strong> 已生成的 STRM 文件会保留在输出目录</strong>，不会被自动删除。
          </>
        }
        loading={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />

      <Modal
        open={Boolean(previewTarget)}
        onClose={() => setPreviewTarget(null)}
        title={previewTarget ? `预览 · ${previewTarget.name}` : '预览'}
        description="试运行扫描并计算 STRM 路径，不会写入任何文件。"
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setPreviewTarget(null)}>
            关闭
          </Button>
        }
      >
        {previewLoading ? (
          <div className="preview-loading">
            <div className="scan-loader">
              <span />
              <span />
              <span />
            </div>
            <p>正在遍历来源目录，较大的媒体库可能需要一些时间…</p>
          </div>
        ) : previewError ? (
          <div className="error-banner">{previewError}</div>
        ) : preview ? (
          <div className="preview">
            <div className="preview-stats">
              <div>
                <strong>{preview.totalMatched}</strong>
                <span>匹配视频</span>
              </div>
              <div>
                <strong>{preview.scanned}</strong>
                <span>扫描文件</span>
              </div>
              <div>
                <strong>{Object.keys(preview.extensions).length}</strong>
                <span>文件类型</span>
              </div>
            </div>
            <div className="preview-types">
              {Object.entries(preview.extensions).map(([extension, count]) => (
                <span key={extension}>
                  .{extension} <b>{count}</b>
                </span>
              ))}
            </div>
            {preview.samples.length === 0 ? (
              <EmptyState
                icon={<FolderTree size={24} />}
                title="没有匹配的视频"
                description="检查来源目录、扩展名过滤与排除规则。"
                compact
              />
            ) : (
              <div className="preview-table">
                <div className="preview-table-head">
                  <span>源文件</span>
                  <span>STRM 输出</span>
                  <span>大小</span>
                </div>
                {preview.samples.map((sample) => (
                  <div className="preview-row" key={sample.sourcePath}>
                    <div>
                      <strong>{sample.sourcePath.split('/').pop()}</strong>
                      <code>{sample.sourcePath}</code>
                    </div>
                    <code>{sample.strmPath}</code>
                    <span>{formatBytes(sample.size)}</span>
                  </div>
                ))}
              </div>
            )}
            {preview.truncated ? (
              <p className="preview-note">仅展示前 20 个条目，实际运行会生成全部 {preview.totalMatched} 个。</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
