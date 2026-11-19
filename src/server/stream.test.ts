import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStreamServer } from './stream.js';
import type { Store } from './store.js';
import type { SourceRecord } from './types.js';

const STREAM_KEY = '0123456789abcdef0123456789abcdef';
let fakeOpenList: http.Server;
let streamServer: http.Server;
let fakePort = 0;
let streamPort = 0;
let source: SourceRecord;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

beforeAll(async () => {
  fakeOpenList = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/fs/get') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        if (req.headers.authorization !== 'test-token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 401, message: 'invalid token' }));
          return;
        }
        const parsed = JSON.parse(body) as { path: string };
        if (parsed.path === '/broken.mkv') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 500, message: 'storage unavailable' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 200,
            data: { raw_url: `http://127.0.0.1:${fakePort}/cloud${parsed.path}` },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  fakePort = await listen(fakeOpenList);

  source = {
    id: 'src_test',
    name: 'Test Source',
    type: 'openlist',
    baseUrl: `http://127.0.0.1:${fakePort}`,
    publicUrl: '',
    authType: 'token',
    username: '',
    token: 'test-token',
    password: '',
    cookie: '',
    streamKey: STREAM_KEY,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastCheck: null,
  };

  const store = {
    snapshot: { sources: [source] },
  } as unknown as Store;

  streamServer = createStreamServer(store);
  streamPort = await listen(streamServer);
});

afterAll(async () => {
  await new Promise<void>((resolve) => streamServer.close(() => resolve()));
  await new Promise<void>((resolve) => fakeOpenList.close(() => resolve()));
});

describe('302 stream service', () => {
  it('resolves a raw URL and redirects without exposing the API token', async () => {
    const response = await fetch(
      `http://127.0.0.1:${streamPort}/r/${STREAM_KEY}/Movies/Test%20Movie.mkv`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `http://127.0.0.1:${fakePort}/cloud/Movies/Test%20Movie.mkv`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('supports HEAD requests', async () => {
    const response = await fetch(
      `http://127.0.0.1:${streamPort}/r/${STREAM_KEY}/Movies/Test%20Movie.mkv`,
      { method: 'HEAD', redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/cloud/Movies/Test%20Movie.mkv');
  });

  it('falls back to the OpenList /d/ link when raw resolution fails', async () => {
    const response = await fetch(`http://127.0.0.1:${streamPort}/r/${STREAM_KEY}/broken.mkv`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `http://127.0.0.1:${fakePort}/d/broken.mkv`,
    );
  });

  it('rejects unknown stream keys', async () => {
    const response = await fetch(`http://127.0.0.1:${streamPort}/r/${'f'.repeat(32)}/x.mkv`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(404);
  });

  it('rejects traversal and unsupported methods', async () => {
    const traversal = await fetch(
      `http://127.0.0.1:${streamPort}/r/${STREAM_KEY}/..%2Fetc%2Fpasswd`,
      { redirect: 'manual' },
    );
    expect(traversal.status).toBe(400);
    const post = await fetch(`http://127.0.0.1:${streamPort}/r/${STREAM_KEY}/x.mkv`, {
      method: 'POST',
      redirect: 'manual',
    });
    expect(post.status).toBe(405);
  });

  it('exposes a health endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${streamPort}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()) as { service: string }).toMatchObject({
      service: 'streampulse-stream',
    });
  });
});
