/**
 * Build-time TMDB client. Unlike the runtime client this replaces, it throws
 * on every failure. A half-fetched cache that silently drops a season is worse
 * than no cache at all — the build must stop where the data stops.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths';

const API_BASE = 'https://api.themoviedb.org/3';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// `tsx` does not read Vite's env files. Load the repository-local file here,
// in build-time code only, so neither credential can enter the browser bundle.
const envPath = join(ROOT, '.env');
if (
  !process.env.TMDB_API_TOKEN &&
  !process.env.TMDB_READ_ONLY_KEY &&
  !process.env.TMDB_API_KEY &&
  existsSync(envPath)
) {
  process.loadEnvFile(envPath);
}

function authentication(url: URL): Record<string, string> {
  const token = process.env.TMDB_API_TOKEN ?? process.env.TMDB_READ_ONLY_KEY;
  if (token) return { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const key = process.env.TMDB_API_KEY;
  if (key) {
    url.searchParams.set('api_key', key);
    return { Accept: 'application/json' };
  }

  throw new Error(
    'TMDB_API_TOKEN (or TMDB_READ_ONLY_KEY) or TMDB_API_KEY is not set — cannot fetch TMDB metadata',
  );
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: authentication(url) });
  if (!res.ok) {
    throw new Error(`TMDB ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type TmdbSeriesDetail = {
  id: number;
  name: string;
  original_name?: string;
  overview: string;
  first_air_date: string | null;
  last_air_date: string | null;
  number_of_episodes: number;
  backdrop_path: string | null;
  poster_path: string | null;
  genres?: { id: number; name: string }[];
  seasons: { season_number: number; name: string; episode_count: number }[];
};

export type TmdbSeriesSearchResult = {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string | null;
  backdrop_path: string | null;
  poster_path: string | null;
  genre_ids: number[];
};

type TmdbSearchResponse = {
  results: TmdbSeriesSearchResult[];
};

export type TmdbEpisode = {
  id: number;
  name: string;
  season_number: number;
  episode_number: number;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
  /**
   * The exact length of the video backing this episode, when a source stated
   * it. TMDB's own `runtime` is editorial and rounded to whole minutes, which
   * is too coarse to cut a broadcast slot from; this is not, and it is absent
   * on every seed written before the ingest started reading it.
   */
  runtimeSeconds?: number | null;
};

export type TmdbSeason = {
  season_number: number;
  name: string;
  episodes: TmdbEpisode[];
};

export type TmdbImage = {
  file_path: string;
  iso_639_1: string | null;
  width: number;
  height: number;
  vote_average: number;
};

export type TmdbImages = {
  backdrops: TmdbImage[];
  posters: TmdbImage[];
};

/** Everything cached for one series under data/tmdb/{id}.json. */
export type TmdbSeriesCache = {
  fetchedAt: string;
  detail: TmdbSeriesDetail;
  seasons: TmdbSeason[];
  images: TmdbImages;
};

export const getSeriesDetail = (id: number, language?: string): Promise<TmdbSeriesDetail> =>
  tmdbGet<TmdbSeriesDetail>(`/tv/${id}`, language ? { language } : {});

export const searchSeries = (query: string, language = 'nl-NL'): Promise<TmdbSeriesSearchResult[]> =>
  tmdbGet<TmdbSearchResponse>('/search/tv', {
    query,
    language,
    include_adult: 'false',
  }).then((response) => response.results);

export const getSeason = (id: number, season: number): Promise<TmdbSeason> =>
  tmdbGet<TmdbSeason>(`/tv/${id}/season/${season}`);

export const getImages = (id: number): Promise<TmdbImages> => tmdbGet<TmdbImages>(`/tv/${id}/images`);

/** Build an absolute image URL from a TMDB file_path. Images hotlink
 * image.tmdb.org rather than being proxied or re-hosted. */
export function tmdbImageUrl(filePath: string, size = 'w500'): string {
  return `${TMDB_IMAGE_BASE}/${size}${filePath}`;
}
