/**
 * Where a series' metadata comes from, and how to read it.
 *
 * `seriesMetadataPath` in ./paths.ts dispatches on the sign of the id and knows
 * two homes: a real TMDB cache and a committed seed file. There is a third kind
 * of series that has neither, and it has no path at all — a series lifted from
 * an archived programme guide, described by an entry in
 * content/historical-series.json.
 *
 * That third case lives here rather than in paths.ts because it is not a path
 * question. Both readers of series metadata go through this module so the
 * question is answered once: build-data.ts to emit a series file, match.ts to
 * score uploads against an episode list.
 */
import type { HistoricalSeriesSeed, SeriesSource } from '../../src/types';
import { readJson, seriesMetadataPath } from './paths';
import type { TmdbSeriesCache } from './tmdb';

/**
 * The three ways a series can be described.
 *
 * - `tmdb` — a real id, cached under data/tmdb/ by `npm run fetch`.
 * - `seed` — a placeholder id with hand-authored TMDB-shaped metadata committed
 *   under content/tmdb-seed/, so a fresh clone builds without API keys.
 * - `historical-guide` — a title an archived guide proves was broadcast, with no
 *   metadata file of its own.
 */
export type SeriesMetadataOrigin = 'historical-guide' | 'seed' | 'tmdb';

export function seriesMetadataOrigin(
  source: SeriesSource,
  historicalSeed: HistoricalSeriesSeed | undefined,
): SeriesMetadataOrigin {
  if (historicalSeed) return 'historical-guide';
  return source.tmdbId < 0 ? 'seed' : 'tmdb';
}

/**
 * The series' metadata, whichever of the three it is.
 *
 * A guide-derived series comes back with **no seasons**, and that is the honest
 * shape rather than a stub: a programme guide proves that a title was broadcast
 * in a given week, not which episodes ran. So there is no episode list — nothing
 * for `build-data.ts` to render rows from, and nothing for `match.ts` to score
 * uploads against. Both fall through their season loops without a special case,
 * which is the same reason the README gives for `--covers` matching nothing on a
 * placeholder id: the comparison has no other side.
 */
export function loadSeriesCache(
  source: SeriesSource,
  historicalSeed: HistoricalSeriesSeed | undefined,
): TmdbSeriesCache {
  if (historicalSeed) {
    return {
      fetchedAt: 'historical-guide',
      detail: {
        id: source.tmdbId,
        name: historicalSeed.name,
        overview: historicalSeed.overview,
        first_air_date: null,
        last_air_date: null,
        number_of_episodes: 0,
        backdrop_path: null,
        poster_path: null,
        seasons: [],
      },
      seasons: [],
      images: { backdrops: [], posters: [] },
    };
  }
  const path = seriesMetadataPath(source.tmdbId);
  const cache = readJson(path) as TmdbSeriesCache;
  if (cache.detail?.id !== source.tmdbId) {
    throw new Error(
      `${path} holds series ${cache.detail?.id}, not ${source.tmdbId} — re-run 'npm run fetch'`,
    );
  }
  return cache;
}
