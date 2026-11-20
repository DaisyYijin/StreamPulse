import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  Copy,
  FileOutput,
  ScrollText,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LogLine, Run } from '../../shared/types';
import { api } from '../api';
import {
  cx,
  formatDuration,
  formatFullDate,
  isTerminal,
  statusMeta,
  triggerLabel,
} from '../utils';
import { Badge, Button, IconButton, Spinner, toast } from './ui';

interface SnapshotEvent {
  type: 'snapshot' | 'status' | 'done';
  run: Run;
}
interface LogEvent {
  type: 'log';
  line: LogLine;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={cx('run-stat', tone)}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function mergeRun(previous: Run | null, incoming: Run): Run {
  return {
    ...incoming,
    logs: incoming.logs.length > 0 ? incoming.logs : previous?.logs ?? [],
  };
}

export function RunDrawer({
  runId,
  open,
  onClose,
}: {
  runId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!open || !runId) return;
    let cancelled = false;
    setRun(null);
    setError('');
    setLoading(true);
    streamRef.current?.close();

    api
      .get<Run>(`/api/runs/${runId}`)
      .then((data) => {
        if (cancelled) return;
        setRun(data);
        setLoading(false);
        if (isTerminal(data.status)) return;
        const stream = new EventSource(`/api/runs/${runId}/events`);
        streamRef.current = stream;
        stream.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data) as SnapshotEvent | LogEvent;
            if (event.type === 'log') {
              setRun((previous) =>
                previous
                  ? { ...previous, logs: [...previous.logs, event.line].slice(-1000) }
                  : previous,
              );
              return;
            }
            const next = event.run;
            setRun((previous) => mergeRun(previous, next));
            if (event.type === 'done' || isTerminal(next.status)) {
              stream.close();
              setLoading(false);
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        };
        stream.onerror = () => {
          setLoading(false);
        };
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : '任务加载失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [open, runId]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!autoScroll || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.logs.length, autoScroll]);

  if (!open) return null;
  const meta = run ? statusMeta(run.status) : null;

  const cancel = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      await api.post(`/api/runs/${run.id}/cancel`);
      toast.info('正在取消任务');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const copyLogs = async () => {
    if (!run) return;
    const text = run.logs
      .map((line) => `${formatFullDate(line.at)} [${line.level.toUpperCase()}] ${line.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('日志已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  return createPortal(
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="run-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="card-kicker">RUN DETAILS</span>
            <h2>{run?.libraryName ?? '任务详情'}</h2>
            {run ? (
              <div className="drawer-sub">
                <span>{formatFullDate(run.startedAt || run.createdAt)}</span>
                <span>·</span>
                <span>{triggerLabel(run.trigger)}触发</span>
                <span>·</span>
                <span>{run.mode === 'full' ? '全量' : '增量'}同步{run.scope ? ` · ${run.scope}` : ''}</span>
              </div>
            ) : null}
          </div>
          <div className="drawer-head-actions">
            {meta ? (
              <Badge tone={meta.tone} live={meta.live}>
                {meta.label}
              </Badge>
            ) : null}
            <IconButton label="关闭" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        </header>

        {loading && !run ? (
          <div className="drawer-loading">
            <Spinner label="正在读取任务…" />
          </div>
        ) : error ? (
          <div className="drawer-loading">
            <AlertCircle size={24} />
            <p>{error}</p>
            <Button size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        ) : run ? (
          <>
            <div className="drawer-body">
              <div className="run-summary">
                <div className="run-summary-top">
                  <div>
                    <span className="card-kicker">MESSAGE</span>
                    <p className="run-message">{run.message}</p>
                  </div>
                  <div className="run-time">
                    <Clock3 size={15} />
                    <strong>{formatDuration(run.startedAt, run.finishedAt)}</strong>
                    <span>{run.finishedAt ? '总耗时' : '已运行'}</span>
                  </div>
                </div>
                {meta?.live ? (
                  <div className="pulse-progress" aria-label="运行中">
                    <span />
                  </div>
                ) : null}
              </div>

              <div className="run-stats">
                <Stat label="扫描文件" value={run.stats.scanned} />
                <Stat label="匹配视频" value={run.stats.matched} />
                <Stat label="生成" value={run.stats.generated} tone="tone-lime" />
                <Stat label="跳过" value={run.stats.skipped} tone="tone-cyan" />
                <Stat label="清理" value={run.stats.deleted} />
                <Stat label="失败" value={run.stats.failed} tone={run.stats.failed ? 'tone-red' : ''} />
              </div>

              <div className="log-panel">
                <div className="log-head">
                  <span>
                    <ScrollText size={15} />
                    运行日志
                    <em>{run.logs.length}</em>
                  </span>
                  <div>
                    <Button variant="ghost" size="sm" icon={<Copy size={13} />} onClick={copyLogs}>
                      复制
                    </Button>
                  </div>
                </div>
                <div
                  className="log-stream"
                  ref={logRef}
                  onScroll={(event) => {
                    const target = event.currentTarget;
                    setAutoScroll(target.scrollHeight - target.scrollTop - target.clientHeight < 40);
                  }}
                >
                  {run.logs.length === 0 ? (
                    <div className="log-empty">等待日志输出…</div>
                  ) : (
                    run.logs.map((line, index) => (
                      <div className={cx('log-line', `log-${line.level}`)} key={`${line.at}-${index}`}>
                        <span className="log-time">
                          {new Date(line.at).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                        <span className="log-level">{line.level}</span>
                        <span className="log-message">{line.message}</span>
                      </div>
                    ))
                  )}
                </div>
                {!autoScroll ? (
                  <button
                    className="log-follow"
                    onClick={() => {
                      setAutoScroll(true);
                      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
                    }}
                  >
                    跟随最新日志
                  </button>
                ) : null}
              </div>
            </div>

            <footer className="drawer-footer">
              <div className="drawer-footer-meta">
                {run.status === 'success' ? (
                  <>
                    <CheckCircle2 size={15} /> 已同步到输出目录
                  </>
                ) : run.stats.failed > 0 ? (
                  <>
                    <AlertCircle size={15} /> 有 {run.stats.failed} 个文件失败
                  </>
                ) : run.status === 'running' ? (
                  <>
                    <FileOutput size={15} /> 正在写入 STRM
                  </>
                ) : (
                  <>
                    <SkipForward size={15} /> 任务已结束
                  </>
                )}
              </div>
              {meta?.live ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Ban size={14} />}
                  onClick={cancel}
                  loading={cancelling}
                >
                  取消任务
                </Button>
              ) : (
                <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={onClose}>
                  关闭
                </Button>
              )}
            </footer>
          </>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
