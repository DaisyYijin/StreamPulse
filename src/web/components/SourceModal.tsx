import { Cloud, Eye, EyeOff, Info, KeyRound, Link2, ServerCog, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Source, SourceInput } from '../../shared/types';
import { api } from '../api';
import { Button, Field, Input, Modal, toast } from './ui';

type AuthMode = 'token' | 'password';

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
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [authType, setAuthType] = useState<AuthMode>('token');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(source?.name ?? '');
    setBaseUrl(source?.baseUrl ?? '');
    setPublicUrl(source?.publicUrl ?? '');
    setAuthType(source?.authType ?? 'token');
    setUsername(source?.username ?? '');
    setToken('');
    setPassword('');
    setShowSecret(false);
    setError('');
  }, [open, source]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const trimmedName = name.trim();
    const trimmedBase = baseUrl.trim();
    if (!trimmedName || !trimmedBase) {
      setError('名称与 API 地址不能为空');
      return;
    }
    if (!source && authType === 'token' && !token.trim()) {
      setError('令牌模式需要填写访问令牌');
      return;
    }
    if (!source && authType === 'password' && (!username.trim() || !password)) {
      setError('账号模式需要填写用户名与密码');
      return;
    }
    setBusy(true);
    try {
      const payload: SourceInput = {
        name: trimmedName,
        baseUrl: trimmedBase,
        publicUrl: publicUrl.trim(),
        authType,
        username: username.trim(),
      };
      if (token.trim()) payload.token = token.trim();
      if (password) payload.password = password;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={source ? '编辑来源' : '连接 OpenList / AList'}
      description="StreamPulse 通过 OpenList API 读取目录，并生成指向直链的 STRM 文件。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} icon={<Link2 size={16} />}>
            {source ? '保存更改' : '保存来源'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="来源名称" hint="用于在媒体库中识别这个存储">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：家庭云盘"
            autoFocus
          />
        </Field>
        <Field label="API 地址" hint="OpenList / AList 的根地址，例如 http://192.168.1.20:5244">
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
        <Field
          label="公开访问地址"
          optional
          hint="仅在 302 解析失败时作为回退，或使用 {sourceUrl} 直连模板时使用。默认 302 模式可留空。"
        >
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
          <button
            type="button"
            className={authType === 'token' ? 'active' : ''}
            onClick={() => setAuthType('token')}
          >
            <KeyRound size={16} />
            访问令牌
            <small>推荐</small>
          </button>
          <button
            type="button"
            className={authType === 'password' ? 'active' : ''}
            onClick={() => setAuthType('password')}
          >
            <UserRound size={16} />
            用户名密码
            <small>自动登录</small>
          </button>
        </div>

        {authType === 'token' ? (
          <Field
            label={source?.hasToken ? '访问令牌（留空保持不变）' : '访问令牌'}
            hint={
              source?.tokenHint
                ? `当前令牌 ${source.tokenHint}。在 OpenList「设置 → 其他」中生成。`
                : '在 OpenList「设置 → 其他」中生成并复制令牌。'
            }
          >
            <div className="input-with-icon">
              <KeyRound size={16} />
              <Input
                type={showSecret ? 'text' : 'password'}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={source?.hasToken ? source.tokenHint ?? '保持现有令牌' : '输入访问令牌'}
                autoComplete="off"
              />
              <button
                type="button"
                className="input-eye"
                onClick={() => setShowSecret((value) => !value)}
                aria-label={showSecret ? '隐藏令牌' : '显示令牌'}
              >
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>
        ) : (
          <>
            <Field label="用户名">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="OpenList 管理员用户名"
                autoComplete="username"
              />
            </Field>
            <Field
              label={source?.hasPassword ? '密码（留空保持不变）' : '密码'}
              hint="密码仅保存在本地数据卷中，不会返回给浏览器。"
            >
              <div className="input-with-icon">
                <KeyRound size={16} />
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={source?.hasPassword ? '保持现有密码' : '输入密码'}
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
        )}

        <div className="form-hint-line">
          <Info size={14} />
          115 或其他网盘请先在 OpenList / AList 中添加存储并生成令牌，再在这里连接 OpenList。
          StreamPulse 保存 OpenList 凭据，不直接保存 115 密码。
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
