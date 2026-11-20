import type { EmbyServer } from '../shared/types.js';

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
