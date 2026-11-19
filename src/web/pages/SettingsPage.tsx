import {
  CheckCircle2,
  Database,
  FolderCog,
  HardDrive,
  KeyRound,
  Link2,
  Lock,
  RefreshCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AuthStatus, Settings, SystemInfo } from '../../shared/types';
import { api } from '../api';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  toast,
} from '../components/ui';
import { uptimeLabel } from '../utils';

const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

export function SettingsPage() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [outputDir, setOutputDir] = useState('');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [defaultUrlTemplate, setDefaultUrlTemplate] = useState('');
  const [streamBaseUrl, setStreamBaseUrl] = useState('');
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(2);
  const [runRetention, setRunRetention] = useState(80);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [data, authData] = await Promise.all([
        api.get<{ settings: Settings; system: SystemInfo }>('/api/settings'),
        api.get<AuthStatus>('/api/auth/status'),
      ]);
      setSystem(data.system);
      setAuth(authData);
      setOutputDir(data.settings.outputDir);
      setTimezone(data.settings.timezone);
      setDefaultUrlTemplate(data.settings.defaultUrlTemplate);
      setStreamBaseUrl(data.settings.streamBaseUrl);
      setMaxConcurrentRuns(data.settings.maxConcurrentRuns);
      setRunRetention(data.settings.runRetention);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const data = await api.patch<{ settings: Settings; system: SystemInfo }>('/api/settings', {
        outputDir,
        timezone,
        defaultUrlTemplate,
        streamBaseUrl,
        maxConcurrentRuns,
        runRetention,
      });
      setSystem(data.system);
      setOutputDir(data.settings.outputDir);
      setTimezone(data.settings.timezone);
      setDefaultUrlTemplate(data.settings.defaultUrlTemplate);
      setStreamBaseUrl(data.settings.streamBaseUrl);
      setMaxConcurrentRuns(data.settings.maxConcurrentRuns);
      setRunRetention(data.settings.runRetention);
      toast.success('设置已保存');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error('新密码至少需要 8 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setPasswordBusy(true);
    try {
      await api.post('/api/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('密码已更新');
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '修改失败');
    } finally {
      setPasswordBusy(false);
    }
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      await api.delete('/api/runs');
      toast.success('运行历史已清理');
      setClearOpen(false);
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
            <SlidersHorizontal size={14} />
            SYSTEM SETTINGS
          </span>
          <h1>设置</h1>
          <p>输出目录、同步调度、安全与运行环境。</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="settings-layout">
        <div className="settings-main">
          <form className="panel settings-panel" onSubmit={saveSettings}>
            <div className="settings-head">
              <span className="settings-icon">
                <FolderCog size={18} />
              </span>
              <div>
                <h2>输出与调度</h2>
                <p>所有媒体库共享的输出根目录与运行限制。</p>
              </div>
            </div>
            <div className="form-grid">
              <Field
                label="STRM 输出根目录"
                hint="必须为绝对路径且容器内可写。媒体库输出目录会拼接在此路径下。"
              >
                <div className="input-with-icon">
                  <HardDrive size={16} />
                  <Input
                    value={outputDir}
                    onChange={(event) => setOutputDir(event.target.value)}
                    placeholder="/data/strm"
                    spellCheck={false}
                  />
                </div>
              </Field>
              <div className="form-grid form-grid-2">
                <Field label="时区" hint="用于 Cron 调度与界面时间显示">
                  <Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                    {!TIMEZONES.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
                    {TIMEZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="最大并发任务" hint="同时运行的媒体库同步数量">
                  <Select
                    value={String(maxConcurrentRuns)}
                    onChange={(event) => setMaxConcurrentRuns(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4].map((value) => (
                      <option key={value} value={value}>
                        {value} 个
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field
                label="302 服务公开地址"
                hint={`Emby 访问的地址，例如 http://192.168.1.10:${system?.streamPort ?? 2048}；留空时会在创建媒体库时按当前访问地址自动推断。`}
              >
                <div className="input-with-icon">
                  <Link2 size={16} />
                  <Input
                    value={streamBaseUrl}
                    onChange={(event) => setStreamBaseUrl(event.target.value)}
                    placeholder={`http://192.168.1.10:${system?.streamPort ?? 2048}`}
                    spellCheck={false}
                  />
                </div>
              </Field>
              <Field label="默认 URL 模板" hint="新建媒体库时使用，可包含 {streamBase}、{streamToken}、{sourceUrl} 等变量">
                <Input
                  value={defaultUrlTemplate}
                  onChange={(event) => setDefaultUrlTemplate(event.target.value)}
                  className="mono-input"
                  spellCheck={false}
                />
              </Field>
              <Field label="运行记录保留数量" hint="超过数量的旧记录会自动清理">
                <Input
                  type="number"
                  min={10}
                  max={500}
                  value={runRetention}
                  onChange={(event) => setRunRetention(Number(event.target.value))}
                />
              </Field>
            </div>
            <div className="settings-actions">
              <Button type="submit" variant="primary" icon={<Save size={16} />} loading={saving}>
                保存设置
              </Button>
            </div>
          </form>

          <section className="panel settings-panel">
            <div className="settings-head">
              <span className="settings-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2>安全</h2>
                <p>管理员密码保护所有 API 与控制台访问。</p>
              </div>
              <Badge tone={auth?.envManaged ? 'accent' : 'success'}>
                {auth?.envManaged ? '环境变量管理' : '本地密码'}
              </Badge>
            </div>
            {auth?.envManaged ? (
              <div className="form-callout">
                <Lock size={19} />
                <div>
                  <strong>密码由环境变量管理</strong>
                  <p>
                    当前实例通过 <code>STREAMPULSE_PASSWORD</code> 设置密码，界面内无法修改。
                    更新环境变量并重启容器即可生效。
                  </p>
                </div>
              </div>
            ) : (
              <form className="form-grid" onSubmit={changePassword}>
                <div className="form-grid form-grid-3">
                  <Field label="当前密码">
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="新密码">
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="至少 8 个字符"
                    />
                  </Field>
                  <Field label="确认新密码">
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                <div className="settings-actions">
                  <Button
                    type="submit"
                    variant="secondary"
                    icon={<KeyRound size={16} />}
                    loading={passwordBusy}
                  >
                    更新密码
                  </Button>
                </div>
              </form>
            )}
          </section>

          <section className="panel settings-panel danger-zone">
            <div className="settings-head">
              <span className="settings-icon danger">
                <Trash2 size={18} />
              </span>
              <div>
                <h2>清理运行历史</h2>
                <p>移除所有已结束任务的日志与统计，不影响媒体库和 STRM 文件。</p>
              </div>
            </div>
            <div className="settings-actions">
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                onClick={() => setClearOpen(true)}
              >
                清理历史
              </Button>
            </div>
          </section>
        </div>

        <aside className="settings-side">
          <section className="panel system-panel">
            <div className="settings-head compact">
              <span className="settings-icon">
                <Server size={18} />
              </span>
              <div>
                <h2>系统信息</h2>
              </div>
            </div>
            <div className="system-list">
              <div>
                <span>版本</span>
                <strong>v{system?.version ?? '—'}</strong>
              </div>
              <div>
                <span>Node.js</span>
                <strong>{system?.nodeVersion ?? '—'}</strong>
              </div>
              <div>
                <span>平台</span>
                <strong>
                  {system ? `${system.platform} / ${system.arch}` : '—'}
                </strong>
              </div>
              <div>
                <span>运行时长</span>
                <strong>{system ? uptimeLabel(system.uptimeSeconds) : '—'}</strong>
              </div>
              <div>
                <span>数据目录</span>
                <code>{system?.dataDir ?? '—'}</code>
              </div>
              <div>
                <span>输出目录</span>
                <code>{system?.outputDir ?? '—'}</code>
              </div>
              <div>
                <span>清单文件</span>
                <strong>{system?.manifestCount ?? 0} 个</strong>
              </div>
              <div>
                <span>302 服务端口</span>
                <strong>{system?.streamPort ?? 2048}</strong>
              </div>
            </div>
            <div className={`system-health ${system?.outputWritable ? 'ok' : 'bad'}`}>
              {system?.outputWritable ? <CheckCircle2 size={15} /> : <Database size={15} />}
              {system?.outputWritable ? '输出目录可写' : '输出目录不可写'}
            </div>
          </section>

          <section className="panel deploy-panel">
            <div className="settings-head compact">
              <span className="settings-icon">
                <Terminal size={18} />
              </span>
              <div>
                <h2>容器部署</h2>
              </div>
            </div>
            <p className="deploy-copy">数据与生成的 STRM 都保存在挂载卷中，升级镜像不会丢失配置。</p>
            <div className="code-block">
              <span>docker compose pull</span>
              <span>docker compose up -d</span>
            </div>
            <div className="deploy-meta">
              <span>
                <Database size={13} /> /data
              </span>
              <span>
                <RefreshCcw size={13} /> 自动重启
              </span>
            </div>
          </section>

          <section className="panel about-panel">
            <img src="/favicon.svg" alt="" width={34} height={34} />
            <div>
              <strong>StreamPulse</strong>
              <p>让云盘媒体像本地一样播放。</p>
            </div>
            <span>v{system?.version ?? '1.1.0'}</span>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="清理运行历史？"
        description="所有已结束的任务记录与日志将被移除，正在运行或排队的任务会保留。"
        confirmLabel="确认清理"
        loading={clearing}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearHistory()}
      />
    </div>
  );
}
