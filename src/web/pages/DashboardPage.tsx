import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Cloud,
  Layers3,
  LibraryBig,
  Plus,
  Radio,
  Sparkles,
  TimerReset,
  TrendingUp,
  Waves,
} from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Overview, Run } from '../../shared/types';
import { api } from '../api';
import { Badge, Button, EmptyState, Skeleton } from '../components/ui';
import type { Route } from '../components/Layout';
import {
  compactNumber,
  cx,
  formatDateTime,
  scheduleLabel,
  statusMeta,
  timeAgo,
  untilTime,
} from '../utils';

function ActivityChart({ data }: { data: Overview['activity'] }) {
  const width = 680;
  const height = 180;
  const paddingX = 8;
  const paddingY = 16;
  const max = Math.max(1, ...data.map((entry) => entry.generated));
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const points = data.map((entry, index) => {
    const x = paddingX + (data.length === 1 ? 0 : (index / (data.length - 1)) * usableWidth);
    const y = paddingY + usableHeight - (entry.generated / max) * usableHeight;
    return { x, y, value: entry.generated, date: entry.date };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `M ${paddingX} ${height - paddingY} L ${points
    .map((point) => `${point.x} ${point.y}`)
    .join(' L ')} L ${width - paddingX} ${height - paddingY} Z`;
  const hasData = data.some((entry) => entry.generated > 0);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="activity-chart" role="img" aria-label="最近 14 天生成趋势">
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9ff57" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#c9ff57" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={paddingX}
            x2={width - paddingX}
            y1={paddingY + usableHeight * (1 - ratio)}
            y2={paddingY + usableHeight * (1 - ratio)}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 7"
          />
        ))}
        {hasData ? <path d={area} fill="url(#chart-fill)" /> : null}
        <polyline
          points={line}
          fill="none"
          stroke="#c9ff57"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={hasData ? 1 : 0.35}
        />
        {points.map((point, index) => (
          <circle
            key={point.date}
            cx={point.x}
            cy={point.y}
            r={index === points.length - 1 ? 4 : 2.2}
            fill={index === points.length - 1 ? '#c9ff57' : '#111918'}
            stroke="#c9ff57"
            strokeWidth="1.6"
            opacity={hasData ? 1 : 0.25}
          >
            <title>{`${point.date} · ${point.value} 个`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis">
        <span>{data[0]?.date.slice(5).replace('-', '/')}</span>
        <span>{data[6]?.date.slice(5).replace('-', '/')}</span>
        <span>今天</span>
      </div>
    </div>
  );
}

function RunRow({ run, onOpen }: { run: Run; onOpen: (id: string) => void }) {
  const meta = statusMeta(run.status);
  return (
    <button className="activity-row" onClick={() => onOpen(run.id)}>
      <span className={cx('run-status-dot', `run-status-${run.status}`)}>
        {meta.live ? <Radio size={13} /> : <CheckCircle2 size={13} />}
      </span>
      <span className="activity-main">
        <strong>{run.libraryName}</strong>
        <small>{timeAgo(run.startedAt || run.createdAt)}</small>
      </span>
      <span className="activity-count">
        +{run.stats.generated}
        <small>STRM</small>
      </span>
      <Badge tone={meta.tone} live={meta.live}>
        {meta.label}
      </Badge>
    </button>
  );
}

export function DashboardPage({
  onNavigate,
  onOpenRun,
}: {
  onNavigate: (route: Route) => void;
  onOpenRun: (runId: string) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = async (quiet = false) => {
    try {
      const data = await api.get<Overview>('/api/overview');
      setOverview(data);
      setError('');
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 8000);
    return () => window.clearInterval(timer);
  }, []);

  if (!overview) {
    return (
      <div className="page-stack">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-hero" />
        <div className="stats-grid">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton className="skeleton-stat" key={item} />
          ))}
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
      </div>
    );
  }

  const last = overview.activity[overview.activity.length - 1];
  const generatedToday = last?.generated ?? 0;
  const active = overview.counts.activeRuns + overview.counts.queuedRuns;
  const nextLibraries = overview.libraries
    .filter((library) => library.nextRunAt)
    .sort((left, right) => String(left.nextRunAt).localeCompare(String(right.nextRunAt)))
    .slice(0, 3);
  const enabledLibraries = overview.libraries.filter((library) => library.enabled).length;

  return (
    <div className="page-stack dashboard">
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Waves size={14} />
            PULSE OVERVIEW
          </span>
          <h1>
            媒体脉冲<span className="accent-dot">·</span> 已就绪
          </h1>
          <p>把云端的每一次变化，同步成 Emby 与 Jellyfin 能读懂的 STRM 媒体库。</p>
        </div>
        <div className="page-actions">
          <Button icon={<Activity size={16} />} onClick={() => onNavigate('activity')}>
            运行记录
          </Button>
          <Button
            variant="primary"
            icon={<LibraryBig size={16} />}
            onClick={() => onNavigate('libraries')}
          >
            管理媒体库
          </Button>
        </div>
      </div>

      {overview.counts.sources === 0 ? (
        <section className="onboarding-card">
          <div className="onboarding-orb">
            <Sparkles size={24} />
          </div>
          <div className="onboarding-copy">
            <span className="eyebrow">GET STARTED</span>
            <h2>三步，让云盘媒体出现在你的播放器里</h2>
            <p>连接 OpenList / AList，选择媒体目录，StreamPulse 会镜像目录并生成标准 .strm 文件。</p>
          </div>
          <div className="onboarding-steps">
            <div>
              <span>01</span>
              <strong>连接来源</strong>
            </div>
            <div>
              <span>02</span>
              <strong>创建媒体库</strong>
            </div>
            <div>
              <span>03</span>
              <strong>扫描生成</strong>
            </div>
          </div>
          <Button variant="primary" onClick={() => onNavigate('sources')} icon={<Plus size={16} />}>
            连接第一个来源
          </Button>
        </section>
      ) : null}

      <section className="hero-grid">
        <div className="hero-card">
          <div className="hero-card-top">
            <span className="card-kicker">TOTAL STRM FILES</span>
            <Badge tone="accent" live={active > 0}>
              {active > 0 ? `${active} 个任务进行中` : '实时同步'}
            </Badge>
          </div>
          <div className="hero-number-row">
            <strong className="hero-number">{compactNumber(overview.counts.files)}</strong>
            <span className="hero-unit">个文件</span>
          </div>
          <p className="hero-caption">
            今日新增 <b>{generatedToday}</b> 个 · 近 7 天生成 <b>{overview.last7d.generated}</b> 个
          </p>
          <ActivityChart data={overview.activity} />
          <div className="hero-footer">
            <span>
              <Layers3 size={14} />
              {overview.counts.libraries} 个媒体库 · {enabledLibraries} 个自动同步
            </span>
            <span className="trend-chip">
              <TrendingUp size={14} />
              {overview.last7d.successRate}% 成功率
            </span>
          </div>
        </div>

        <div className="pulse-side">
          <div className="side-card next-card">
            <div className="card-heading">
              <span className="card-kicker">NEXT PULSE</span>
              <CalendarClock size={18} />
            </div>
            {overview.nextRun ? (
              <>
                <div className="next-time">{untilTime(overview.nextRun.at)}</div>
                <div className="next-library">{overview.nextRun.libraryName}</div>
                <div className="next-date">{formatDateTime(overview.nextRun.at)}</div>
              </>
            ) : (
              <>
                <div className="next-time muted">未安排</div>
                <p className="next-empty">为媒体库设置 Cron 计划，让脉冲自动发生。</p>
              </>
            )}
            <div className="next-list">
              {nextLibraries.length === 0 ? (
                <button className="next-empty-action" onClick={() => onNavigate('libraries')}>
                  <TimerReset size={15} />
                  设置自动同步
                </button>
              ) : (
                nextLibraries.map((library) => (
                  <div className="next-item" key={library.id}>
                    <span className="next-item-dot" />
                    <div>
                      <strong>{library.name}</strong>
                      <small>{scheduleLabel(library.schedule)}</small>
                    </div>
                    <span>{untilTime(library.nextRunAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="side-card health-card">
            <div className="health-ring" style={{ '--value': `${overview.last7d.successRate}%` } as CSSProperties}>
              <strong>{overview.last7d.successRate}%</strong>
              <span>成功率</span>
            </div>
            <div className="health-copy">
              <strong>运行健康</strong>
              <p>最近 7 天 · {overview.last7d.runs} 次任务</p>
              <span>{overview.last7d.failed} 次失败</span>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon stat-icon-lime">
            <LibraryBig size={18} />
          </div>
          <span className="stat-label">媒体库</span>
          <strong className="stat-value">{overview.counts.libraries}</strong>
          <span className="stat-sub">{enabledLibraries} 个启用自动同步</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-cyan">
            <Cloud size={18} />
          </div>
          <span className="stat-label">来源</span>
          <strong className="stat-value">{overview.counts.sources}</strong>
          <span className="stat-sub">OpenList / AList</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-amber">
            <CheckCircle2 size={18} />
          </div>
          <span className="stat-label">近 7 天生成</span>
          <strong className="stat-value">{compactNumber(overview.last7d.generated)}</strong>
          <span className="stat-sub">STRM 文件</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-violet">
            <Radio size={18} />
          </div>
          <span className="stat-label">活跃任务</span>
          <strong className="stat-value">{active}</strong>
          <span className="stat-sub">{overview.counts.queuedRuns} 个排队中</span>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel recent-panel">
          <div className="panel-head">
            <div>
              <span className="card-kicker">RECENT PULSES</span>
              <h2>最近运行</h2>
            </div>
            <button className="text-action" onClick={() => onNavigate('activity')}>
              全部记录
              <ArrowUpRight size={14} />
            </button>
          </div>
          {overview.recentRuns.length === 0 ? (
            <EmptyState
              icon={<Clock3 size={22} />}
              title="还没有运行记录"
              description="第一次同步后，任务进度与日志会出现在这里。"
              compact
            />
          ) : (
            <div className="activity-list">
              {overview.recentRuns.map((run) => (
                <RunRow key={run.id} run={run} onOpen={onOpenRun} />
              ))}
            </div>
          )}
        </div>

        <div className="panel libraries-panel">
          <div className="panel-head">
            <div>
              <span className="card-kicker">LIBRARY STATUS</span>
              <h2>媒体库状态</h2>
            </div>
            <button className="icon-btn" onClick={() => onNavigate('libraries')} aria-label="管理媒体库">
              <ArrowUpRight size={16} />
            </button>
          </div>
          {overview.libraries.length === 0 ? (
            <EmptyState
              icon={<LibraryBig size={22} />}
              title="创建第一个媒体库"
              description="为某个来源目录建立镜像，开始生成 STRM。"
              action={
                <Button size="sm" onClick={() => onNavigate('libraries')}>
                  创建媒体库
                </Button>
              }
              compact
            />
          ) : (
            <div className="mini-library-list">
              {overview.libraries.slice(0, 4).map((library) => {
                const meta = library.lastRunStatus ? statusMeta(library.lastRunStatus) : null;
                return (
                  <button
                    className="mini-library"
                    key={library.id}
                    onClick={() => onNavigate('libraries')}
                  >
                    <span className="mini-library-icon">
                      <LibraryBig size={16} />
                    </span>
                    <span className="mini-library-main">
                      <strong>{library.name}</strong>
                      <small>
                        {library.sourceName} · {library.fileCount} 个文件
                      </small>
                    </span>
                    {meta ? (
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    ) : (
                      <span className="muted-label">未运行</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="panel-foot-note">
            <span className={cx('live-dot', overview.counts.libraries === 0 && 'dot-idle')} />
            {overview.counts.libraries === 0 ? '等待第一个媒体库' : '目录镜像与增量检测已开启'}
          </div>
        </div>
      </section>
      <div className="dashboard-footnote">
        <span>
          <Clock3 size={13} /> 数据每 8 秒刷新
        </span>
        <span>输出目录：{overview.system.outputDir}</span>
        <span>STRM engine ready</span>
      </div>
    </div>
  );
}
