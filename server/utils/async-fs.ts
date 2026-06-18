import fs from 'fs/promises';
import { existsSync } from 'fs';

export async function readFile(path: string): Promise<string> {
  return fs.readFile(path, 'utf-8');
}

export async function writeFile(path: string, content: string): Promise<void> {
  await fs.writeFile(path, content, 'utf-8');
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function appendFile(path: string, content: string): Promise<void> {
  await fs.appendFile(path, content + '\n', 'utf-8');
}

export async function deleteFile(path: string): Promise<boolean> {
  try {
    await fs.unlink(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export { existsSync };
