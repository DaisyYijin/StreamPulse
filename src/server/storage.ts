export interface StorageEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  id?: string;
  parentId?: string;
}

export interface StorageClient {
  readonly kind: 'openlist' | '115' | '123';
  readonly origin: string;
  list(path: string, signal?: AbortSignal): Promise<StorageEntry[]>;
  getRawUrl(path: string, signal?: AbortSignal): Promise<string | null>;
  testConnection(signal?: AbortSignal): Promise<{ message: string; sampleCount: number }>;
  fallbackUrl?(path: string): string | null;
  mkdir?(path: string, signal?: AbortSignal): Promise<void>;
  move?(sourcePath: string, destinationDir: string, signal?: AbortSignal): Promise<void>;
  rename?(sourcePath: string, newName: string, signal?: AbortSignal): Promise<void>;
  remove?(sourcePath: string, signal?: AbortSignal): Promise<void>;
}
