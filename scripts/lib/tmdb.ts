/**
 * Build-time TMDB client. Unlike the runtime client this replaces, it throws
 * on every failure. A half-fetched cache that silently drops a season is worse
 * than no cache at all — the build must stop where the data stops.
 */

const API_BASE = 'https://api.themoviedb.org/3';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function apiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is not set — cannot fetch TMDB metadata');
  return key;
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(API_BASE + path);
  url.searchParams.set('api_key', apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type TmdbSeriesDetail = {
  id: number;
  name: string;
  overview: string;
  first_air_date: string | null;
  last_air_date: string | null;
  number_of_episodes: number;
  backdrop_path: string | null;
  poster_path: string | null;
  seasons: { season_number: number; name: string; episode_count: number }[];
};

export type TmdbEpisode = {
  id: number;
  name: string;
  season_number: number;
  episode_number: number;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
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

export const getSeriesDetail = (id: number): Promise<TmdbSeriesDetail> =>
  tmdbGet<TmdbSeriesDetail>(`/tv/${id}`);

export const getSeason = (id: number, season: number): Promise<TmdbSeason> =>
  tmdbGet<TmdbSeason>(`/tv/${id}/season/${season}`);

export const getImages = (id: number): Promise<TmdbImages> => tmdbGet<TmdbImages>(`/tv/${id}/images`);

/** Build an absolute image URL from a TMDB file_path. Images hotlink
 * image.tmdb.org rather than being proxied or re-hosted. */
export function tmdbImageUrl(filePath: string, size = 'w500'): string {
  return `${TMDB_IMAGE_BASE}/${size}${filePath}`;
}
