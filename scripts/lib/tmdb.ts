/**
 * Build-time TMDB client. Unlike the runtime client this replaces, it throws
 * on every failure. A half-fetched cache that silently drops a season is worse
 * than no cache at all — the build must stop where the data stops.
 */

const API_BASE = 'https://api.themoviedb.org/3';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** How a request proves who it is: a header, a query parameter, or both. */
type TmdbCredential = {
  label: string;
  headers: Record<string, string>;
  query: Record<string, string>;
};

/**
 * TMDB issues two credentials for the same account and they authenticate
 * differently: the v3 API key travels as an `api_key` query parameter, the
 * read access token as an `Authorization: Bearer` header. Both are accepted by
 * the v3 endpoints this client calls, so either one alone is enough to ingest.
 *
 * The token wins when both are set. It is the credential TMDB hands out for
 * read-only use, and keeping it out of the URL keeps it out of anything that
 * echoes a URL back — a proxy log, or the failure message below.
 */
function credential(): TmdbCredential {
  const token = process.env.TMDB_READONLY_KEY?.trim();
  if (token) {
    return { label: 'TMDB_READONLY_KEY', headers: { Authorization: `Bearer ${token}` }, query: {} };
  }

  const key = process.env.TMDB_API_KEY?.trim();
  if (key) return { label: 'TMDB_API_KEY', headers: {}, query: { api_key: key } };

  throw new Error(
    'No TMDB credential is set — cannot fetch TMDB metadata.\n' +
      'Set TMDB_READONLY_KEY (the read access token) or TMDB_API_KEY (the v3 API key).\n' +
      'Both are on https://www.themoviedb.org/settings/api.',
  );
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const auth = credential();

  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(auth.query)) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { accept: 'application/json', ...auth.headers } });
  if (!res.ok) {
    // 401 is the one failure that is about the credential rather than the
    // request, and the two key types are easy to swap by mistake — so name the
    // one that was actually sent instead of leaving that to be guessed.
    const because =
      res.status === 401 ? ` — ${auth.label} was rejected; check it is the right key type` : '';
    throw new Error(`TMDB ${path} failed: ${res.status} ${res.statusText}${because}`);
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
