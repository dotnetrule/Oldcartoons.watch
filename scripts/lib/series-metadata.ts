/**
 * Where one series' TMDB-shaped metadata comes from.
 *
 * There are three kinds of series in `content/series.json` and they answer that
 * question differently:
 *
 *   a real TMDB id      → `data/tmdb/{id}.json`, a genuine re-fetchable cache
 *   a seeded id         → `content/tmdb-seed/{id}.json`, hand-authored source
 *   a catalogue listing → `content/historical-series.json`, identity only
 *
 * The third kind is a title lifted from a historical Dutch TV guide: the name,
 * the description and the years it ran are known, and nothing about its
 * episodes is. It used to follow that such a series could never hold episodes,
 * because `match.ts` looked for a seed file that was never going to exist.
 *
 * That conflated two separate facts. A guide says what the show *is*; a curated
 * playlist says what its episodes *are*. So a listing keeps its identity from
 * the guide and picks up an episode list from the seed file once a playlist has
 * authored one — and carries an empty one until then, exactly as before.
 *
 * Both `build-data.ts` and `match.ts` resolve a series through here, because a
 * series that matched against one metadata source and rendered from another
 * would be two different shows wearing one slug.
 */
import { existsSync } from 'node:fs';
import type { HistoricalSeriesSeed, SeriesSource } from '../../src/types';
import type { TmdbSeriesCache } from './tmdb';
import { readJson, seriesMetadataPath } from './paths';

/** A guide listing carries no artwork of its own. */
const NO_IMAGES = { backdrops: [], posters: [] };

/**
 * A catalogue listing's metadata: identity from the guide, episodes from the
 * seed file if a playlist has written one.
 *
 * The guide always wins on identity. A playlist knows the order of a show's
 * episodes; it does not know the show, so nothing it writes may overrule the
 * name, description or years the guide recorded.
 */
function historicalCache(source: SeriesSource, seed: HistoricalSeriesSeed): TmdbSeriesCache {
  const derived = readDerivedEpisodes(source);
  return {
    fetchedAt: derived?.fetchedAt ?? 'historical-guide',
    detail: {
      id: source.tmdbId,
      name: seed.name,
      overview: seed.overview,
      // The guide records a year, not a date. Inventing 1 January to fill the
      // shape would be a date nobody has evidence for, so this stays null and
      // build-data reads the year off the seed instead.
      first_air_date: null,
      last_air_date: null,
      number_of_episodes: derived?.detail.number_of_episodes ?? 0,
      backdrop_path: null,
      poster_path: null,
      seasons: derived?.detail.seasons ?? [],
    },
    seasons: derived?.seasons ?? [],
    images: derived?.images ?? NO_IMAGES,
  };
}

/**
 * The seed file for a catalogue listing, or null when no playlist has authored
 * one yet.
 *
 * This is the one place a missing file is not an error. Everywhere else a
 * missing input means the pipeline was run out of order; here it means the
 * ordinary state of a listing that names a show and indexes none of it.
 */
function readDerivedEpisodes(source: SeriesSource): TmdbSeriesCache | null {
  const path = seriesMetadataPath(source.tmdbId);
  if (!existsSync(path)) return null;
  const cache = readJson(path) as TmdbSeriesCache;
  if (cache.detail?.id !== source.tmdbId) {
    throw new Error(`${path} holds series ${cache.detail?.id}, not ${source.tmdbId}`);
  }
  return cache;
}

/**
 * Resolve a series to the metadata every downstream step reads.
 *
 * `historicalSeed` is the series' entry in `content/historical-series.json`, or
 * undefined when it has none. A series without one must have a metadata file:
 * that is a resolved series, and a missing file there is a pipeline that was
 * run out of order rather than a show nobody has indexed yet.
 */
export function loadSeriesCache(
  source: SeriesSource,
  historicalSeed: HistoricalSeriesSeed | undefined,
): TmdbSeriesCache {
  if (historicalSeed) return historicalCache(source, historicalSeed);

  const path = seriesMetadataPath(source.tmdbId);
  const cache = readJson(path) as TmdbSeriesCache;
  if (cache.detail?.id !== source.tmdbId) {
    throw new Error(
      `${path} holds series ${cache.detail?.id}, not ${source.tmdbId} — re-run 'npm run fetch'`,
    );
  }
  return cache;
}
