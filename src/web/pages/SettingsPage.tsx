import {
  CheckCircle2,
  Database,
  FolderCog,
  FolderPlus,
  LibraryBig,
  Bell,
  Plus,
  Send,
  HardDrive,
  KeyRound,
  Link2,
  Lock,
  RefreshCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AuthStatus, CloudDriveSettings, EmbyLibrary, EmbyServer, GuanyingSettings, HdhiveSettings, NotificationSettings, Settings, SystemInfo } from '../../shared/types';
import { api } from '../api';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Toggle,
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
  const [settingsTab, setSettingsTab] = useState<'runtime' | 'security' | 'integrations'>('runtime');
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [outputDir, setOutputDir] = useState('');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [defaultUrlTemplate, setDefaultUrlTemplate] = useState('');
  const [streamBaseUrl, setStreamBaseUrl] = useState('');
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(2);
  const [runRetention, setRunRetention] = useState(80);
  const [saving, setSaving] = useState(false);
  const [adminUsername, setAdminUsername] = useState('admin');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [embyServers, setEmbyServers] = useState<EmbyServer[]>([]);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    telegramBotToken: '', telegramChatId: '', telegramCommands: false, wecomWebhookUrl: '',
    notifyOnSuccess: false, notifyOnFailure: true, notifyCookieInvalid: true,
  });
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [hdhive, setHdhive] = useState<HdhiveSettings>({ baseUrl: 'https://hdhive.com', apiKey: '', userToken: '' });
  const [guanying, setGuanying] = useState<GuanyingSettings>({ baseUrl: '', cookie: '' });
  const [cloudDrive, setCloudDrive] = useState<CloudDriveSettings>({ webhookToken: '' });
  const [hdhiveBusy, setHdhiveBusy] = useState(false);
  const [embyManageId, setEmbyManageId] = useState('');
  const [embyLibraries, setEmbyLibraries] = useState<EmbyLibrary[]>([]);
  const [embyLibraryBusy, setEmbyLibraryBusy] = useState(false);
  const [embyCreateName, setEmbyCreateName] = useState('');
  const [embyCreateType, setEmbyCreateType] = useState('movies');
  const [embyCreatePath, setEmbyCreatePath] = useState('');

  const load = async () => {
    try {
      const [data, authData] = await Promise.all([
        api.get<{ settings: Settings; system: SystemInfo }>('/api/settings'),
        api.get<AuthStatus>('/api/auth/status'),
      ]);
      setSystem(data.system);
      setAuth(authData);
      setAdminUsername(authData.username);
      setOutputDir(data.settings.outputDir);
      setTimezone(data.settings.timezone);
      setDefaultUrlTemplate(data.settings.defaultUrlTemplate);
      setStreamBaseUrl(data.settings.streamBaseUrl);
      setMaxConcurrentRuns(data.settings.maxConcurrentRuns);
      setRunRetention(data.settings.runRetention);
      setEmbyServers(data.settings.embyServers ?? []);
      setEmbyManageId((current) => current || data.settings.embyServers?.[0]?.id || '');
      setNotifications({ ...notifications, ...(data.settings.notifications ?? {}) });
      if (data.settings.hdhive) setHdhive(data.settings.hdhive);
      if (data.settings.guanying) setGuanying(data.settings.guanying);
      if (data.settings.cloudDrive) setCloudDrive(data.settings.cloudDrive);
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

  const changeAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!adminUsername.trim()) {
      toast.error('管理员账号不能为空');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      toast.error('新密码至少需要 8 个字符');
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await api.post<{ username: string }>('/api/auth/account', {
        currentPassword,
        username: adminUsername.trim(),
        ...(newPassword ? { newPassword } : {}),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setAdminUsername(result.username);
      toast.success(newPassword ? '账号与密码已更新' : '管理员账号已更新');
      window.dispatchEvent(new CustomEvent('sp:auth-changed'));
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '修改失败');
    } finally {
      setPasswordBusy(false);
    }
  };

  const saveIntegrations = async (event: FormEvent) => {
    event.preventDefault();
    setIntegrationBusy(true);
    try {
      await api.patch('/api/settings', { embyServers, notifications, hdhive, guanying, cloudDrive });
      toast.success('Emby 与通知设置已保存');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setIntegrationBusy(false);
    }
  };

  const updateEmby = (id: string, patch: Partial<EmbyServer>) => {
    setEmbyServers((current) => current.map((server) => server.id === id ? { ...server, ...patch } : server));
  };

  const testEmbyServer = async (server: EmbyServer) => {
    try {
      const result = await api.post<{ name: string }>('/api/integrations/emby/test', server);
      toast.success(`Emby 连接成功：${result.name}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Emby 连接失败');
    }
  };

  const selectedEmbyServer = embyServers.find((server) => server.id === embyManageId) ?? embyServers[0];

  const loadEmbyLibraries = async (server: EmbyServer) => {
    setEmbyLibraryBusy(true);
    try {
      const result = await api.post<{ libraries: EmbyLibrary[] }>('/api/integrations/emby/libraries', server);
      setEmbyLibraries(result.libraries);
      toast.success(`读取到 ${result.libraries.length} 个 Emby 媒体库`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '读取 Emby 媒体库失败');
    } finally {
      setEmbyLibraryBusy(false);
    }
  };

  const createEmbyLibrary = async () => {
    if (!selectedEmbyServer) return;
    if (!embyCreateName.trim() || !embyCreatePath.trim()) {
      toast.error('请填写媒体库名称和 Emby 可见目录');
      return;
    }
    setEmbyLibraryBusy(true);
    try {
      const result = await api.post<{ library: EmbyLibrary }>('/api/integrations/emby/libraries/create', {
        server: selectedEmbyServer,
        name: embyCreateName,
        collectionType: embyCreateType,
        paths: [embyCreatePath.trim()],
      });
      toast.success(`已创建 Emby 媒体库：${result.library.name}`);
      setEmbyLibraries((current) => [...current.filter((item) => item.id !== result.library.id), result.library]);
      setEmbyCreateName('');
      setEmbyCreatePath('');
      await loadEmbyLibraries(selectedEmbyServer);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '创建 Emby 媒体库失败');
    } finally {
      setEmbyLibraryBusy(false);
    }
  };

  const addEmbyLibraryToRefresh = (server: EmbyServer, library: EmbyLibrary) => {
    updateEmby(server.id, { libraryIds: Array.from(new Set([...server.libraryIds, library.id])) });
    toast.success(`已加入刷新：${library.name}`);
  };

  const testHdhive = async () => {
    setHdhiveBusy(true);
    try {
      const result = await api.post<{ message: string }>('/api/integrations/hdhive/test', hdhive);
      toast.success(result.message || '影巢 API Key 有效');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '影巢连接失败');
    } finally {
      setHdhiveBusy(false);
    }
  };

  const testNotify = async () => {
    try {
      await api.post('/api/integrations/notify/test');
      toast.success('通知测试已发送');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '通知测试失败');
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

      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button role="tab" className={settingsTab === 'runtime' ? 'active' : ''} onClick={() => setSettingsTab('runtime')}>运行设置</button>
        <button role="tab" className={settingsTab === 'security' ? 'active' : ''} onClick={() => setSettingsTab('security')}>账号与安全</button>
        <button role="tab" className={settingsTab === 'integrations' ? 'active' : ''} onClick={() => setSettingsTab('integrations')}>Emby 与通知</button>
      </div>

      <div className="settings-layout">
        <div className="settings-main">
          {settingsTab === 'runtime' ? (
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
                    placeholder="/strm"
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
          ) : null}

          {settingsTab === 'security' ? (
          <>
          <section className="panel settings-panel">
            <div className="settings-head">
              <span className="settings-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2>管理员账号与安全</h2>
                <p>账号和密码保护所有 API 与控制台访问，可在这里修改。</p>
              </div>
              <Badge tone={auth?.envManaged ? 'accent' : 'success'}>
                {auth?.envManaged ? '环境变量管理' : '本地账号'}
              </Badge>
            </div>
            {auth?.envManaged ? (
              <div className="form-callout">
                <Lock size={19} />
                <div>
                  <strong>账号由环境变量管理</strong>
                  <p>
                    当前实例通过 <code>STREAMPULSE_USERNAME</code> 和
                    <code>STREAMPULSE_PASSWORD</code> 设置管理员账号，界面内无法修改。
                    更新环境变量并重建容器即可生效。
                  </p>
                </div>
              </div>
            ) : (
              <form className="form-grid" onSubmit={changeAccount}>
                <div className="form-grid form-grid-2">
                  <Field label="管理员账号" hint="3–32 位字母、数字、点、下划线或短横线">
                    <Input
                      value={adminUsername}
                      onChange={(event) => setAdminUsername(event.target.value)}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="当前密码" hint="修改账号或密码都需要验证当前密码">
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="新密码" optional hint="留空表示只修改账号，不修改密码">
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="至少 8 个字符"
                    />
                  </Field>
                  <Field label="确认新密码" optional>
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
                    保存账号与密码
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
          </>
          ) : null}

          {settingsTab === 'integrations' ? (
            <form className="panel settings-panel" onSubmit={saveIntegrations}>
              <div className="settings-head">
                <span className="settings-icon"><Server size={18} /></span>
                <div><h2>Emby 与通知</h2><p>同步完成后刷新 Emby 媒体库，并通过 Telegram / 企业微信发送结果。</p></div>
              </div>
              <div className="integration-list">
                {embyServers.map((server) => (
                  <div className="integration-block" key={server.id}>
                    <div className="integration-block-head">
                      <strong>{server.name || '未命名 Emby'}</strong>
                      <div className="integration-actions">
                        <Button type="button" size="sm" variant="ghost" onClick={() => void testEmbyServer(server)}>测试连接</Button>
                        <button type="button" className="icon-button danger" onClick={() => setEmbyServers((current) => current.filter((item) => item.id !== server.id))} aria-label="删除 Emby"><Trash2 size={15} /></button>
                      </div>
                    </div>
                    <div className="form-grid form-grid-2">
                      <Field label="名称"><Input value={server.name} onChange={(event) => updateEmby(server.id, { name: event.target.value })} placeholder="家里 Emby" /></Field>
                      <Field label="Emby 地址"><Input value={server.url} onChange={(event) => updateEmby(server.id, { url: event.target.value })} placeholder="http://192.168.1.10:8096" /></Field>
                      <Field label="API Key"><Input type="password" value={server.apiKey} onChange={(event) => updateEmby(server.id, { apiKey: event.target.value })} autoComplete="off" /></Field>
                      <Field label="媒体库 ID" hint="多个用逗号分隔；在 Emby 媒体库设置中查看"><Input value={server.libraryIds.join(',')} onChange={(event) => updateEmby(server.id, { libraryIds: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="1,2" /></Field>
                    </div>
                    <div className="toggle-row">
                      <div><strong>同步后刷新 Emby</strong><span>任务成功或部分成功时刷新上面填写的媒体库</span></div>
                      <Toggle checked={server.refreshAfterRun} onChange={(value) => updateEmby(server.id, { refreshAfterRun: value })} label="同步后刷新 Emby" />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setEmbyServers((current) => [...current, { id: `emby_${Date.now().toString(36)}`, name: 'Emby', url: '', apiKey: '', libraryIds: [], refreshAfterRun: true }])}>添加 Emby 服务端</Button>
              </div>

              <div className="settings-head compact" style={{ marginTop: 22 }}>
                <span className="settings-icon"><LibraryBig size={18} /></span>
                <div><h2>Emby 媒体库</h2><p>读取 Emby 现有媒体库，或按 Emby 可见目录一键创建。</p></div>
              </div>
              {embyServers.length === 0 ? <p className="settings-hint">先添加一个 Emby 服务端。</p> : (
                <div className="emby-library-panel">
                  <div className="form-grid form-grid-2">
                    <Field label="Emby 服务端">
                      <Select value={embyManageId} onChange={(event) => { setEmbyManageId(event.target.value); setEmbyLibraries([]); }}>
                        {embyServers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="现有媒体库">
                      <Button type="button" variant="secondary" icon={<RefreshCcw size={14} />} loading={embyLibraryBusy} onClick={() => selectedEmbyServer ? void loadEmbyLibraries(selectedEmbyServer) : undefined}>读取媒体库</Button>
                    </Field>
                  </div>
                  {embyLibraries.length > 0 ? (
                    <div className="emby-library-list">
                      {embyLibraries.map((library) => (
                        <div className="emby-library-row" key={library.id}>
                          <div>
                            <strong>{library.name}</strong>
                            <span>{library.collectionType || 'mixed'} · {library.id}</span>
                            <code>{library.locations.join(' · ') || '无路径'}</code>
                          </div>
                          <Button type="button" size="sm" variant="ghost" onClick={() => selectedEmbyServer ? addEmbyLibraryToRefresh(selectedEmbyServer, library) : undefined}>加入刷新</Button>
                        </div>
                      ))}
                    </div>
                  ) : <p className="settings-hint">点击“读取媒体库”查看 Emby 中已有的库。</p>}
                  <div className="form-grid form-grid-3">
                    <Field label="新库名称"><Input value={embyCreateName} onChange={(event) => setEmbyCreateName(event.target.value)} placeholder="电影" /></Field>
                    <Field label="类型">
                      <Select value={embyCreateType} onChange={(event) => setEmbyCreateType(event.target.value)}>
                        <option value="movies">电影</option>
                        <option value="tvshows">电视剧</option>
                        <option value="mixed">混合内容</option>
                        <option value="homevideos">家庭视频</option>
                        <option value="music">音乐</option>
                        <option value="musicvideos">MV</option>
                      </Select>
                    </Field>
                    <Field label="Emby 可见目录" hint="填 Emby 容器/宿主机看到的路径，不是 StreamPulse 的输出路径">
                      <Input value={embyCreatePath} onChange={(event) => setEmbyCreatePath(event.target.value)} placeholder="/mnt/strm/电影" />
                    </Field>
                  </div>
                  <Button type="button" variant="primary" icon={<FolderPlus size={14} />} loading={embyLibraryBusy} onClick={() => void createEmbyLibrary()}>根据目录创建媒体库</Button>
                </div>
              )}

              <div className="settings-head compact" style={{ marginTop: 22 }}>
                <span className="settings-icon"><Server size={18} /></span>
                <div><h2>CloudDrive2 实时事件</h2><p>CD2 Webhook 推送文件变化后，只扫描对应媒体库的受影响目录。</p></div>
              </div>
              <div className="form-grid form-grid-2">
                <Field label="Webhook Token" hint="自己生成一段随机字符串，填到 CD2 Webhook URL 的 token 参数">
                  <Input type="password" value={cloudDrive.webhookToken} onChange={(event) => setCloudDrive({ webhookToken: event.target.value })} autoComplete="off" />
                </Field>
                <Field label="Webhook 地址" hint="复制到 CloudDrive2 的文件变更 Webhook">
                  <Input readOnly value={`${window.location.origin}/api/hooks/clouddrive?token=${cloudDrive.webhookToken || 'YOUR_TOKEN'}`} />
                </Field>
              </div>
              <p className="settings-hint">媒体库的“来源路径”需要与 CD2 推送的虚拟路径一致，才能匹配到对应库。</p>

              <div className="settings-head compact" style={{ marginTop: 22 }}>
                <span className="settings-icon"><Search size={18} /></span>
                <div><h2>影巢搜索</h2><p>使用影巢 OpenAPI 搜索资源；只搜索，不会自动解锁或消耗积分。</p></div>
              </div>
              <div className="form-grid form-grid-2">
                <Field label="影巢地址"><Input value={hdhive.baseUrl} onChange={(event) => setHdhive((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://hdhive.com" /></Field>
                <Field label="影巢 API Key"><Input type="password" value={hdhive.apiKey} onChange={(event) => setHdhive((current) => ({ ...current, apiKey: event.target.value }))} autoComplete="off" /></Field>
                <Field label="OpenAPI 用户 Token" hint="业务搜索接口需要 Bearer Token"><Input type="password" value={hdhive.userToken} onChange={(event) => setHdhive((current) => ({ ...current, userToken: event.target.value }))} autoComplete="off" /></Field>
                <Field label="测试连接"><Button type="button" variant="secondary" icon={<Search size={14} />} loading={hdhiveBusy} onClick={() => void testHdhive()}>测试影巢 API Key</Button></Field>
                <Field label="观影站点地址" hint="例如 https://www.gying.net；需能访问"><Input value={guanying.baseUrl} onChange={(event) => setGuanying((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://..." /></Field>
                <Field label="观影 Cookie" hint="需要登录时填写浏览器 Cookie；留空尝试匿名访问"><Input type="password" value={guanying.cookie} onChange={(event) => setGuanying((current) => ({ ...current, cookie: event.target.value }))} autoComplete="off" /></Field>
              </div>

              <div className="settings-head compact" style={{ marginTop: 22 }}>
                <span className="settings-icon"><Bell size={18} /></span>
                <div><h2>通知</h2><p>留空的渠道不会发送。</p></div>
              </div>
              <div className="form-grid form-grid-2">
                <Field label="Telegram Bot Token"><Input type="password" value={notifications.telegramBotToken} onChange={(event) => setNotifications((current) => ({ ...current, telegramBotToken: event.target.value }))} autoComplete="off" /></Field>
                <Field label="Telegram Chat ID"><Input value={notifications.telegramChatId} onChange={(event) => setNotifications((current) => ({ ...current, telegramChatId: event.target.value }))} /></Field>
                <Field label="企业微信机器人 Webhook"><Input type="password" value={notifications.wecomWebhookUrl} onChange={(event) => setNotifications((current) => ({ ...current, wecomWebhookUrl: event.target.value }))} autoComplete="off" /></Field>
                <Field label="测试通知"><Button type="button" variant="secondary" icon={<Send size={14} />} onClick={() => void testNotify()}>发送测试消息</Button></Field>
              </div>
              <div className="toggle-list">
                <div className="toggle-row"><div><strong>成功通知</strong><span>任务成功或部分成功时发送</span></div><Toggle checked={notifications.notifyOnSuccess} onChange={(value) => setNotifications((current) => ({ ...current, notifyOnSuccess: value }))} label="成功通知" /></div>
                <div className="toggle-row"><div><strong>失败通知</strong><span>任务失败时发送</span></div><Toggle checked={notifications.notifyOnFailure} onChange={(value) => setNotifications((current) => ({ ...current, notifyOnFailure: value }))} label="失败通知" /></div>
                <div className="toggle-row"><div><strong>Cookie 失效通知</strong><span>115/123 连接测试失败时发送</span></div><Toggle checked={notifications.notifyCookieInvalid} onChange={(value) => setNotifications((current) => ({ ...current, notifyCookieInvalid: value }))} label="Cookie 失效通知" /></div>
                <div className="toggle-row"><div><strong>Telegram 命令机器人</strong><span>允许配置的 Chat ID 发送 /status /libraries /run /full /runs /cancel /login /help</span></div><Toggle checked={notifications.telegramCommands} onChange={(value) => setNotifications((current) => ({ ...current, telegramCommands: value }))} label="Telegram 命令机器人" /></div>
              </div>
              <div className="settings-actions"><Button type="submit" variant="primary" icon={<Send size={16} />} loading={integrationBusy}>保存集成设置</Button></div>
            </form>
          ) : null}
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
                <span>配置目录</span>
                <code>{system?.configDir ?? '—'}</code>
              </div>
              <div>
                <span>状态目录</span>
                <code>{system?.stateDir ?? '—'}</code>
              </div>
              <div>
                <span>输出目录</span>
                <code>{system?.outputDir ?? '—'}</code>
              </div>
              <div>
                <span>日志目录</span>
                <code>{system?.logDir ?? '—'}</code>
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
            <div className={`system-health ${system?.outputWritable && system?.logWritable ? 'ok' : 'bad'}`}>
              {system?.outputWritable && system?.logWritable ? <CheckCircle2 size={15} /> : <Database size={15} />}
              {system?.outputWritable && system?.logWritable
                ? 'STRM 与日志目录可写'
                : 'STRM 或日志目录不可写'}
            </div>
          </section>

          <section className="panel storage-panel">
            <div className="settings-head compact">
              <span className="settings-icon">
                <KeyRound size={18} />
              </span>
              <div>
                <h2>凭据存储</h2>
              </div>
            </div>
            <p className="deploy-copy">
              管理员账号、每个来源、每个媒体库、每个任务都拆成独立文件，权限均为 600。
              配置与运行状态分目录存放，均不会写入 STRM 或应用日志。
            </p>
            <div className="code-block">
              <span>{system?.accountsDir ?? '/config/accounts'}/&lt;username&gt;.json</span>
              <span>{system?.credentialsDir ?? '/config/sources'}/&lt;source-id&gt;.json</span>
              <span>{system?.librariesDir ?? '/config/libraries'}/&lt;library-id&gt;.json</span>
              <span>{system?.configDir ?? '/config'}/settings.json</span>
            </div>
            <p className="deploy-copy">
              运行状态放在状态目录：
            </p>
            <div className="code-block">
              <span>{system?.runsDir ?? '/data/runs'}/&lt;run-id&gt;.json</span>
              <span>{system?.stateDir ?? '/data'}/manifests/&lt;library-id&gt;.json</span>
            </div>
            <p className="deploy-copy">
              115 使用浏览器 Cookie，123 使用账号密码；两者均直连，不经过 OpenList。
              每个来源账号单独一个文件，权限 0600。
            </p>
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
            <p className="deploy-copy">配置、状态、STRM 与日志分别保存在挂载卷中，升级镜像不会丢失数据。</p>
            <div className="code-block">
              <span>docker compose pull</span>
              <span>docker compose up -d</span>
            </div>
            <div className="deploy-meta">
              <span>
                <Database size={13} /> /config
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
            <span>v{system?.version ?? '1.29.2'}</span>
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
