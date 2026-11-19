export interface StorageEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export interface StorageClient {
  readonly kind: 'openlist' | '115' | '123';
  readonly origin: string;
  list(path: string, signal?: AbortSignal): Promise<StorageEntry[]>;
  getRawUrl(path: string, signal?: AbortSignal): Promise<string | null>;
  testConnection(signal?: AbortSignal): Promise<{ message: string; sampleCount: number }>;
  fallbackUrl?(path: string): string | null;
}
