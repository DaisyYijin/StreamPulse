import {
  Activity,
  Ban,
  Clock3,
  Eye,
  ListFilter,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Run, RunStatus } from '../../shared/types';
import { api } from '../api';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  toast,
} from '../components/ui';
import {
  cx,
  formatDateTime,
  formatDuration,
  statusMeta,
  triggerLabel,
} from '../utils';

const FILTERS: Array<{ id: 'all' | RunStatus; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'success', label: '成功' },
  { id: 'partial', label: '部分完成' },
  { id: 'failed', label: '失败' },
];

export function ActivityPage({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [filter, setFilter] = useState<'all' | RunStatus>('all');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cancelling, setCancelling] = useState('');

  const load = async (quiet = false) => {
    try {
      const data = await api.get<Run[]>('/api/runs?limit=200');
      setRuns(data);
      setError('');
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    if (!runs) return [];
    if (filter === 'all') return runs;
    return runs.filter((run) => run.status === filter);
  }, [runs, filter]);

  const counts = useMemo(() => {
    const source = runs ?? [];
    return {
      all: source.length,
      running: source.filter((run) => run.status === 'running' || run.status === 'queued').length,
      success: source.filter((run) => run.status === 'success').length,
      partial: source.filter((run) => run.status === 'partial').length,
      failed: source.filter((run) => run.status === 'failed').length,
    } as Record<string, number>;
  }, [runs]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    window.setTimeout(() => setRefreshing(false), 350);
  };

  const cancelRun = async (run: Run) => {
    setCancelling(run.id);
    try {
      await api.post(`/api/runs/${run.id}/cancel`);
      toast.info('正在取消任务');
      await load(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '取消失败');
    } finally {
      setCancelling('');
    }
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      await api.delete('/api/runs');
      toast.success('历史记录已清理，正在运行的任务已保留');
      setClearOpen(false);
      await load(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '清理失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Activity size={14} />
            RUN HISTORY
          </span>
          <h1>运行记录</h1>
          <p>每一次脉冲的扫描、生成与异常，都完整记录在这里。</p>
        </div>
        <div className="page-actions">
          <Button
            variant="ghost"
            icon={<Trash2 size={15} />}
            onClick={() => setClearOpen(true)}
            disabled={!runs || runs.length === 0}
          >
            清理历史
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw size={15} className={refreshing ? 'spin' : undefined} />}
            onClick={() => void refresh()}
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? 'active' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>
                {item.id === 'running'
                  ? counts.running
                  : item.id === 'all'
                    ? counts.all
                    : counts[item.id] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="activity-live-note">
          <span className={cx('live-dot', counts.running === 0 && 'dot-idle')} />
          {counts.running > 0 ? `${counts.running} 个任务进行中` : '暂无运行中的任务'}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="panel table-panel">
        {!runs ? (
          <div className="table-loading">
            {[0, 1, 2, 3, 4].map((item) => (
              <Skeleton className="skeleton-row" key={item} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ListFilter size={26} />}
            title={filter === 'all' ? '还没有运行记录' : '这个状态下没有任务'}
            description={
              filter === 'all'
                ? '在媒体库页面点击「立即同步」，第一次运行记录就会出现在这里。'
                : '切换到其他状态，或等待下一次自动同步。'
            }
            compact
          />
        ) : (
          <div className="runs-table">
            <div className="runs-table-head">
              <span>状态</span>
              <span>媒体库 / 触发方式</span>
              <span>开始时间</span>
              <span>耗时</span>
              <span>结果</span>
              <span />
            </div>
            {filtered.map((run) => {
              const meta = statusMeta(run.status);
              const active = run.status === 'running' || run.status === 'queued';
              return (
                <div
                  className="runs-table-row"
                  key={run.id}
                  onClick={() => onOpenRun(run.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpenRun(run.id);
                  }}
                >
                  <span>
                    <Badge tone={meta.tone} live={meta.live}>
                      {meta.label}
                    </Badge>
                  </span>
                  <span className="run-library-cell">
                    <strong>{run.libraryName}</strong>
                    <small>
                      {triggerLabel(run.trigger)} · {run.mode === 'full' ? '全量' : '增量'}{run.scope ? ` · ${run.scope}` : ''} · {run.message}
                    </small>
                  </span>
                  <span className="run-time-cell">{formatDateTime(run.startedAt || run.createdAt)}</span>
                  <span className="run-duration-cell">
                    <Clock3 size={13} />
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </span>
                  <span className="run-result-cell">
                    <b className="tone-lime">+{run.stats.generated}</b>
                    <span>生成</span>
                    <b>{run.stats.skipped}</b>
                    <span>跳过</span>
                    {run.stats.failed > 0 ? (
                      <>
                        <b className="tone-red">{run.stats.failed}</b>
                        <span>失败</span>
                      </>
                    ) : null}
                  </span>
                  <span className="run-row-actions">
                    {active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Ban size={13} />}
                        loading={cancelling === run.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void cancelRun(run);
                        }}
                      >
                        取消
                      </Button>
                    ) : (
                      <Eye size={15} />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="page-note">
        <Activity size={14} />
        <span>页面每 5 秒自动刷新；点击任意记录可查看实时日志与完整统计。</span>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="清理运行历史？"
        description="所有已结束的任务记录与日志将被移除，正在运行或排队的任务会保留。"
        confirmLabel="清理历史"
        danger
        loading={clearing}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearHistory()}
      />
    </div>
  );
}
