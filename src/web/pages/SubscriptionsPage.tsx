import { BookmarkPlus, RefreshCcw, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Settings, Subscription, SubscriptionSettings } from '../../shared/types';
import { api } from '../api';
import { Badge, Button, Field, Input, Toggle, toast } from '../components/ui';

const EMPTY: SubscriptionSettings = {
  doubanUserId: '',
  doubanCookie: '',
  doubanRssUrl: '',
  autoSync: false,
  intervalHours: 6,
};

export function SubscriptionsPage() {
  const [settings, setSettings] = useState<SubscriptionSettings>(EMPTY);
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    try {
      const [settingsPayload, subscriptions] = await Promise.all([
        api.get<{ settings: Settings }>('/api/settings'),
        api.get<Subscription[]>('/api/subscriptions'),
      ]);
      setSettings({ ...EMPTY, ...(settingsPayload.settings.subscriptions ?? {}) });
      setItems(subscriptions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取订阅失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch('/api/settings', { subscriptions: settings });
      toast.success('订阅设置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await api.patch('/api/settings', { subscriptions: settings });
      const result = await api.post<{ added: number; total: number; items: Subscription[] }>('/api/subscriptions/sync');
      setItems(result.items);
      toast.success(`豆瓣想看同步完成：新增 ${result.added}，共 ${result.total}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (item: Subscription) => {
    try {
      await api.delete(`/api/subscriptions/${item.id}`);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      toast.success('已删除订阅');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">SUBSCRIPTIONS</span>
          <h1>豆瓣订阅</h1>
          <p>读取豆瓣“想看”，后续搜索资源、转存、整理并生成 STRM。</p>
        </div>
        <div className="page-head-actions">
          <Button variant="primary" icon={<RefreshCcw size={15} />} loading={syncing} onClick={() => void sync()}>同步豆瓣想看</Button>
        </div>
      </header>

      <form className="panel" onSubmit={save}>
        <div className="settings-head">
          <span className="settings-icon"><BookmarkPlus size={18} /></span>
          <div><h2>豆瓣账号</h2><p>优先公开用户主页；私密列表再填 Cookie，或直接用 RSSHub。</p></div>
        </div>
        <div className="form-grid form-grid-2">
          <Field label="豆瓣用户 ID" hint="例如 https://movie.douban.com/people/12345678/wish 里的 12345678">
            <Input value={settings.doubanUserId} onChange={(event) => setSettings((current) => ({ ...current, doubanUserId: event.target.value }))} />
          </Field>
          <Field label="RSSHub 地址（可选）" hint="填了 RSSHub 就优先使用它">
            <Input value={settings.doubanRssUrl} onChange={(event) => setSettings((current) => ({ ...current, doubanRssUrl: event.target.value }))} placeholder="https://rsshub.example.com/douban/people/xxx/wish" />
          </Field>
          <Field label="豆瓣 Cookie（私密列表才需要）">
            <Input type="password" value={settings.doubanCookie} onChange={(event) => setSettings((current) => ({ ...current, doubanCookie: event.target.value }))} autoComplete="off" />
          </Field>
          <Field label="自动同步间隔（小时）">
            <Input type="number" min={1} max={168} value={settings.intervalHours} onChange={(event) => setSettings((current) => ({ ...current, intervalHours: Number(event.target.value) || 6 }))} />
          </Field>
        </div>
        <div className="toggle-row">
          <div><strong>自动同步豆瓣想看</strong><span>按间隔读取并加入订阅列表；搜索/转存后续执行</span></div>
          <Toggle checked={settings.autoSync} onChange={(value) => setSettings((current) => ({ ...current, autoSync: value }))} label="自动同步豆瓣想看" />
        </div>
        <div className="settings-actions"><Button type="submit" variant="secondary" loading={saving}>保存订阅设置</Button></div>
      </form>

      <div className="panel">
        <div className="panel-head"><div><h2>订阅列表</h2><p>{loading ? '读取中…' : `共 ${items.length} 条`}；搜索与自动入库在下一阶段执行。</p></div></div>
        {items.length === 0 ? <p className="settings-hint">还没有订阅。填写豆瓣用户 ID 后点击“同步豆瓣想看”。</p> : (
          <div className="subscription-list">
            {items.map((item) => (
              <div className="subscription-row" key={item.id}>
                <div>
                  <strong>{item.title}{item.year ? ` (${item.year})` : ''}</strong>
                  <span>{item.mediaType === 'movie' ? '电影' : '剧集'} · TMDb {item.tmdbId ?? '未匹配'} · {item.message}</span>
                </div>
                <div className="subscription-actions">
                  <Badge tone={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'neutral'}>{item.status}</Badge>
                  <button type="button" className="icon-button danger" onClick={() => void remove(item)} aria-label="删除订阅"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
