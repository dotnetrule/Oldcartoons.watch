/**
 * Step 3 of 3. Merge, validate, split, emit.
 *
 * This is the gate. Every rule the app relies on is enforced here and nowhere
 * else — components carry no defensive checks, because anything that reaches
 * public/data/ has already passed this. The only correct response to a
 * violation is to throw: skipping a bad record ships a quietly smaller archive,
 * and repairing one ships a guess.
 */
import { rmSync } from 'node:fs';
import type {
  Episode,
  IndexFile,
  Network,
  PublicEpisode,
  PublicSeason,
  SeriesFile,
  SeriesSource,
  SeriesStub,
} from '../src/types';
import {
  channelsFileSchema,
  episodesFileSchema,
  indexFileSchema,
  networksFileSchema,
  overridesFileSchema,
  playlistsFileSchema,
  seriesFileSchema,
  seriesSourceFileSchema,
} from '../src/schemas';
import {
  PUBLIC_DATA_DIR,
  contentPath,
  ensureDirs,
  readJson,
  readValidated,
  seriesMetadataPath,
  writeJson,
} from './lib/paths';
import type { TmdbSeriesCache } from './lib/tmdb';

/** The normalized series object an override is merged over. Its key space is
 * exactly the Override key space — that is what makes the "every override key
 * must exist" rule meaningful. */
type BaseSeries = {
  name: string;
  overview: string;
  firstAirYear: number;
  backdrop: string | null;
  networkSlug: string;
};

const yearOf = (isoDate: string | null): number | null => {
  if (!isoDate) return null;
  const year = Number(isoDate.slice(0, 4));
  return Number.isFinite(year) ? year : null;
};

const decadeOf = (year: number): string => `${Math.floor(year / 10) * 10}s`;

