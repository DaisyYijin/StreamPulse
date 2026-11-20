import type { EmbyLibrary, EmbyServer } from '../shared/types.js';

function base(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function embyRequest(server: EmbyServer, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${base(server.url)}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(server.apiKey)}`;
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

export async function testEmby(server: EmbyServer): Promise<{ name: string }> {
  for (const path of ['/System/Info', '/emby/System/Info']) {
    try {
      const response = await embyRequest(server, path);
      if (response.ok) {
        const data = await response.json() as { ServerName?: string; Name?: string };
        return { name: data.ServerName || data.Name || server.name };
      }
    } catch {
      // Try the alternate Emby base path.
    }
  }
  throw new Error('Emby 连接失败，请检查地址和 API Key');
}

export async function listEmbyLibraries(server: EmbyServer): Promise<EmbyLibrary[]> {
  const response = await embyRequest(server, '/Library/VirtualFolders');
  if (!response.ok) {
    throw new Error(`读取 Emby 媒体库失败（HTTP ${response.status}）`);
  }
  const data = await response.json() as any;
  const list = Array.isArray(data) ? data : Array.isArray(data?.Items) ? data.Items : [];
  return list.map((item: any) => ({
    id: String(item.ItemId || item.Id || ''),
    name: String(item.Name || ''),
    collectionType: String(item.CollectionType || ''),
    locations: Array.isArray(item.Locations) ? item.Locations.map(String) : [],
  })).filter((item: EmbyLibrary) => item.id && item.name);
}

export async function createEmbyLibrary(
  server: EmbyServer,
  input: { name: string; collectionType: string; paths: string[] },
): Promise<EmbyLibrary> {
  const allowed = new Set(['movies', 'tvshows', 'music', 'musicvideos', 'homevideos', 'mixed']);
  if (!allowed.has(input.collectionType)) throw new Error('不支持的媒体库类型');
  const params = new URLSearchParams({
    name: input.name,
    collectionType: input.collectionType,
    refreshLibrary: 'true',
  });
  for (const dir of input.paths) params.append('paths', dir);
  const response = await fetch(
    `${base(server.url)}/Library/VirtualFolders?${params.toString()}&api_key=${encodeURIComponent(server.apiKey)}`,
    { method: 'POST', signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `创建 Emby 媒体库失败（HTTP ${response.status}）`);
  }
  const libraries = await listEmbyLibraries(server);
  return libraries.find((library) => library.name === input.name)
    || { id: '', name: input.name, collectionType: input.collectionType, locations: input.paths };
}

export async function refreshEmbyAfterRun(servers: EmbyServer[]): Promise<string[]> {
  const errors: string[] = [];
  for (const server of servers.filter((item) => item.refreshAfterRun && item.libraryIds.length > 0)) {
    for (const libraryId of server.libraryIds) {
      try {
        const response = await embyRequest(server, `/Items/${encodeURIComponent(libraryId)}/Refresh?Recursive=true`, { method: 'POST' });
        if (!response.ok) errors.push(`${server.name}: HTTP ${response.status}`);
      } catch (error) {
        errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return errors;
}
