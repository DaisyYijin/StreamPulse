import type { MetaTubeSettings } from '../shared/types.js';

export interface MetaTubeMovie {
  id: string;
  provider: string;
  number: string;
  title: string;
  releaseDate: string;
  coverUrl: string;
  actors: string[];
}

function base(settings: MetaTubeSettings): string {
  return settings.baseUrl.trim().replace(/\/+$/, '');
}

function headers(settings: MetaTubeSettings): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(settings.token.trim() ? { Authorization: `Bearer ${settings.token.trim()}` } : {}),
  };
}

export async function testMetaTube(settings: MetaTubeSettings): Promise<{ providers: number }> {
  if (!settings.baseUrl.trim()) throw new Error('请填写 MetaTube Server 地址');
  const response = await fetch(`${base(settings)}/v1/providers`, { headers: headers(settings), signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.message || `MetaTube 连接失败（HTTP ${response.status}）`);
  const providers = Array.isArray(payload) ? payload.length : Array.isArray(payload?.providers) ? payload.providers.length : 0;
  return { providers };
}

export async function searchMetaTube(settings: MetaTubeSettings, keyword: string): Promise<MetaTubeMovie[]> {
  if (!settings.baseUrl.trim()) throw new Error('请先在设置中填写 MetaTube Server 地址');
  const params = new URLSearchParams({ q: keyword, fallback: 'true' });
  const response = await fetch(`${base(settings)}/v1/movies/search?${params}`, { headers: headers(settings), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.message || `MetaTube 搜索失败（HTTP ${response.status}）`);
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return list.map((item: any) => ({
    id: String(item.id || ''),
    provider: String(item.provider || ''),
    number: String(item.number || ''),
    title: String(item.title || ''),
    releaseDate: String(item.release_date || ''),
    coverUrl: String(item.cover_url || ''),
    actors: Array.isArray(item.actors) ? item.actors.map((actor: any) => String(actor?.name || actor)).filter(Boolean) : [],
  })).filter((item: MetaTubeMovie) => item.id && (item.number || item.title));
}
