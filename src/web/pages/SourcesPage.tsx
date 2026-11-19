import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  LibraryBig,
  Pencil,
  Plus,
  ServerCog,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Library, Source } from '../../shared/types';
import { api } from '../api';
import { SourceModal } from '../components/SourceModal';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  toast,
} from '../components/ui';
import { timeAgo } from '../utils';

export function SourcesPage() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [testingId, setTestingId] = useState('');
  const [deleting, setDeleting] = useState<Source | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = async (quiet = false) => {
    try {
      const [sourceList, libraryList] = await Promise.all([
        api.get<Source[]>('/api/sources'),
        api.get<Library[]>('/api/libraries'),
      ]);
      setSources(sourceList);
      setLibraries(libraryList);
      setError('');
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const testSource = async (source: Source) => {
    setTestingId(source.id);
    try {
      const result = await api.post<{ message: string; latencyMs: number }>(
        `/api/sources/${source.id}/test`,
      );
      toast.success(`${source.name} · ${result.message}（${result.latencyMs}ms）`);
      await load(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '连接测试失败');
      await load(true);
    } finally {
      setTestingId('');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/api/sources/${deleting.id}`);
      toast.success('来源已删除');
      setDeleting(null);
      await load(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '删除失败');
    } finally {
      setDeleteBusy(false);
    }
  };

  const usageCount = (sourceId: string) =>
    libraries.filter((library) => library.sourceId === sourceId).length;

  return (
    <div className="page-stack">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Cloud size={14} />
            SOURCE CONNECTIONS
          </span>
          <h1>来源</h1>
          <p>统一管理 115、123 和 OpenList 存储账号，每个账号一个文件。</p>
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
            连接来源
          </Button>
        </div>
      </div>

      <div className="source-note">
        <div className="source-note-icon">
          <ServerCog size={20} />
        </div>
        <div>
          <strong>115 / 123 / OpenList</strong>
          <p>
            支持访问令牌或用户名密码登录。默认由 StreamPulse 的 2048 服务解析直链并
            302 跳转，Emby 不需要直接访问云盘；115/123 使用原生登录。
          </p>
        </div>
        <Badge tone="accent">API v3</Badge>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {!sources ? (
        <div className="source-grid">
          {[0, 1].map((item) => (
            <Skeleton className="skeleton-source" key={item} />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Cloud size={28} />}
            title="连接第一个存储来源"
            description="选择 115、123 或 OpenList，填写对应账号凭据。一个账号保存为一个文件。"
            action={
              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                连接来源
              </Button>
            }
          />
        </div>
      ) : (
        <div className="source-grid">
          {sources.map((source) => {
            const used = usageCount(source.id);
            return (
              <article className="source-card" key={source.id}>
                <div className="source-card-head">
                  <span className="source-avatar">
                    <Cloud size={20} />
                  </span>
                  <div className="source-title">
                    <h3>{source.name}</h3>
                    <span className="source-type">{source.type === '115' ? '115 网盘' : source.type === '123' ? '123 云盘' : 'OpenList / AList'}</span>
                  </div>
                  <Badge tone={source.lastCheck?.ok ? 'success' : source.lastCheck ? 'danger' : 'neutral'}>
                    {source.lastCheck ? (source.lastCheck.ok ? '连接正常' : '连接异常') : '未测试'}
                  </Badge>
                </div>

                <div className="source-urls">
                  <div>
                    <span>
                      <ServerCog size={13} /> API
                    </span>
                    <code title={source.baseUrl}>{source.baseUrl}</code>
                  </div>
                  <div>
                    <span>
                      <ExternalLink size={13} /> 公开
                    </span>
                    <code title={source.publicUrl || source.baseUrl}>
                      {source.publicUrl || '与 API 地址相同'}
                    </code>
                  </div>
                </div>

                <div className="source-auth">
                  <span>
                    {source.authType === 'token' ? <KeyRound size={14} /> : <UserRound size={14} />}
                    {source.authType === 'token' ? '访问令牌' : `账号 · ${source.username || '未填写'}`}
                  </span>
                  <span>{source.tokenHint ?? (source.hasPassword ? '密码已保存' : '未配置凭据')}</span>
                </div>

                <div className={`source-status ${source.lastCheck?.ok ? 'ok' : source.lastCheck ? 'bad' : ''}`}>
                  {source.lastCheck?.ok ? <Wifi size={14} /> : source.lastCheck ? <WifiOff size={14} /> : <Wifi size={14} />}
                  <span>
                    {source.lastCheck
                      ? `${source.lastCheck.message} · ${timeAgo(source.lastCheck.at)}`
                      : '保存后建议执行一次连接测试'}
                  </span>
                </div>

                <div className="source-card-foot">
                  <span className="source-usage">
                    <LibraryBig size={14} />
                    {used} 个媒体库正在使用
                  </span>
                  <div className="source-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={testingId === source.id}
                      onClick={() => void testSource(source)}
                      icon={<Wifi size={14} />}
                    >
                      测试
                    </Button>
                    <IconButton
                      label="编辑来源"
                      onClick={() => {
                        setEditing(source);
                        setModalOpen(true);
                      }}
                    >
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      label="删除来源"
                      className="danger-hover"
                      onClick={() => setDeleting(source)}
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

      <div className="security-note">
        <CheckCircle2 size={15} />
        令牌与密码只保存在服务端数据卷中，前端仅显示末尾提示，不会收到明文凭据。
      </div>

      <SourceModal
        open={modalOpen}
        source={editing}
        onClose={() => setModalOpen(false)}
        onSaved={(saved) => {
          setSources((current) => {
            if (!current) return [saved];
            const exists = current.some((source) => source.id === saved.id);
            return exists
              ? current.map((source) => (source.id === saved.id ? saved : source))
              : [saved, ...current];
          });
          void load(true);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除来源？"
        description={
          usageCount(deleting?.id ?? '') > 0 ? (
            <>
              「{deleting?.name}」仍被 {usageCount(deleting?.id ?? '')} 个媒体库使用，请先修改这些媒体库的来源。
            </>
          ) : (
            <>将移除「{deleting?.name}」的账号配置，不会删除云盘中的文件。</>
          )
        }
        loading={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (usageCount(deleting?.id ?? '') > 0) {
            toast.error('仍有媒体库使用该来源');
            return;
          }
          void confirmDelete();
        }}
      />
    </div>
  );
}
