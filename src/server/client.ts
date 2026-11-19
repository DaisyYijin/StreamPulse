import { OpenListClient } from './openlist.js';
import type { SourceRecord } from './types.js';

export function clientForSource(source: SourceRecord): OpenListClient {
  return new OpenListClient({
    baseUrl: source.baseUrl,
    token: source.token,
    username: source.username,
    password: source.password,
  });
}
