import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AuthStatus } from '../shared/types';
import { api } from './api';
import { Layout, type Route } from './components/Layout';
import { LogoMark } from './components/Logo';
import { RunDrawer } from './components/RunDrawer';
import { Button, ToastViewport, toast } from './components/ui';
import { ActivityPage } from './pages/ActivityPage';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { LibrariesPage } from './pages/LibrariesPage';
import { OrganizePage } from './pages/OrganizePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogsPage } from './pages/LogsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SourcesPage } from './pages/SourcesPage';

const ROUTES: Route[] = ['dashboard', 'libraries', 'sources', 'organize', 'search', 'subscriptions', 'activity', 'logs', 'settings'];

function currentRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES.includes(raw as Route) ? raw : 'dashboard') as Route;
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash-logo">
        <LogoMark size={58} />
      </div>
      <div className="splash-wave" aria-hidden="true">
        {[18, 32, 24, 40, 28, 48, 22, 36, 26, 44, 20].map((height, index) => (
          <span key={index} style={{ height, animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
      <strong>StreamPulse</strong>
      <span>正在唤醒 STRM 引擎…</span>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState('');
  const [route, setRoute] = useState<Route>(currentRoute);
  const [runId, setRunId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadAuth = useCallback(async () => {
    try {
      const data = await api.get<AuthStatus>('/api/auth/status');
      setAuth(data);
      setAuthError('');
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : '无法连接服务器');
    }
  }, []);

  useEffect(() => {
    void loadAuth();
    const onHash = () => setRoute(currentRoute());
    const onUnauthorized = () => {
      setAuth((previous) => (previous ? { ...previous, authenticated: false } : previous));
      void loadAuth();
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('sp:unauthorized', onUnauthorized);
    window.addEventListener('sp:auth-changed', loadAuth);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('sp:unauthorized', onUnauthorized);
      window.removeEventListener('sp:auth-changed', loadAuth);
    };
  }, [loadAuth]);

  const navigate = useCallback((next: Route) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [route]);

  const openRun = useCallback((id: string) => {
    setRunId(id);
    setDrawerOpen(true);
  }, []);

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setAuth((previous) => (previous ? { ...previous, authenticated: false } : previous));
      setDrawerOpen(false);
    }
  };

  const syncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await api.post<{ started: number; skipped: number }>('/api/libraries/run-all');
      if (result.started > 0) {
        toast.success(`已启动 ${result.started} 个同步任务${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`);
        navigate('activity');
      } else {
        toast.info(result.skipped > 0 ? '没有可启动的任务（可能正在运行或已停用）' : '还没有可同步的媒体库');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '启动失败');
    } finally {
      setSyncing(false);
    }
  };

  if (authError && !auth) {
    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <AlertTriangle size={30} />
          <h1>无法连接 StreamPulse</h1>
          <p>{authError}</p>
          <Button variant="primary" icon={<RotateCcw size={16} />} onClick={() => void loadAuth()}>
            重试连接
          </Button>
        </div>
        <ToastViewport />
      </div>
    );
  }

  if (!auth) return <Splash />;
  if (!auth.authenticated) {
    return <AuthPage auth={auth} onAuthenticated={() => void loadAuth()} />;
  }

  return (
    <>
      <Layout
        route={route}
        onNavigate={navigate}
        auth={auth}
        onLogout={() => void logout()}
        onSyncAll={() => void syncAll()}
        syncing={syncing}
      >
        {route === 'dashboard' ? (
          <DashboardPage onNavigate={navigate} onOpenRun={openRun} />
        ) : route === 'libraries' ? (
          <LibrariesPage onOpenRun={openRun} />
        ) : route === 'sources' ? (
          <SourcesPage />
        ) : route === 'organize' ? (
          <OrganizePage />
        ) : route === 'search' ? (
          <SearchPage />
        ) : route === 'subscriptions' ? (
          <SubscriptionsPage />
        ) : route === 'activity' ? (
          <ActivityPage onOpenRun={openRun} />
        ) : route === 'logs' ? (
          <LogsPage />
        ) : (
          <SettingsPage />
        )}
      </Layout>
      <RunDrawer runId={runId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
