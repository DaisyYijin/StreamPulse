import path from 'node:path';

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const configDir = path.resolve(
  process.env.CONFIG_DIR || process.env.DATA_DIR || path.join(process.cwd(), 'config'),
);
const stateDir = path.resolve(
  process.env.STATE_DIR || path.join(process.cwd(), 'data'),
);

export const config = {
  port: intEnv(process.env.PORT, 1024),
  streamPort: intEnv(process.env.STREAM_PORT, 2048),
  streamPublicUrl: (process.env.STREAM_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  host: process.env.HOST || '0.0.0.0',
  configDir,
  stateDir,
  outputDir: path.resolve(process.env.OUTPUT_DIR || path.join(configDir, 'strm')),
  logDir: path.resolve(process.env.LOG_DIR || path.join(configDir, 'logs')),
  webDist: path.resolve(process.env.WEB_DIST || path.join(process.cwd(), 'dist', 'web')),
  envPassword: process.env.STREAMPULSE_PASSWORD || '',
  envUsername: (process.env.STREAMPULSE_USERNAME || 'admin').trim(),
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''),
  isProduction: process.env.NODE_ENV === 'production',
  sessionDays: 30,
  maxBodyBytes: 1024 * 1024,
  runLogLimit: 600,
  runRetentionDefault: 80,
  logRetentionDays: intEnv(process.env.LOG_RETENTION_DAYS, 14),
  scanFileLimit: 250_000,
  version: process.env.STREAMPULSE_VERSION || '1.39.0',
};
