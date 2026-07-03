import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logger } from '../observability/logger';

const MODELS_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'models');

interface ModelSource {
  url: string;
  filename: string;
  expectedSha256?: string;
}

const MODELS: Record<string, ModelSource> = {
  'prithvi-eo-tiny': {
    url: 'https://huggingface.co/nthh/prithvi-eo-tiny-onnx/resolve/main/prithvi-eo-tiny.onnx',
    filename: 'prithvi-eo-tiny.onnx',
  },
};

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function modelPath(name: string): string {
  const src = MODELS[name];
  if (!src) throw new Error(`Unknown model: ${name}`);
  return path.join(MODELS_DIR, src.filename);
}

function verifyChecksum(filePath: string, expectedSha256: string): boolean {
  try {
    const data = fs.readFileSync(filePath);
    const hash = createHash('sha256').update(data).digest('hex');
    return hash === expectedSha256;
  } catch {
    return false;
  }
}

export function getModelPath(name: string): string | null {
  const p = modelPath(name);
  return fs.existsSync(p) ? p : null;
}

export function isModelDownloaded(name: string): boolean {
  return getModelPath(name) !== null;
}

export async function downloadModel(
  name: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const src = MODELS[name];
  if (!src) throw new Error(`Unknown model: ${name}`);

  ensureDir(MODELS_DIR);
  const dest = modelPath(name);

  if (fs.existsSync(dest)) {
    logger.info({ model: name, path: dest }, 'Model already cached');
    return dest;
  }

  logger.info({ model: name, url: src.url }, 'Downloading model');

  const response = await fetch(src.url);
  if (!response.ok) throw new Error(`Failed to download model: ${response.statusText}`);

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total && onProgress) {
        onProgress(Math.round((received / total) * 100));
      }
    }
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(dest, buffer);

  if (src.expectedSha256 && !verifyChecksum(dest, src.expectedSha256)) {
    fs.unlinkSync(dest);
    throw new Error('Checksum mismatch after download');
  }

  const size = (buffer.length / 1024 / 1024).toFixed(1);
  logger.info({ model: name, sizeMB: size }, 'Model downloaded successfully');
  return dest;
}

export function listModels(): string[] {
  return Object.keys(MODELS);
}

export { MODELS_DIR };
