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

/**
 * Whether any TMDB credential is present.
 *
 * Callers ask before starting rather than catching the throw above, because the
 * two situations are not the same. A missing key means "this machine was never
 * going to do the TMDB half" — a clone without secrets, or a workflow whose
 * secret is unset — and the right response is to say so once and carry on with
 * the committed metadata. A key that is present and rejected is a real failure
 * and still throws.
 */
export function hasTmdbCredential(): boolean {
  return Boolean(
    process.env.TMDB_API_TOKEN ?? process.env.TMDB_READ_ONLY_KEY ?? process.env.TMDB_API_KEY,
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
   * This episode's IMDb id, in three states — the same shape `audioLanguages`
   * uses on an `Episode`, and for the same reason:
   *
   *   • undefined — nobody has looked yet
   *   • null      — looked, and IMDb has no id for this episode
   *   • "tt…"     — the id
   *
   * The difference between the last two is what makes the scan repeatable.
   * TMDB only serves these one episode at a time, so they are filled in by a
   * bounded pass over episodes that actually have a video rather than by the
   * season fetch — see `fetchEpisodeImdbIds` in scripts/fetch.ts.
   */
  imdbId?: string | null;
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

/** What TMDB knows about this series elsewhere. Only IMDb is read today. */
export type TmdbExternalIds = {
  imdb_id: string | null;
};

/** Everything cached for one series under data/tmdb/{id}.json. */
export type TmdbSeriesCache = {
  fetchedAt: string;
  detail: TmdbSeriesDetail;
  seasons: TmdbSeason[];
  images: TmdbImages;
  /**
   * The series' IMDb id, when TMDB knows one.
   *
   * Optional rather than nullable because every seed written before this
   * existed simply has no opinion, and that is different from a series TMDB has
   * looked at and has no IMDb id for.
   */
  imdbId?: string | null;
  /**
   * The real, positive TMDB id this cache was fetched from.
   *
   * A series in this archive is keyed by a negative placeholder id, so the
   * file name cannot carry the upstream id and `detail.id` is rewritten to the
   * placeholder so every downstream identity check keeps working. This is the
   * one field that remembers where the data actually came from — it is what
   * builds a themoviedb.org link, and what a refetch resolves against.
   */
  tmdbId?: number;
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

/** The series' ids on other databases. One call per series, so it rides along
 * with every series fetch. */
export const getExternalIds = (id: number): Promise<TmdbExternalIds> =>
  tmdbGet<TmdbExternalIds>(`/tv/${id}/external_ids`);

/**
 * One episode's ids elsewhere.
 *
 * TMDB has no bulk form of this — it is a call per episode, which is why no
 * caller may loop it over a whole catalogue. Returns null rather than throwing
 * when TMDB does not have the episode, because an episode list that runs past
 * what IMDb indexes is ordinary and should not fail a run.
 */
export async function getEpisodeExternalIds(
  id: number,
  season: number,
  episode: number,
): Promise<string | null> {
  try {
    const ids = await tmdbGet<TmdbExternalIds>(
      `/tv/${id}/season/${season}/episode/${episode}/external_ids`,
    );
    return ids.imdb_id || null;
  } catch {
    return null;
  }
}

/** Build an absolute image URL from a TMDB file_path. Images hotlink
 * image.tmdb.org rather than being proxied or re-hosted. */
export function tmdbImageUrl(filePath: string, size = 'w500'): string {
  return `${TMDB_IMAGE_BASE}/${size}${filePath}`;
}