function loadCache(source: SeriesSource): TmdbSeriesCache {
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
 * Shallow-merge `{ ...tmdb, ...override }`, but only after proving every
 * override key exists on the base object.
 *
 * An override key that matches nothing is either a typo or a TMDB field that
 * has moved. Both are silent failures — the override just never applies — so
 * they fail the build instead.
 */
function applyOverride(base: BaseSeries, override: Record<string, unknown>, slug: string): BaseSeries {
  for (const key of Object.keys(override)) {
    if (!(key in base)) {
      throw new Error(
        `override for '${slug}' sets '${key}', which does not exist on the series object ` +
          `(valid keys: ${Object.keys(base).join(', ')}) — a typo, or TMDB changed shape`,
      );
    }
  }
  return { ...base, ...override } as BaseSeries;
}

function main(): void {
  const networks: Network[] = readValidated(contentPath('networks.json'), networksFileSchema);
  const seriesSources = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const episodes = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const overrides = readValidated(contentPath('overrides.json'), overridesFileSchema);

  // The ingest whitelists are not inputs to this step, but they are hand-edited
  // and nothing else in a normal build would look at them — a bad edit would
  // otherwise sit unnoticed until the next `npm run fetch`. Validating them
  // here makes `npm run build` a total gate over content/.
  readValidated(contentPath('channels.json'), channelsFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);

  const networkSlugs = new Set(networks.map((n) => n.slug));
  const seriesByTmdbId = new Map(seriesSources.map((s) => [s.tmdbId, s]));
  const seriesSlugs = new Set(seriesSources.map((s) => s.slug));

  for (const source of seriesSources) {
    if (!networkSlugs.has(source.networkSlug)) {
      throw new Error(`series '${source.slug}' references unknown network '${source.networkSlug}'`);
    }
  }

  // A playlist scoped to a series that does not exist matches nothing, which
  // looks identical to a playlist that simply had no hits.
  for (const playlist of playlists) {
    const unknown = playlist.covers.filter((slug) => !seriesSlugs.has(slug));
    if (unknown.length > 0) {
      throw new Error(
        `playlist '${playlist.name ?? playlist.id}' (${playlist.id}) covers unknown series: ${unknown.join(', ')}`,
      );
    }
  }

  for (const tmdbId of Object.keys(overrides)) {
    if (!seriesByTmdbId.has(Number(tmdbId))) {
      throw new Error(`override keyed ${tmdbId} matches no series in content/series.json`);
    }
  }

  // Index episodes by series so each series file is a single pass, and so an
  // episode pointing at a series that no longer exists is caught rather than
  // silently dropped.
  const episodesBySeries = new Map<number, Episode[]>();
  for (const episode of episodes) {
    if (!seriesByTmdbId.has(episode.seriesId)) {
      throw new Error(
        `content/episodes.json has S${episode.season}E${episode.episode} for series ${episode.seriesId}, ` +
          `which is not in content/series.json`,
      );
    }
    const bucket = episodesBySeries.get(episode.seriesId);
    if (bucket) bucket.push(episode);
    else episodesBySeries.set(episode.seriesId, [episode]);
  }

  // public/data/ is generated in full every run; leaving stale series files
  // behind would serve routes that the index no longer lists.
  rmSync(PUBLIC_DATA_DIR, { recursive: true, force: true });
  ensureDirs(PUBLIC_DATA_DIR);

  const stubs: SeriesStub[] = [];
  const decades = new Set<string>();

  for (const source of seriesSources) {
    const cache = loadCache(source);
    const { detail } = cache;

    const firstAirYear = yearOf(detail.first_air_date);
    if (firstAirYear === null) {
      throw new Error(`series '${source.slug}' has no usable first_air_date — the schedule grid needs a decade`);
    }

    const base = applyOverride(
      {
        name: detail.name,
        overview: detail.overview,
        firstAirYear,
        backdrop: detail.backdrop_path,
        networkSlug: source.networkSlug,
      },
      overrides[String(source.tmdbId)] ?? {},
      source.slug,
    );

    if (!networkSlugs.has(base.networkSlug)) {
      throw new Error(`override for '${source.slug}' sets unknown network '${base.networkSlug}'`);
    }

    const statusByEpisode = new Map(
      (episodesBySeries.get(source.tmdbId) ?? []).map((ep) => [`${ep.season}:${ep.episode}`, ep]),
    );

    const seasons: PublicSeason[] = [];
    let availableCount = 0;

    for (const season of cache.seasons) {
      const publicEpisodes: PublicEpisode[] = season.episodes.map((episode) => {
        const record = statusByEpisode.get(`${episode.season_number}:${episode.episode_number}`);
        statusByEpisode.delete(`${episode.season_number}:${episode.episode_number}`);

        if (record && record.status !== 'missing') availableCount += 1;

        return {
          season: episode.season_number,
          episode: episode.episode_number,
          // TMDB leaves untitled episodes blank; the row still has to say
          // something, and the number is the only honest thing to say.
          title: episode.name || `Episode ${episode.episode_number}`,
          airDate: episode.air_date || null,
          runtime: episode.runtime && episode.runtime > 0 ? episode.runtime : null,
          // No record at all means nobody has looked for this episode yet,
          // which reads the same way to a viewer as looking and finding
          // nothing: a gap.
          status: record?.status ?? 'missing',
          youtubeId: record?.youtubeId ?? null,
          still: episode.still_path,
        };
      });

      if (publicEpisodes.length === 0) continue;

      seasons.push({
        season: season.season_number,
        name: season.name || `Season ${season.season_number}`,
        episodes: publicEpisodes,
      });
    }

    // Anything left over points at a season/episode TMDB no longer lists.
    if (statusByEpisode.size > 0) {
      const orphans = [...statusByEpisode.keys()].map((k) => `S${k.replace(':', 'E')}`).join(', ');
      throw new Error(
        `content/episodes.json has entries for '${source.slug}' that TMDB does not list: ${orphans}`,
      );
    }

    seasons.sort((a, b) => a.season - b.season);

    const lastAirYear = yearOf(detail.last_air_date) ?? firstAirYear;
    const decade = decadeOf(base.firstAirYear);
    decades.add(decade);

    const seriesFile: SeriesFile = {
      slug: source.slug,
      tmdbId: source.tmdbId,
      name: base.name,
      overview: base.overview,
      networkSlug: base.networkSlug,
      type: source.type,
      age: source.age,
      firstAirYear: base.firstAirYear,
      lastAirYear: Math.max(lastAirYear, base.firstAirYear),
      firstAirDate: detail.first_air_date,
      decade,
      episodeCount: detail.number_of_episodes,
      availableCount,
      backdrop: base.backdrop,
      poster: detail.poster_path,
      seasons,
    };

    writeJson(`${PUBLIC_DATA_DIR}/series-${source.slug}.json`, seriesFileSchema.parse(seriesFile));

    stubs.push({
      slug: seriesFile.slug,
      name: seriesFile.name,
      overview: seriesFile.overview,
      networkSlug: seriesFile.networkSlug,
      type: seriesFile.type,
      age: seriesFile.age,
      firstAirYear: seriesFile.firstAirYear,
      lastAirYear: seriesFile.lastAirYear,
      firstAirDate: seriesFile.firstAirDate,
      decade: seriesFile.decade,
      episodeCount: seriesFile.episodeCount,
      availableCount: seriesFile.availableCount,
      poster: seriesFile.poster,
    });
  }

  const index: IndexFile = {
    generatedAt: new Date().toISOString(),
    networks: [...networks].sort((a, b) => a.channelNumber - b.channelNumber),
    decades: [...decades].sort(),
    series: stubs.sort((a, b) => a.firstAirYear - b.firstAirYear || a.name.localeCompare(b.name)),
  };

  writeJson(`${PUBLIC_DATA_DIR}/index.json`, indexFileSchema.parse(index));

  const playable = stubs.reduce((total, s) => total + s.availableCount, 0);
  console.log(
    `emitted index.json + ${stubs.length} series files — ` +
      `${networks.length} networks, ${index.decades.join('/')}, ${playable} playable episodes`,
  );
}

main();
