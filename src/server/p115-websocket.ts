import WebSocket from 'ws';
import type { Scheduler } from './scheduler.js';
import type { Store } from './store.js';
import { P115Client } from './p115.js';

interface Connection {
  socket: WebSocket;
  sourceId: string;
  stopped: boolean;
  ping?: NodeJS.Timeout;
  retry?: NodeJS.Timeout;
}

export class P115WebSocketManager {
  private readonly store: Store;
  private readonly scheduler: Scheduler;
  private readonly connections = new Map<string, Connection>();

  constructor(store: Store, scheduler: Scheduler) {
    this.store = store;
    this.scheduler = scheduler;
  }

  start(): void {
    for (const source of this.store.snapshot.sources) {
      if (source.type !== '115') continue;
      const watched = this.store.snapshot.libraries.some((library) => library.sourceId === source.id && library.eventWatch && library.enabled);
      if (!watched) continue;
      this.connect(source.id);
    }
  }

  stop(): void {
    for (const connection of this.connections.values()) {
      connection.stopped = true;
      if (connection.ping) clearInterval(connection.ping);
      if (connection.retry) clearTimeout(connection.retry);
      connection.socket.close();
    }
    this.connections.clear();
  }

  private connect(sourceId: string): void {
    if (this.connections.has(sourceId)) return;
    const source = this.store.source(sourceId);
    if (!source) return;
    const client = new P115Client(source.cookies?.length ? source.cookies : source.cookie);
    void client.websocketHost(AbortSignal.timeout(15_000)).then((host) => {
      if (!host?.server || !host?.user_id) throw new Error('115 WebSocket 未返回 host');
      const sequenceId = 1;
      const uri = `wss://${host.server}/?uid=${encodeURIComponent(String(host.user_id))}&client_version=1&client_type=5&sequence_id=${sequenceId}&session=${encodeURIComponent(String(host.session_id || 0))}`;
      const socket = new WebSocket(uri, { headers: { Cookie: source.cookies?.length ? source.cookies[0] : source.cookie } });
      const connection: Connection = { socket, sourceId, stopped: false };
      this.connections.set(sourceId, connection);
      socket.on('open', () => {
        let seq = 2;
        socket.send(JSON.stringify({ body: '{"id":0,"type":"115"}', cmd_key: 16781314, sequence_id: seq++ }));
        connection.ping = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ cmd_key: 2, sequence_id: seq++ }));
        }, 40_000);
      });
      socket.on('message', (raw) => {
        try {
          const message = JSON.parse(String(raw));
          if (message?.body && typeof message.body === 'string') JSON.parse(message.body);
          for (const library of this.store.snapshot.libraries) {
            if (library.sourceId === sourceId && library.eventWatch && library.enabled) {
              void this.scheduler.triggerEventPoll(library.id).catch(() => undefined);
            }
          }
        } catch {
          // Ignore malformed websocket messages.
        }
      });
      socket.on('close', () => {
        if (connection.ping) clearInterval(connection.ping);
        this.connections.delete(sourceId);
        if (!connection.stopped) {
          connection.retry = setTimeout(() => this.connect(sourceId), 15_000);
        }
      });
      socket.on('error', () => socket.close());
    }).catch((error) => {
      console.warn(`[115-ws] ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => this.connect(sourceId), 30_000);
    });
  }
}
