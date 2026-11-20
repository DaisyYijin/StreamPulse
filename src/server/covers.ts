import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Store } from './store.js';
import type { LibraryRecord } from './types.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function findPosters(root: string): Promise<string[]> {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0 && result.length < 40) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(full);
    }
  }
  return result;
}

function titleSvg(width: number, height: number, title: string, subtitle: string): Buffer {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b100f"/><stop offset="0.45" stop-color="#0b100f" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#0b100f" stop-opacity="0.95"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="64" y="${height - 126}" fill="#ffffff" font-size="62" font-family="sans-serif" font-weight="700">${escapeXml(title)}</text>
    <text x="66" y="${height - 78}" fill="#c9ff57" font-size="26" font-family="sans-serif" letter-spacing="5">${escapeXml(subtitle)}</text>
  </svg>`);
}

export async function generateLibraryCover(store: Store, library: LibraryRecord): Promise<string> {
  const outputDir = path.resolve(store.snapshot.settings.outputDir);
  const target = path.resolve(outputDir, library.targetPath);
  if (target !== outputDir && !target.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error('媒体库输出目录无效');
  }
  const posters = await findPosters(target);
  const coversDir = path.join(store.stateDir, 'covers');
  await fs.mkdir(coversDir, { recursive: true, mode: 0o750 });
  const destination = path.join(coversDir, `${library.id}.jpg`);
  const width = 1200;
  const height = 1800;

  if (posters.length === 0) {
    await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#0b100f"/>
      <text x="60" y="780" fill="#c9ff57" font-size="24" font-family="sans-serif" letter-spacing="6">STREAMPULSE LIBRARY</text>
      <text x="60" y="880" fill="#ffffff" font-size="74" font-family="sans-serif" font-weight="700">${escapeXml(library.name)}</text>
      <text x="60" y="940" fill="#8b9a94" font-size="28" font-family="sans-serif">${escapeXml(library.targetPath)}</text>
    </svg>`)).jpeg({ quality: 90 }).toFile(destination);
    return destination;
  }

  const selected = posters.slice(0, 9);
  const cellWidth = Math.floor(width / 3);
  const cellHeight = Math.floor(height / 3);
  const composites: sharp.OverlayOptions[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    try {
      const tile = await sharp(selected[index]).resize(cellWidth, cellHeight, { fit: 'cover' }).toBuffer();
      composites.push({ input: tile, left: (index % 3) * cellWidth, top: Math.floor(index / 3) * cellHeight });
    } catch {
      // Ignore an unreadable poster.
    }
  }
  await sharp({ create: { width, height, channels: 3, background: '#0b100f' } })
    .composite(composites)
    .composite([{ input: titleSvg(width, height, library.name, library.targetPath), left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toFile(destination);
  return destination;
}
