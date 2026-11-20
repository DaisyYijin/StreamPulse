import http from 'node:http';
import { config } from './config.js';
import { clientForSource } from './client.js';
import type { StorageClient } from './storage.js';
import { normalizeSourcePath, PathSafetyError } from './core/paths.js';
import { encodePath } from './core/template.js';
import type { Store } from './store.js';
import type { SourceRecord } from './types.js';

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const URL_CACHE_TTL = 45_000;
const MAX_CACHE_ENTRIES = 3_000;

function plain(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(message);
}

function fallbackUrl(source: SourceRecord, sourcePath: string): string {
  const base = (source.publicUrl || source.baseUrl).replace(/\/+$/, '');
  return `${base}/d${encodePath(sourcePath)}`;
}

function normalizeRedirect(raw: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(raw, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function createStreamServer(store: Store): http.Server {
  const urlCache = new Map<string, CacheEntry>();
  const clients = new Map<string, StorageClient>();

  const clientFor = (source: SourceRecord): StorageClient => {
    const key = `${source.id}:${source.updatedAt}`;
    const existing = clients.get(key);
    if (existing) return existing;
    const client = clientForSource(source, (cookie) => {
      source.cookie = cookie;
      source.cookies = [cookie, ...(source.cookies ?? []).filter((item) => item !== cookie)];
      void store.save();
    });
    if (clients.size > 80) clients.clear();
    clients.set(key, client);
    return client;
  };

  const remember = (key: string, url: string, ttl = URL_CACHE_TTL): void => {
    if (urlCache.size > MAX_CACHE_ENTRIES) {
      const oldest = urlCache.keys().next().value;
      if (oldest) urlCache.delete(oldest);
    }
    urlCache.set(key, { url, expiresAt: Date.now() + ttl });
  };

  const resolveTarget = async (source: SourceRecord, sourcePath: string): Promise<string> => {
    const cacheKey = `${source.id}:${source.updatedAt}:${sourcePath}`;
    const cached = urlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const client = clientFor(source);
    try {
      const raw = await client.getRawUrl(sourcePath, AbortSignal.timeout(15_000));
      if (raw) {
        const normalized = normalizeRedirect(raw, client.origin);
        if (normalized) {
          remember(cacheKey, normalized);
          return normalized;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (source.type === 'openlist') {
        console.warn(`[stream] ${source.name}: 无法解析直链，回退到 OpenList /d/（${message}）`);
      }
    }

    if (source.type !== 'openlist') {
      throw new Error('无法解析直链');
    }
    const fallback = fallbackUrl(source, sourcePath);
    remember(cacheKey, fallback, 15_000);
    return fallback;
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method || 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        plain(res, 405, 'Method Not Allowed');
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(req.url || '/', 'http://streampulse.local');
      } catch {
        plain(res, 400, 'Bad Request');
        return;
      }

      if (parsed.pathname === '/health' || parsed.pathname === '/healthz') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            status: 'ok',
            service: 'streampulse-stream',
            version: config.version,
            port: config.streamPort,
          }),
        );
        return;
      }

      const match = /^\/r\/([a-f0-9]{16,64})(\/.*)?$/.exec(parsed.pathname);
      if (!match) {
        plain(res, 404, 'Not Found');
        return;
      }

      let sourcePath: string;
      try {
        sourcePath = normalizeSourcePath(decodeURIComponent(match[2] || '/'));
      } catch (error) {
        if (error instanceof PathSafetyError || error instanceof URIError) {
          plain(res, 400, 'Bad Request');
          return;
        }
        plain(res, 400, 'Bad Request');
        return;
      }

      const source = store.snapshot.sources.find((item) => item.streamKey === match[1]);
      if (!source) {
        plain(res, 404, 'Not Found');
        return;
      }

      try {
        const target = await resolveTarget(source, sourcePath);
        res.writeHead(302, {
          Location: target,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex, nofollow',
        });
        res.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[stream] ${source.name}: ${message}`);
        plain(res, 502, 'Bad Gateway');
      }
    })();
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return server;
}
