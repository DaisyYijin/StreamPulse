import {
  Activity,
  ChevronRight,
  Cloud,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  RefreshCw,
  Settings,
  Sun,
  Moon,
  WandSparkles,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AuthStatus } from '../../shared/types';
import { cx } from '../utils';
import { Logo, LogoMark } from './Logo';
import { Button, ToastViewport } from './ui';

export type Route = 'dashboard' | 'libraries' | 'sources' | 'organize' | 'activity' | 'settings';

const NAV_ITEMS: Array<{ id: Route; label: string; icon: ReactNode; eyebrow: string }> = [
  { id: 'dashboard', label: '控制台', icon: <LayoutDashboard size={18} />, eyebrow: 'Overview' },
  { id: 'libraries', label: '媒体库', icon: <LibraryBig size={18} />, eyebrow: 'Libraries' },
  { id: 'sources', label: '来源', icon: <Cloud size={18} />, eyebrow: 'Sources' },
  { id: 'organize', label: '整理', icon: <WandSparkles size={18} />, eyebrow: 'Organize' },
  { id: 'activity', label: '运行记录', icon: <Activity size={18} />, eyebrow: 'Activity' },
  { id: 'settings', label: '设置', icon: <Settings size={18} />, eyebrow: 'Settings' },
];

const PAGE_TITLE: Record<Route, string> = {
  dashboard: '控制台',
  libraries: '媒体库',
  sources: '来源',
  organize: '整理',
  activity: '运行记录',
  settings: '设置',
};

export function Layout({
  route,
  onNavigate,
  auth,
  onLogout,
  onSyncAll,
  syncing,
  children,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  auth: AuthStatus;
  onLogout: () => void;
  onSyncAll: () => void;
  syncing: boolean;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sp-theme', next);
    } catch {
      // Ignore storage failures.
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#080b0a' : '#f3f6f1');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="sidebar-brand" onClick={() => onNavigate('dashboard')} aria-label="回到控制台">
            <Logo />
          </button>
        </div>

        <div className="sidebar-label">工作台</div>
        <nav className="sidebar-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={cx('nav-item', route === item.id && 'nav-item-active')}
              onClick={() => onNavigate(item.id)}
              aria-current={route === item.id ? 'page' : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text">{item.label}</span>
              <span className="nav-eyebrow">{item.eyebrow}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-pulse">
          <div className="pulse-bars" aria-hidden="true">
            {[14, 26, 18, 32, 22, 38, 16, 28, 20, 34, 24].map((height, index) => (
              <span key={index} style={{ height, animationDelay: `${index * 90}ms` }} />
            ))}
          </div>
          <div className="sidebar-pulse-text">
            <span className="live-dot" />
            <strong>STRM 引擎在线</strong>
            <small>等待下一次脉冲</small>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="admin-avatar">
            <LogoMark size={34} />
            <span className="admin-presence" />
          </div>
          <div className="admin-meta">
            <strong>{auth.username || '管理员'}</strong>
            <span>{auth.envManaged ? '环境变量账号' : '本地账号'}</span>
          </div>
          <button className="icon-btn" onClick={onLogout} title="退出登录" aria-label="退出登录">
            <LogOut size={16} />
          </button>
        </div>
        <div className="sidebar-version">StreamPulse v{auth.version}</div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-mobile-brand">
              <LogoMark size={27} />
            </span>
            <div className="topbar-crumb">
              <span>StreamPulse</span>
              <ChevronRight size={13} />
              <strong>{PAGE_TITLE[route]}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? '切换到夜间模式' : '切换到白天模式'}
              title={theme === 'light' ? '夜间模式' : '白天模式'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <span className="topbar-live">
              <span className="live-dot" />
              引擎在线
            </span>
            <Button
              variant="primary"
              size="sm"
              icon={<RefreshCw size={15} className={syncing ? 'spin' : undefined} />}
              loading={syncing}
              onClick={onSyncAll}
            >
              同步全部
            </Button>
            <button
              className="mobile-logout"
              onClick={onLogout}
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="page">{children}</main>
        <nav className="mobile-tabbar" aria-label="移动端导航">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={cx('mobile-tab', route === item.id && 'mobile-tab-active')}
              onClick={() => onNavigate(item.id)}
              aria-current={route === item.id ? 'page' : undefined}
            >
              <span className="mobile-tab-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <ToastViewport />
    </div>
  );
}
