export interface RemoteFile {
  path: string;
  relative: string;
  name: string;
  extension: string;
  size: number;
  modified: string;
}

export interface ManifestEntry {
  strmFile: string;
  sourcePath: string;
  size: number;
  modified: string;
  url: string;
  generatedAt: string;
}

export interface Manifest {
  version: 1;
  libraryId: string;
  updatedAt: string;
  entries: Record<string, ManifestEntry>;
  sidecars?: Record<string, string>;
}

export function emptyManifest(libraryId: string): Manifest {
  return {
    version: 1,
    libraryId,
    updatedAt: new Date().toISOString(),
    entries: {},
    sidecars: {},
  };
}

export function isUnchanged(
  previous: ManifestEntry | undefined,
  file: RemoteFile,
  url: string,
): boolean {
  return Boolean(
    previous &&
      previous.size === file.size &&
      previous.modified === file.modified &&
      previous.url === url,
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}
