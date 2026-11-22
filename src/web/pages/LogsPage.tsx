import { Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, toast } from '../components/ui';

interface LiveLog {
  id: number;
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

const LEVELS = ['all', 'info', 'warn', 'error'] as const;

export function LogsPage() {
  const [lines, setLines] = useState<LiveLog[]>([]);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all');
  const pausedRef = useRef(paused);
  const bottomRef = useRef<HTMLDivElement>(null);
  pausedRef.current = paused;

  useEffect(() => {
    const source = new EventSource('/api/logs/stream');
    source.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const line = JSON.parse(event.data) as LiveLog;
        setLines((current) => [...current.slice(-499), line]);
      } catch {
        // Ignore malformed events.
      }
    };
    source.onerror = () => {
      // EventSource reconnects automatically; leave the page usable.
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, paused]);

  const filtered = level === 'all' ? lines : lines.filter((line) => line.level === level);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">LIVE LOGS</span>
          <h1>实时日志</h1>
          <p>查看 API 操作、任务、Webhook、整理和搜索记录；不显示密钥。</p>
        </div>
        <div className="page-head-actions">
          <Button variant="ghost" icon={paused ? <Play size={15} /> : <Pause size={15} />} onClick={() => setPaused((value) => !value)}>
            {paused ? '继续' : '暂停'}
          </Button>
          <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => { setLines([]); toast.success('当前视图已清空'); }}>清空</Button>
        </div>
      </header>
      <div className="panel log-panel">
        <div className="log-toolbar">
          <div className="editor-switch">
            {LEVELS.map((value) => (
              <button key={value} type="button" className={level === value ? 'active' : ''} onClick={() => setLevel(value)}>{value === 'all' ? '全部' : value.toUpperCase()}</button>
            ))}
          </div>
          <span>{filtered.length} 条 · {paused ? '已暂停' : '实时接收'}</span>
        </div>
        <div className="live-log-list">
          {filtered.length === 0 ? <p className="settings-hint">等待日志…</p> : filtered.map((line) => (
            <div className={`live-log-line ${line.level}`} key={line.id}>
              <time>{new Date(line.at).toLocaleTimeString('zh-CN', { hour12: false })}</time>
              <span className="live-log-level">{line.level.toUpperCase()}</span>
              <span>{line.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </section>
  );
}
