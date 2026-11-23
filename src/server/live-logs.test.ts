import { describe, expect, it } from 'vitest';
import { humanizeLog } from './live-logs.js';

describe('live log localization', () => {
  it('translates API operations', () => {
    expect(humanizeLog('GET /api/libraries → 200 (12ms)')).toBe('操作：读取媒体库 → 成功（12ms）');
    expect(humanizeLog('POST /api/integrations/emby/test → 500 (20ms)')).toBe('操作：提交Emby 集成 → 服务器错误（20ms）');
  });

  it('translates service prefixes and common phrases', () => {
    expect(humanizeLog('[server] SIGTERM received, shutting down')).toContain('[服务]');
    expect(humanizeLog('[server] SIGTERM received, shutting down')).toContain('已收到信号，正在关闭');
  });
});
