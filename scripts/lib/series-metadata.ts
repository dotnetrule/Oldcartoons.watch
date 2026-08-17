/**
 * Where one series' TMDB-shaped metadata comes from.
 *
 * Four answers, in order of precedence:
 *
 *   a resolved series   → `content/tmdb-episodes/{id}.json`, the real TMDB list
 *   a real TMDB id      → `data/tmdb/{id}.json`, a genuine re-fetchable cache
 *   a seeded id         → `content/tmdb-seed/{id}.json`, playlist-authored
 *   a catalogue listing → `content/historical-series.json`, identity only
 *
 * The first is what makes TMDB leading. Once a series has a reviewed TMDB match
 * and a fetched episode list, that list is the series' shape: real seasons, real
 * numbering, real air dates. A playlist stops authoring the list and becomes what
 * it always was — a pile of videos to match into it. A series with no match is
 * untouched by any of that and keeps the playlist-authored list it has today.
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
import { readJson, seriesMetadataPath, tmdbEpisodesPath } from './paths';

/** A guide listing carries no artwork of its own. */
const NO_IMAGES = { backdrops: [], posters: [] };

/** Scripts that are useful as upstream original-title metadata but not as the
 * primary display name in this Dutch archive. */
const EAST_ASIAN_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;

const hasEastAsianScript = (value: string): boolean => EAST_ASIAN_SCRIPT.test(value);

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
  const resolved = readTmdbEpisodes(source);
  if (resolved) {
    // TMDB knows the episodes. Identity still comes from the guide where there
    // is one — a guide says what the show *is*, and that outranks an upstream
    // record that may be a reboot, a dub or a differently-scoped entry.
    if (!historicalSeed) {
      if (!hasEastAsianScript(resolved.detail.name)) return resolved;

      // TMDB's Dutch response sometimes has no localized display title and
      // falls all the way back to Japanese/Chinese/Korean. The committed seed
      // is the archive's reviewed identity for exactly this placeholder, so
      // keep that familiar name while still taking episodes, dates and artwork
      // from the resolved TMDB record.
      const seededName = readDerivedEpisodes(source)?.detail.name;
      if (!seededName || hasEastAsianScript(seededName)) {
        throw new Error(
          `series '${source.slug}' resolves to '${resolved.detail.name}' and has no curated Latin display name`,
        );
      }
      return {
        ...resolved,
        detail: {
          ...resolved.detail,
          name: seededName,
        },
      };
    }
    return {
      ...resolved,
      detail: {
        ...resolved.detail,
        name: historicalSeed.name,
        overview: historicalSeed.overview,
      },
    };
  }

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

/**
 * The real TMDB episode list for this series, or null when it has none.
 *
 * A file with no episodes counts as none. TMDB carries entries for shows it has
 * registered and not catalogued, and taking one of those as the episode list
 * would replace a working playlist-authored list with an empty one — a series
 * that plays today going dark because an upstream record exists but is bare.
 */
/**
 * Whether TMDB owns this series' episode list.
 *
 * `match.ts` asks because the answer changes what a playlist means for that
 * series: it either authors the episode list or supplies candidates to match
 * into one. `loadSeriesCache` alone cannot say, because it deliberately returns
 * the same shape whichever source answered.
 */
export const isTmdbLed = (source: SeriesSource): boolean => readTmdbEpisodes(source) !== null;

function readTmdbEpisodes(source: SeriesSource): TmdbSeriesCache | null {
  const path = tmdbEpisodesPath(source.tmdbId);
  if (!existsSync(path)) return null;

  const cache = readJson(path) as TmdbSeriesCache;
  if (cache.detail?.id !== source.tmdbId) {
    throw new Error(
      `${path} holds series ${cache.detail?.id}, not ${source.tmdbId} — re-run 'npm run fetch'`,
    );
  }

  const episodes = (cache.seasons ?? []).reduce(
    (total, season) => total + (season.episodes?.length ?? 0),
    0,
  );
  return episodes > 0 ? cache : null;
}
