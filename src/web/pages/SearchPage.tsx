import { Copy, ExternalLink, Search, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Input, Select, toast } from '../components/ui';

interface TmdbCandidate {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
}

interface HdhiveResource {
  slug: string;
  title: string;
  matchedTitle: string;
  matchedYear: string;
  panType: string;
  size: string;
  resolutions: string[];
  sources: string[];
  unlockPoints: number;
  isUnlocked: boolean;
  isOfficial: boolean;
  isValid: boolean;
}

interface SearchResult {
  candidates: TmdbCandidate[];
  results: HdhiveResource[];
  warnings: string[];
}

interface ButailingResult {
  title: string;
  size: string;
  quality: string;
  magnet: string;
  detailUrl: string;
}

interface GuanyingResult {
  title: string;
  year: string;
  href: string;
}

interface ChallengeInfo {
  sessionId: string;
  image: string;
  prompt: string;
}

interface AlternativeResult {
  results: Array<ButailingResult | GuanyingResult>;
  warnings: string[];
  challenge?: ChallengeInfo;
}

export function SearchPage() {
  const [keyword, setKeyword] = useState('');
  const [mediaType, setMediaType] = useState<'auto' | 'movie' | 'tv'>('auto');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'hdhive' | 'butailing' | 'guanying' | 'seedhub'>('hdhive');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [alternative, setAlternative] = useState<AlternativeResult | null>(null);
  const [challengeCode, setChallengeCode] = useState('');
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [error, setError] = useState('');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [guanyingBase, setGuanyingBase] = useState('');

  useEffect(() => {
    void api.get<{ settings: { guanying?: { baseUrl?: string } } }>('/api/settings')
      .then((data) => setGuanyingBase(data.settings.guanying?.baseUrl ?? ''))
      .catch(() => undefined);
  }, []);

  const loginGuanying = async () => {
    if (!loginUsername.trim() || !loginPassword) {
      toast.error('请填写账号和密码');
      return;
    }
    setLoginBusy(true);
    try {
      const result = await api.post<{ cookie: string }>('/api/search/login', {
        site: 'guanying',
        baseUrl: guanyingBase,
        username: loginUsername.trim(),
        password: loginPassword,
      });
      await api.patch('/api/settings', { guanying: { baseUrl: guanyingBase, cookie: result.cookie } });
      toast.success('观影账号登录成功，Cookie 已保存');
      setLoginPassword('');
      setLoginOpen(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '登录失败');
    } finally {
      setLoginBusy(false);
    }
  };

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!keyword.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setAlternative(null);
    try {
      if (source === 'butailing') {
        const data = await api.post<AlternativeResult>('/api/butailing/search', { keyword, mediaType, year });
        setAlternative(data);
        if (data.results.length === 0) toast.info('没有找到不太灵资源');
      } else if (source === 'guanying') {
        const data = await api.post<AlternativeResult>('/api/guanying/search', { keyword });
        setAlternative(data);
        if (data.results.length === 0) toast.info('没有找到观影结果');
      } else if (source === 'seedhub') {
        const data = await api.post<AlternativeResult>('/api/seedhub/search', { keyword });
        setAlternative(data);
        if (data.results.length === 0) toast.info('没有找到 SeedHub 结果');
      } else {
        const data = await api.post<SearchResult>('/api/hdhive/search', { keyword, mediaType, year });
        setResult(data);
        if (data.results.length === 0) toast.info('没有找到影巢资源');
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '影巢搜索失败';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const submitChallenge = async () => {
    if (!alternative?.challenge || !challengeCode.trim()) return;
    setChallengeBusy(true);
    try {
      const result = await api.post<AlternativeResult>('/api/search/challenge', {
        sessionId: alternative.challenge.sessionId,
        code: challengeCode.trim(),
      });
      setAlternative(result);
      setChallengeCode('');
      if (result.results.length === 0) toast.info('验证已提交，但没有解析到结果');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '验证失败');
    } finally {
      setChallengeBusy(false);
    }
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">HDHIVE SEARCH</span>
          <h1>影视搜索</h1>
          <p>影巢、不太灵、观影三个来源；只搜索，不自动转存。</p>
        </div>
      </header>

      <div className="search-sources editor-switch">
        <button type="button" className={source === 'hdhive' ? 'active' : ''} onClick={() => { setSource('hdhive'); setResult(null); setAlternative(null); }}>影巢</button>
        <button type="button" className={source === 'butailing' ? 'active' : ''} onClick={() => { setSource('butailing'); setResult(null); setAlternative(null); }}>不太灵</button>
        <button type="button" className={source === 'guanying' ? 'active' : ''} onClick={() => { setSource('guanying'); setResult(null); setAlternative(null); }}>观影</button>
        <button type="button" className={source === 'seedhub' ? 'active' : ''} onClick={() => { setSource('seedhub'); setResult(null); setAlternative(null); }}>SeedHub</button>
        <button type="button" disabled title="癫影为邀请制站点，需登录 Cookie 和站点适配">癫影（需适配）</button>
      </div>

      <div className="search-login-bar">
        <span>观影站点登录</span>
        <Button type="button" variant="ghost" size="sm" icon={<Settings2 size={14} />} onClick={() => setLoginOpen((current) => !current)}>{loginOpen ? '收起账号登录' : '账号登录'}</Button>
      </div>
      {loginOpen ? (
        <div className="panel search-login-panel">
          <div className="form-grid form-grid-2">
            <label className="field"><span className="field-label">观影站点地址</span><Input value={guanyingBase} onChange={(event) => setGuanyingBase(event.target.value)} placeholder="https://..." /></label>
            <label className="field"><span className="field-label">账号</span><Input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" /></label>
            <label className="field"><span className="field-label">密码</span><Input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" /></label>
            <div className="inline-action"><Button type="button" variant="primary" loading={loginBusy} onClick={() => void loginGuanying()}>登录并保存 Cookie</Button><span className="settings-hint">登录成功后搜索会自动使用保存的 Cookie。</span></div>
          </div>
        </div>
      ) : null}

      <form className="panel search-panel" onSubmit={(event) => void search(event)}>
        <div className="search-bar">
          <div className="search-input-wrap">
            <Search size={17} />
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入电影或剧集名称，例如 沙丘" />
          </div>
          <Select value={mediaType} onChange={(event) => setMediaType(event.target.value as typeof mediaType)}>
            <option value="auto">自动</option>
            <option value="movie">电影</option>
            <option value="tv">剧集</option>
          </Select>
          <Input className="search-year" value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="年份" />
          <Button type="submit" variant="primary" loading={loading} icon={<Sparkles size={15} />}>搜索</Button>
        </div>
        <p className="settings-hint">{source === 'hdhive' ? '需要在设置 → Emby 与通知 → 影巢搜索中填写 API Key 和 OpenAPI 用户 Token；TMDb Key 使用整理设置里的配置。' : source === 'butailing' ? '通过无头浏览器访问不太灵，返回磁力资源；不会自动转存。' : source === 'seedhub' ? '通过无头浏览器搜索 SeedHub，返回详情链接；不会自动转存。' : '需要观影站点地址；如站点要求登录，请在设置中填写 Cookie。'}</p>
      </form>

      {error ? (
        <div className="panel search-empty">
          <strong>搜索失败</strong>
          <p>{error}</p>
          <Button variant="secondary" size="sm" icon={<Settings2 size={14} />} onClick={() => { window.location.hash = '#/settings'; }}>去设置</Button>
        </div>
      ) : null}

      {alternative?.challenge ? (
        <div className="panel search-challenge">
          <div className="yaml-preview-head">需要人工验证</div>
          <p>{alternative.challenge.prompt}</p>
          <img src={alternative.challenge.image} alt="验证截图" />
          <div className="search-bar">
            <Input value={challengeCode} onChange={(event) => setChallengeCode(event.target.value)} placeholder="填写截图中的验证码" />
            <Button type="button" variant="primary" loading={challengeBusy} onClick={() => void submitChallenge()}>提交验证</Button>
          </div>
        </div>
      ) : null}

      {alternative ? (
        <div className="search-results">
          {alternative.results.length === 0 ? (
            <div className="panel search-empty"><strong>没有找到资源</strong><p>换一个片名，或检查设置里的站点地址/Cookie。</p></div>
          ) : alternative.results.map((item, index) => {
            const magnet = 'magnet' in item ? item.magnet : '';
            const href = 'href' in item ? item.href : (item as ButailingResult).detailUrl;
            return (
              <article className="panel search-result" key={`${href}-${index}`}>
                <div className="search-result-head">
                  <span className="search-index">{String(index + 1).padStart(2, '0')}</span>
                  <div><h3>{item.title}</h3><p>{source === 'butailing' ? '不太灵' : source === 'seedhub' ? 'SeedHub' : '观影'} · {'size' in item && item.size ? item.size : '资源'} {'quality' in item && item.quality ? `· ${item.quality}` : ''}</p></div>
                  <div className="search-badges"><span className="search-badge primary">{source === 'butailing' ? '磁力' : '网页'}</span></div>
                </div>
                <div className="search-result-foot">
                  {href ? <a href={href} target="_blank" rel="noreferrer"><ExternalLink size={12} />打开详情</a> : null}
                  {magnet ? <button type="button" className="search-copy" onClick={() => { void navigator.clipboard?.writeText(magnet); toast.success('磁力链接已复制'); }}><Copy size={12} />复制磁力</button> : null}
                </div>
              </article>
            );
          })}
          {alternative.warnings?.length ? <div className="panel search-warnings">{alternative.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        </div>
      ) : null}

      {result ? (
        <>
          {result.candidates.length > 0 ? (
            <div className="panel candidate-panel">
              <div className="yaml-preview-head">TMDb 匹配</div>
              <div className="candidate-list">
                {result.candidates.map((candidate) => (
                  <span key={`${candidate.mediaType}-${candidate.id}`} className="candidate-chip">
                    {candidate.title} {candidate.year ? `(${candidate.year})` : ''} · {candidate.mediaType === 'movie' ? '电影' : '剧集'}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {result.results.length > 0 ? (
            <div className="search-results">
              {result.results.map((item, index) => (
                <article className="panel search-result" key={item.slug}>
                  <div className="search-result-head">
                    <span className="search-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.matchedTitle}{item.matchedYear ? ` (${item.matchedYear})` : ''}</p>
                    </div>
                    <div className="search-badges">
                      <span className={item.panType.toLowerCase() === '115' ? 'search-badge primary' : 'search-badge'}>{item.panType || '未知盘'}</span>
                      {item.isOfficial ? <span className="search-badge">官方</span> : null}
                      {!item.isValid ? <span className="search-badge danger">失效</span> : null}
                    </div>
                  </div>
                  <div className="search-result-meta">
                    <span>{item.size || '大小未知'}</span>
                    {item.resolutions.map((value) => <span key={value}>{value}</span>)}
                    {item.sources.map((value) => <span key={value}>{value}</span>)}
                  </div>
                  <div className="search-result-foot">
                    <span>{item.unlockPoints > 0 ? `${item.unlockPoints} 积分` : '免费'}</span>
                    <span>{item.isUnlocked ? '已解锁' : '未解锁'}</span>
                    <code>{item.slug}</code>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel search-empty">
              <strong>没有找到资源</strong>
              <p>可以换一个片名、年份或媒体类型再试。</p>
            </div>
          )}
          {result.warnings.length ? (
            <div className="panel search-warnings">
              {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
