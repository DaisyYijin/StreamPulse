import { EventEmitter } from 'node:events';

export type LiveLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LiveLogLine {
  id: number;
  at: string;
  level: LiveLogLevel;
  message: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(100);
const history: LiveLogLine[] = [];
let nextId = 1;

export function pushLiveLog(level: LiveLogLevel, message: string): LiveLogLine {
  const line: LiveLogLine = {
    id: nextId++,
    at: new Date().toISOString(),
    level,
    message: message.replace(/\s+/g, ' ').trim().slice(0, 1000),
  };
  history.push(line);
  if (history.length > 1000) history.splice(0, history.length - 1000);
  bus.emit('line', line);
  return line;
}

export function recentLiveLogs(limit = 200): LiveLogLine[] {
  return history.slice(-Math.max(1, Math.min(1000, limit)));
}

export function subscribeLiveLogs(listener: (line: LiveLogLine) => void): () => void {
  bus.on('line', listener);
  return () => bus.off('line', listener);
}
