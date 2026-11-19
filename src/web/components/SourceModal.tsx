import { Cloud, Eye, EyeOff, Info, KeyRound, Link2, ServerCog, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Source, SourceInput, SourceType } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Modal, toast } from './ui';

type AuthMode = 'token' | 'password' | 'cookie';

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
    setShowSecret(false);
    setError('');
  }, [open, source]);

  const chooseType = (next: SourceType) => {
    setType(next);
    setError('');
    if (next === '115') setAuthType('cookie');
    if (next === '123') setAuthType('password');
    if (next === 'openlist' && authType === 'cookie') setAuthType('token');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
      if (cookie.trim()) payload.cookie = cookie.trim();
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
          <Button variant="primary" onClick={submit} loading={busy} icon={<Link2 size={16} />}>
            {source ? '保存更改' : '保存账号'}
          </Button>
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

        {type === '115' ? (
          <Field
            label={source?.hasCookie ? '115 Cookie（留空保持不变）' : '115 Cookie'}
            hint="从浏览器登录 115 后复制 Cookie，至少包含 UID、CID、SEID、KID。"
          >
            <textarea
              className="input source-cookie"
              rows={5}
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              placeholder={source?.hasCookie ? '保持现有 Cookie' : 'UID=...; CID=...; SEID=...; KID=...'}
              autoComplete="off"
            />
          </Field>
        ) : null}

        {type === '123' ? (
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
          {type === '115'
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
