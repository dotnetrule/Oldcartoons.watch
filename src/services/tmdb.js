/**
 * Thin TMDB (The Movie Database) client used to progressively enhance the
 * bundled sample data with real posters/backdrops/synopses. Every call is
 * best-effort: with no API key configured, or on any network/API failure,
 * callers get `null` and are expected to fall back to the static data in
 * src/data/series.js — nothing here ever throws.
 */

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

export const hasTmdbKey = !!API_KEY;

/** Build an absolute image URL for a TMDB poster/backdrop path. `size` is
 * one of TMDB's configured sizes, e.g. 'w500', 'w780', 'original'. */
export function tmdbImageUrl(path, size = 'w500') {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

const searchCache = new Map();
const detailsCache = new Map();
const seasonCache = new Map();

async function tmdbGet(path, params = {}) {
  if (!API_KEY) return null;
  const url = new URL(API_BASE + path);
  url.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Search TMDB's TV catalog for a title and return the best-guess match
 * (first result, optionally narrowed by first-air-year), or null. */
export async function searchTvSeries(title, firstAirYear) {
  if (!API_KEY) return null;
  const cacheKey = title + '|' + (firstAirYear || '');
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey);
  const data = await tmdbGet('/search/tv', { query: title, first_air_date_year: firstAirYear });
  const result = data?.results?.[0] || null;
  searchCache.set(cacheKey, result);
  return result;
}

/** Full TV series details (overview, poster_path, backdrop_path, seasons…). */
export async function getTvSeriesDetails(tmdbId) {
  if (!API_KEY || !tmdbId) return null;
  if (detailsCache.has(tmdbId)) return detailsCache.get(tmdbId);
  const data = await tmdbGet(`/tv/${tmdbId}`);
  detailsCache.set(tmdbId, data);
  return data;
}

/** Episode list for one season of a TV series. */
export async function getTvSeasonEpisodes(tmdbId, seasonNumber) {
  if (!API_KEY || !tmdbId) return null;
  const cacheKey = tmdbId + '|' + seasonNumber;
  if (seasonCache.has(cacheKey)) return seasonCache.get(cacheKey);
  const data = await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}`);
  seasonCache.set(cacheKey, data);
  return data;
}

/** Look up a sample-data series on TMDB and return { posterUrl, backdropUrl,
 * overview } if a confident match is found, otherwise null. Safe to call
 * unconditionally — resolves to null immediately when no API key is set. */
export async function enrichSeriesArtwork(series) {
  if (!API_KEY) return null;
  const match = await searchTvSeries(series.title, series.yearStart);
  if (!match) return null;
  return {
    posterUrl: tmdbImageUrl(match.poster_path, 'w342'),
    backdropUrl: tmdbImageUrl(match.backdrop_path, 'w1280'),
    overview: match.overview || null,
    tmdbId: match.id,
  };
}
