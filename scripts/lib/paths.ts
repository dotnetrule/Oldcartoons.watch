import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ZodType, ZodTypeDef } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(here, '..', '..');
export const CONTENT_DIR = join(ROOT, 'content');
export const CACHE_DIR = join(ROOT, 'data');
export const TMDB_CACHE_DIR = join(CACHE_DIR, 'tmdb');
export const YOUTUBE_CACHE_DIR = join(CACHE_DIR, 'youtube');
export const PUBLIC_DATA_DIR = join(ROOT, 'public', 'data');

/** Committed stand-in metadata for series not yet resolved against TMDB. */
export const TMDB_SEED_DIR = join(CONTENT_DIR, 'tmdb-seed');

/** Committed real TMDB season/episode lists, keyed by the placeholder id of the
 * series they belong to. See content/tmdb-episodes/README.md for why these are
 * not in TMDB_SEED_DIR. */
export const TMDB_EPISODES_DIR = join(CONTENT_DIR, 'tmdb-episodes');

export const contentPath = (name: string): string => join(CONTENT_DIR, name);
export const tmdbCachePath = (id: number | string): string => join(TMDB_CACHE_DIR, `${id}.json`);
export const youtubeCachePath = (id: string): string => join(YOUTUBE_CACHE_DIR, `${id}.json`);

/**
 * Where a series' TMDB-shaped metadata actually lives.
 *
 * For a real TMDB id, `data/tmdb/` is a genuine cache: disposable, gitignored,
 * re-fetchable at any time. For a placeholder id there is nothing to re-fetch —
 * that file is hand-authored source data, so it is committed under
 * `content/tmdb-seed/` and a fresh clone can build without running `fetch`.
 *
 * This is a dispatch on whether the series is resolved yet, not a fallback:
 * exactly one location is correct for a given id, and a miss still throws.
 */
export const seriesMetadataPath = (tmdbId: number): string =>
  tmdbId < 0 ? join(TMDB_SEED_DIR, `${tmdbId}.json`) : tmdbCachePath(tmdbId);

/**
 * Where the real TMDB episode list for a placeholder-id series lives.
 *
 * Deliberately separate from `seriesMetadataPath`: that one answers "where does
 * this series' metadata live today", which may be a playlist-authored seed.
 * This one names a single file that only `fetch` writes, so the two owners
 * cannot overwrite each other.
 */
export const tmdbEpisodesPath = (placeholderId: number): string =>
  join(TMDB_EPISODES_DIR, `${placeholderId}.json`);

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

/**
 * Read a JSON file and validate it, throwing a message that names the file
 * and the offending path so a bad hand-edit is obvious from the build log.
 *
 * The input side is `unknown` on purpose. The parsed file genuinely is
 * unknown, and pinning it there is also what makes `T` bind to the schema's
 * *output* — so a schema that fills in a default hands back the completed
 * shape rather than the optional one the file was allowed to have.
 */
export function readValidated<T>(path: string, schema: ZodType<T, ZodTypeDef, unknown>): T {
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
