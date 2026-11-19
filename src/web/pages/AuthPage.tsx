import { ArrowRight, Check, Eye, EyeOff, KeyRound, Layers3, ShieldCheck, UserRound, Waves } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AuthStatus } from '../../shared/types';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { Button, Input } from '../components/ui';

export function AuthPage({
  auth,
  onAuthenticated,
}: {
  auth: AuthStatus;
  onAuthenticated: () => void;
}) {
  const [username, setUsername] = useState(auth.username || 'admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setup = auth.setupRequired;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (setup && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    if (setup && password.length < 8) {
      setError('密码至少需要 8 个字符');
      return;
    }
    if (!username.trim()) {
      setError('请输入管理员账号');
      return;
    }
    setBusy(true);
    try {
      if (setup) {
        await api.post('/api/auth/setup', { username, password });
      } else {
        await api.post('/api/auth/login', { username, password });
      }
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '请求失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <div className="auth-grid" aria-hidden="true" />
        <div className="auth-orb auth-orb-one" aria-hidden="true" />
        <div className="auth-orb auth-orb-two" aria-hidden="true" />
        <div className="auth-brand">
          <Logo />
          <span className="auth-edition">STRM ENGINE · v{auth.version}</span>
        </div>

        <div className="auth-hero">
          <span className="eyebrow">
            <Waves size={14} />
            CLOUD MEDIA, NATIVE PLAYBACK
          </span>
          <h1>
            让云盘媒体，
            <br />
            <em>像本地一样播放。</em>
          </h1>
          <p>
            StreamPulse 把 OpenList 中的影音文件编织成标准 STRM 媒体库，
            让 Emby 与 Jellyfin 瞬间识别、优雅播放。
          </p>
        </div>

        <div className="auth-wave" aria-hidden="true">
          {[26, 52, 34, 72, 44, 88, 36, 64, 30, 76, 48, 58, 24, 68, 40, 54, 28].map((height, index) => (
            <span key={index} style={{ height: `${height}%`, animationDelay: `${index * 110}ms` }} />
          ))}
        </div>

        <div className="auth-features">
          <div>
            <Layers3 size={17} />
            <span>目录镜像</span>
          </div>
          <div>
            <ShieldCheck size={17} />
            <span>增量同步</span>
          </div>
          <div>
            <Check size={17} />
            <span>Docker 就绪</span>
          </div>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand">
            <Logo />
          </div>
          <div className="auth-form-head">
            <span className="eyebrow">{setup ? 'FIRST RUN SETUP' : 'SECURE ACCESS'}</span>
            <h2>{setup ? '创建管理员账号' : '欢迎回来'}</h2>
            <p>
              {setup
                ? '这是首次启动。设置管理员账号和密码，以后可以在设置中修改。'
                : '输入管理员账号和密码，继续管理你的 STRM 媒体库。'}
            </p>
          </div>

          <form onSubmit={submit} className="auth-form">
            <label className="auth-field">
              <span>{setup ? '管理员账号' : '账号'}</span>
              <div className="input-with-icon auth-username">
                <UserRound size={17} />
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus={setup}
                />
              </div>
            </label>
            <label className="auth-field">
              <span>{setup ? '设置密码' : '密码'}</span>
              <div className="password-input">
                <KeyRound size={17} />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={setup ? '至少 8 个字符' : '输入密码'}
                  autoFocus={!setup}
                  autoComplete={setup ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {setup ? (
              <label className="auth-field">
                <span>确认密码</span>
                <div className="password-input">
                  <KeyRound size={17} />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                  />
                </div>
              </label>
            ) : null}
            {error ? <div className="auth-error">{error}</div> : null}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={busy}
              className="auth-submit"
              icon={<ArrowRight size={17} />}
            >
              {setup ? '创建并进入控制台' : '登录控制台'}
            </Button>
          </form>

          <div className="auth-note">
            {auth.envManaged
              ? '账号和密码由 STREAMPULSE_USERNAME / STREAMPULSE_PASSWORD 环境变量管理。'
              : '账号保存在配置目录中，密码使用 scrypt 加盐散列。'}
          </div>
          <div className="auth-footer">
            <span>StreamPulse</span>
            <span>v{auth.version}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
