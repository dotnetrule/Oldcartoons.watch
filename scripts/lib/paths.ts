import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ZodType } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(here, '..', '..');
export const CONTENT_DIR = join(ROOT, 'content');
export const CACHE_DIR = join(ROOT, 'data');
export const TMDB_CACHE_DIR = join(CACHE_DIR, 'tmdb');
export const YOUTUBE_CACHE_DIR = join(CACHE_DIR, 'youtube');
export const PUBLIC_DATA_DIR = join(ROOT, 'public', 'data');

export const contentPath = (name: string): string => join(CONTENT_DIR, name);
export const tmdbCachePath = (id: number | string): string => join(TMDB_CACHE_DIR, `${id}.json`);
export const youtubeCachePath = (id: string): string => join(YOUTUBE_CACHE_DIR, `${id}.json`);

export function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    // No fallback data paths: a missing input is a build failure, not an
    // empty default that quietly ships a smaller archive.
    throw new Error(`cannot read ${path} — run the pipeline scripts in order (fetch → match → build-data)`, {
      cause,
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new Error(`${path} is not valid JSON`, { cause });
  }
}

/** Read a JSON file and validate it, throwing a message that names the file
 * and the offending path so a bad hand-edit is obvious from the build log. */
export function readValidated<T>(path: string, schema: ZodType<T>): T {
  const parsed = schema.safeParse(readJson(path));
  if (!parsed.success) {
    throw new Error(`${path} failed validation:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

export function formatZodError(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.length ? issue.path.map(String).join('.') : '(root)';
      return `  • ${at}: ${issue.message}`;
    })
    .join('\n');
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function ensureDirs(...dirs: string[]): void {
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
}
