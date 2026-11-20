import { Cloud, Eye, EyeOff, Info, KeyRound, Link2, QrCode, ServerCog, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Source, SourceInput, SourceType } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Modal, Select, toast } from './ui';

type AuthMode = 'token' | 'password' | 'cookie';
type LoginMode = 'credential' | 'qr';

interface QrSessionView {
  id: string;
  provider: '115' | '123';
  device: 'web' | 'android' | 'ios' | 'tv' | 'wechatmini' | 'alipaymini';
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
  message: string;
  qrDataUrl: string;
  expiresAt: string;
}

const PROVIDERS: Array<{ value: SourceType; label: string; hint: string }> = [
  { value: '115', label: '115 网盘', hint: '浏览器 Cookie' },
  { value: '123', label: '123 云盘', hint: '账号 + 密码' },
  { value: 'openlist', label: 'OpenList', hint: 'API + Token' },
];

export function SourceModal({
  open,
  source,
  onClose,
  onSaved,
}: {
  open: boolean;
  source: Source | null;
  onClose: () => void;
  onSaved: (source: Source) => void;
}) {
  const [type, setType] = useState<SourceType>('openlist');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [authType, setAuthType] = useState<AuthMode>('token');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [cookie, setCookie] = useState('');
  const [loginMode, setLoginMode] = useState<LoginMode>('credential');
  const [qrDevice, setQrDevice] = useState<'web' | 'android' | 'ios' | 'tv' | 'wechatmini' | 'alipaymini'>('wechatmini');
  const [qr, setQr] = useState<QrSessionView | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const qrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setType(source?.type ?? 'openlist');
    setName(source?.name ?? '');
    setBaseUrl(source?.baseUrl ?? '');
    setPublicUrl(source?.publicUrl ?? '');
    setAuthType(source?.authType ?? 'token');
    setUsername(source?.username ?? '');
    setToken('');
    setPassword('');
    setCookie('');
    setLoginMode('credential');
    setQrDevice('wechatmini');
    setQr(null);
    clearQrTimer();
    setShowSecret(false);
    setError('');
  }, [open, source]);

  useEffect(() => {
    if (!open) clearQrTimer();
    return () => clearQrTimer();
  }, [open]);

  const clearQrTimer = () => {
    if (qrTimer.current) {
      clearTimeout(qrTimer.current);
      qrTimer.current = null;
    }
  };

  const chooseType = (next: SourceType) => {
    setType(next);
    setError('');
    clearQrTimer();
    setQr(null);
    setLoginMode('credential');
    if (next === '115') setAuthType('cookie');
    if (next === '123') setAuthType('password');
    if (next === 'openlist' && authType === 'cookie') setAuthType('token');
  };

  const qrMode = loginMode === 'qr' && (type === '115' || type === '123');

  const pollQr = async (id: string) => {
    try {
      const result = await api.get<QrSessionView | Source>(`/api/sources/qr/${id}`);
      if (!result || !('status' in result)) {
        const saved = result as Source;
        toast.success('扫码登录成功');
        onSaved(saved);
        onClose();
        return;
      }
      setQr(result);
      if (result.status === 'expired' || result.status === 'error') return;
      qrTimer.current = setTimeout(() => void pollQr(id), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '扫码登录失败');
    }
  };

  const startQr = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请先填写账号名称');
      return;
    }
    clearQrTimer();
    setQrBusy(true);
    setError('');
    try {
      const session = await api.post<QrSessionView>('/api/sources/qr/start', {
        provider: type,
        device: type === '115' ? qrDevice : 'web',
        name: trimmedName,
        sourceId: source?.id,
      });
      setQr(session);
      void pollQr(session.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '二维码生成失败');
    } finally {
      setQrBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (qrMode) {
      await startQr();
      return;
    }
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('来源名称不能为空');
      return;
    }
    if (type === 'openlist' && !baseUrl.trim()) {
      setError('OpenList API 地址不能为空');
      return;
    }
    if (type === '115' && !source && !cookie.trim()) {
      setError('115 需要填写浏览器 Cookie');
      return;
    }
    if (type === '123' && (!username.trim() || (!source && !password))) {
      setError('123 云盘需要填写账号和密码');
      return;
    }
    if (type === 'openlist' && !source && authType === 'token' && !token.trim()) {
      setError('令牌模式需要填写访问令牌');
      return;
    }
    if (type === 'openlist' && !source && authType === 'password' && (!username.trim() || !password)) {
      setError('账号模式需要填写用户名与密码');
      return;
    }
    setBusy(true);
    try {
      const payload: SourceInput = {
        name: trimmedName,
        type,
        baseUrl: type === 'openlist' ? baseUrl.trim() : '',
        publicUrl: type === 'openlist' ? publicUrl.trim() : '',
        authType: type === '115' ? 'cookie' : type === '123' ? 'password' : authType,
        username: username.trim(),
      };
      if (token.trim()) payload.token = token.trim();
      if (password) payload.password = password;
      const cookieList = cookie.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
      if (cookieList.length) {
        payload.cookie = cookieList[0];
        payload.cookies = cookieList;
      }
      const saved = source
        ? await api.patch<Source>(`/api/sources/${source.id}`, payload)
        : await api.post<Source>('/api/sources', payload);
      toast.success(source ? '来源已更新' : '来源已连接');
      onSaved(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const provider = PROVIDERS.find((item) => item.value === type)!;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={source ? '编辑存储账号' : '添加存储账号'}
      description="一个账号一个文件。115 和 123 直接登录，不经过 OpenList。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          {qrMode ? (
            <Button variant="primary" onClick={startQr} loading={qrBusy} icon={<QrCode size={16} />}>
              {qr ? '刷新二维码' : '生成二维码'}
            </Button>
          ) : (
            <Button variant="primary" onClick={submit} loading={busy} icon={<Link2 size={16} />}>
              {source ? '保存更改' : '保存账号'}
            </Button>
          )}
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="auth-mode source-provider-tabs">
          {PROVIDERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={type === item.value ? 'active' : ''}
              onClick={() => chooseType(item.value)}
            >
              <Cloud size={16} />
              {item.label}
              <small>{item.hint}</small>
            </button>
          ))}
        </div>

        <Field label="账号名称" hint="用于在媒体库中识别这个存储">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={provider.label === '115 网盘' ? '例如：115 主账号' : '例如：家庭云盘'}
            autoFocus
          />
        </Field>

        {type !== 'openlist' ? (
          <div className="auth-mode source-login-switch">
            <button
              type="button"
              className={!qrMode ? 'active' : ''}
              onClick={() => {
                setLoginMode('credential');
                clearQrTimer();
                setQr(null);
              }}
            >
              <KeyRound size={16} />
              {type === '115' ? 'Cookie 登录' : '账号密码'}
            </button>
            <button
              type="button"
              className={qrMode ? 'active' : ''}
              onClick={() => {
                setLoginMode('qr');
                setError('');
              }}
            >
              <QrCode size={16} />
              扫码登录
            </button>
          </div>
        ) : null}

        {qrMode ? (
          <div className="qr-login">
            <div className="qr-image-wrap">
              {qr ? (
                <img className="qr-image" src={qr.qrDataUrl} alt="登录二维码" />
              ) : (
                <div className="qr-placeholder">
                  <QrCode size={42} />
                  <span>生成二维码后扫码</span>
                </div>
              )}
            </div>
            {type === '115' ? (
              <div className="qr-device">
                <span>登录设备</span>
                <Select
                  value={qrDevice}
                  onChange={(event) => setQrDevice(event.target.value as typeof qrDevice)}
                >
                  <option value="wechatmini">微信小程序（推荐）</option>
                  <option value="alipaymini">支付宝小程序</option>
                  <option value="android">115 Android App</option>
                  <option value="ios">115 iOS App</option>
                  <option value="web">Web / 网页端</option>
                  <option value="tv">TV 端</option>
                </Select>
              </div>
            ) : null}
            <div className={`qr-status ${qr?.status ?? ''}`}>
              {qr?.message || (type === '115' ? '用 115 App 扫码，支持选择登录设备' : '用 123 App 或微信扫码')}
            </div>
            {qr && (qr.status === 'waiting' || qr.status === 'scanned') ? (
              <div className="qr-hint">二维码有效期约 5 分钟，扫码后请在手机上确认。</div>
            ) : null}
            {qr && (qr.status === 'expired' || qr.status === 'error') ? (
              <Button variant="secondary" size="sm" onClick={startQr} loading={qrBusy} icon={<QrCode size={14} />}>
                重新生成
              </Button>
            ) : null}
          </div>
        ) : null}

        {type === '115' && !qrMode ? (
          <Field
            label={source?.hasCookie ? '115 Cookie（留空保持不变）' : '115 Cookie'}
            hint="从浏览器登录 115 后复制 Cookie；多个备用 Cookie 用空行分隔。至少包含 UID、CID、SEID、KID。"
          >
            <textarea
              className="input source-cookie"
              rows={5}
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              placeholder={source?.hasCookie ? `保持现有 Cookie（已保存 ${source.cookieCount} 个）` : 'UID=...; CID=...; SEID=...; KID=...'}
              autoComplete="off"
            />
          </Field>
        ) : null}

        {type === '123' && !qrMode ? (
          <>
            <Field label="123 云盘账号" hint="手机号、用户名或邮箱">
              <div className="input-with-icon">
                <UserRound size={16} />
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="手机号 / 邮箱"
                  autoComplete="username"
                />
              </div>
            </Field>
            <Field
              label={source?.hasPassword ? '123 密码（留空保持不变）' : '123 密码'}
              hint="密码只保存在本地账号文件，不会返回给浏览器。"
            >
              <div className="input-with-icon">
                <KeyRound size={16} />
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={source?.hasPassword ? '保持现有密码' : '输入 123 云盘密码'}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="input-eye"
                  onClick={() => setShowSecret((value) => !value)}
                  aria-label={showSecret ? '隐藏密码' : '显示密码'}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </>
        ) : null}

        {type === 'openlist' ? (
          <>
            <Field label="API 地址" hint="OpenList / AList 根地址，例如 http://192.168.1.20:5244">
              <div className="input-with-icon">
                <ServerCog size={16} />
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:5244"
                  inputMode="url"
                />
              </div>
            </Field>
            <Field label="公开访问地址" optional hint="默认 302 模式可留空；仅在回退或 {sourceUrl} 模板时使用。">
              <div className="input-with-icon">
                <Cloud size={16} />
                <Input
                  value={publicUrl}
                  onChange={(event) => setPublicUrl(event.target.value)}
                  placeholder="https://cloud.example.com"
                  inputMode="url"
                />
              </div>
            </Field>
            <div className="auth-mode">
              <button type="button" className={authType === 'token' ? 'active' : ''} onClick={() => setAuthType('token')}>
                <KeyRound size={16} />
                访问令牌
                <small>推荐</small>
              </button>
              <button type="button" className={authType === 'password' ? 'active' : ''} onClick={() => setAuthType('password')}>
                <UserRound size={16} />
                用户名密码
                <small>自动登录</small>
              </button>
            </div>
            {authType === 'token' ? (
              <Field
                label={source?.hasToken ? '访问令牌（留空保持不变）' : '访问令牌'}
                hint={source?.tokenHint ? `当前令牌 ${source.tokenHint}` : '在 OpenList「设置 → 其他」中生成。'}
              >
                <div className="input-with-icon">
                  <KeyRound size={16} />
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={source?.hasToken ? '保持现有令牌' : '输入访问令牌'}
                    autoComplete="off"
                  />
                  <button type="button" className="input-eye" onClick={() => setShowSecret((value) => !value)} aria-label="显示或隐藏令牌">
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
            ) : (
              <>
                <Field label="用户名">
                  <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="OpenList 管理员用户名" autoComplete="username" />
                </Field>
                <Field label={source?.hasPassword ? '密码（留空保持不变）' : '密码'}>
                  <div className="input-with-icon">
                    <KeyRound size={16} />
                    <Input
                      type={showSecret ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={source?.hasPassword ? '保持现有密码' : '输入密码'}
                      autoComplete="new-password"
                    />
                    <button type="button" className="input-eye" onClick={() => setShowSecret((value) => !value)} aria-label="显示或隐藏密码">
                      {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
              </>
            )}
          </>
        ) : null}

        <div className="form-hint-line">
          <Info size={14} />
          {qrMode
            ? type === '115'
              ? '扫码后在手机上确认；默认微信小程序，也可选支付宝小程序、115 App、Web 或 TV。二维码约 5 分钟有效。'
              : '用 123 App 或微信扫码，确认后自动保存登录令牌。二维码约 5 分钟有效。'
            : type === '115'
              ? '115 使用 Cookie 登录；Cookie 过期后需要重新复制。不会经过 OpenList。'
              : type === '123'
                ? '123 云盘使用账号密码登录并自动获取访问令牌；不经过 OpenList。'
                : 'OpenList / AList 通过 API 访问；如果已有 115/123 直连账号，请切换到对应类型。'}
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
