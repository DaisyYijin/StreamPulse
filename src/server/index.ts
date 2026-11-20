import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { AccountStore } from './accounts.js';
import { createApiRouter } from './api/index.js';
import { Auth } from './auth.js';
import { config } from './config.js';
import { RunManager } from './runner.js';
import { Scheduler } from './scheduler.js';
import { TelegramBot } from './telegram-bot.js';
import { closeBrowser } from './browser.js';
import { handleCloudDriveWebhook } from './clouddrive.js';
import { P115WebSocketManager } from './p115-websocket.js';
import { initLogging } from './logger.js';
import { createStreamServer } from './stream.js';
import { Store } from './store.js';
import { HttpError } from './types.js';

async function main(): Promise<void> {
  if (config.streamPort === config.port) {
    throw new Error('PORT 与 STREAM_PORT 不能相同');
  }
  const logFile = await initLogging();
  const store = new Store();
  await store.init();
  const accounts = new AccountStore(store.configDir);
  await accounts.init(store.getLegacyAccount());
  await store.clearLegacyAccount();
  const auth = new Auth(store, accounts);
  const runner = new RunManager(store);
  await runner.init();
  const scheduler = new Scheduler(store, runner);
  const telegramBot = new TelegramBot(store, runner);
  const p115WebSocket = new P115WebSocketManager(store, scheduler);
  const streamServer = createStreamServer(store);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.use('/covers', express.static(path.join(store.stateDir, 'covers'), { maxAge: '1h' }));
  app.use(express.json({ limit: config.maxBodyBytes }));
  app.post('/api/hooks/clouddrive', (req, res) => {
    void handleCloudDriveWebhook(req, res, store, runner);
  });

  app.use('/api', auth.middleware);
  app.use('/api', createApiRouter({ store, auth, runner, scheduler }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));

  const indexHtml = path.join(config.webDist, 'index.html');
  const hasWeb = fs.existsSync(indexHtml);
  if (hasWeb) {
    app.use(
      express.static(config.webDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(indexHtml, { headers: { 'Cache-Control': 'no-cache' } });
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send('StreamPulse API is running. Frontend assets are not built; run `npm run build`.');
    });
  }

  app.use((_req, _res, next) => next(new HttpError(404, '页面不存在')));

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const rawStatus =
      error instanceof HttpError
        ? error.status
        : error && typeof error === 'object' && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : 500;
    const status = Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : status === 400
          ? '请求体格式无效'
          : error instanceof Error
            ? error.message
            : '服务器内部错误';
    if (status >= 500) {
      console.error(`[api] ${req.method} ${req.originalUrl}`, error);
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({
      error: message,
      ...(error instanceof HttpError && error.details ? { details: error.details } : {}),
    });
  };
  app.use(errorHandler);

  scheduler.start();
  telegramBot.start();
  p115WebSocket.start();

  const webServer = app.listen(config.port, config.host, () => {
    console.log('');
    console.log(`  StreamPulse v${config.version}`);
    console.log(`  → Web UI        http://localhost:${config.port}`);
    console.log(`  → 302 stream    http://localhost:${config.streamPort}`);
    console.log(`  config:         ${config.configDir}`);
    console.log(`  output:         ${store.snapshot.settings.outputDir}`);
    console.log(`  logs:           ${logFile}`);
    console.log(`  auth:           ${auth.envManaged ? 'environment account' : auth.passwordSet ? `local account (${auth.username})` : 'first-run setup'}`);
    console.log('');
  });
  streamServer.listen(config.streamPort, config.host, () => {
    console.log(`  [stream] 302 service listening on ${config.host}:${config.streamPort}`);
  });

  webServer.on('error', (error) => {
    console.error('[web]', error);
    process.exitCode = 1;
  });
  streamServer.on('error', (error) => {
    console.error('[stream]', error);
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);
    scheduler.stop();
    await telegramBot.stop();
    p115WebSocket.stop();
    await closeBrowser();
    await runner.shutdown();
    await Promise.all([
      new Promise<void>((resolve) => webServer.close(() => resolve())),
      new Promise<void>((resolve) => streamServer.close(() => resolve())),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[fatal]', error);
  process.exit(1);
});
