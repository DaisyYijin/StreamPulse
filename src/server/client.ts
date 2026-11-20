import { OpenListClient } from './openlist.js';
import { P115Client } from './p115.js';
import { P123Client } from './p123.js';
import type { StorageClient } from './storage.js';
import type { SourceRecord } from './types.js';

export function clientForSource(source: SourceRecord): StorageClient {
  if (source.type === '115') return new P115Client(source.cookies?.length ? source.cookies : source.cookie);
  if (source.type === '123') {
    return new P123Client({
      username: source.username,
      password: source.password,
      token: source.token,
    });
  }
  return new OpenListClient({
    baseUrl: source.baseUrl,
    token: source.token,
    username: source.username,
    password: source.password,
  });
}
