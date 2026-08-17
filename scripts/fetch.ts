/**
 * Step 1 of 3. Fills the disposable cache under data/ from the two upstream
 * APIs. Writes forward only — nothing here reads or mutates content/.
 *
 * Quota: 10,000 units/day. channels.list and playlistItems.list cost 1 unit
 * per call, so a full refetch of thirty channels lands well under a thousand.
 */
import { existsSync } from 'node:fs';
import type {
  HistoricalSeriesSeed,
  SeriesSource,
  TmdbMetadataFile,
} from '../src/types';
import {
  channelsFileSchema,
  historicalSeriesSeedsFileSchema,
  isPlaceholderTmdbId,
  playlistsFileSchema,
  seriesSourceFileSchema,
  tmdbMetadataFileSchema,
  videoSetsFileSchema,
} from '../src/schemas';
import {
  CONTENT_DIR,
  TMDB_CACHE_DIR,
  TMDB_EPISODES_DIR,
  YOUTUBE_CACHE_DIR,
  contentPath,
  ensureDirs,
  readJson,
  readValidated,
  seriesMetadataPath,
  tmdbEpisodesPath,
  writeJson,
  youtubeCachePath,
} from './lib/paths';
import {
  getExternalIds,
  getImages,
  getSeason,
  getSeriesDetail,
  hasTmdbCredential,
  type TmdbSeason,
  type TmdbSeriesCache,
} from './lib/tmdb';
import { SERIES_MAX_FIRST_AIR_YEAR, isSeriesInScope, yearOfDate } from './lib/cutoff';
import { DEFAULT_MAX_AGE_HOURS, freshnessLabel, isFresh } from './lib/freshness';
import {
  getUploadsPlaylistId,
  listPlaylistVideos,
  listVideos,
  type YoutubeVideo,
} from './lib/youtube';

/** One cached source dump under data/youtube/{id}.json. */
export type YoutubeSourceCache = {
  fetchedAt: string;
  kind: 'channel' | 'playlist' | 'videos';
  id: string;
  name: string;
  /** Series slugs a playlist is scoped to; empty for channels, which are not
   * scoped because a rights-holder channel only carries its own material. */
  covers: string[];
  videos: YoutubeVideo[];
};

/** The cache file a hand-picked set is written to. It is keyed by the series
 * rather than by a source id, because the set has no id of its own — the
 * series it fills in is the only name it has. */
const videoSetCacheId = (slug: string): string => `videoset-${slug}`;

async function fetchYoutube(maxAgeHours: number): Promise<void> {
  const channels = readValidated(contentPath('channels.json'), channelsFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);
  const videoSets = readValidated(contentPath('videos.json'), videoSetsFileSchema);

  if (channels.length === 0 && playlists.length === 0 && videoSets.length === 0) {
    console.log('no YouTube sources whitelisted yet — skipping YouTube fetch');
    return;
  }

  for (const channel of channels) {
    const cachePath = youtubeCachePath(channel.id);
    if (isFresh(cachePath, maxAgeHours)) {
      console.log(`  channel ${channel.name}: cached ${freshnessLabel(cachePath)} — skipping`);
      continue;
    }

    let videos: YoutubeVideo[];
    try {
      const uploads = await getUploadsPlaylistId(channel.id);
      videos = await listPlaylistVideos(uploads);
    } catch (error) {
      // One channel that cannot be read this run — network trouble, the page
      // shape moving on — must not take every other source down with it. Its
      // cache file is simply not rewritten, so match.ts sees the same dump
      // (or none) it saw last time and leaves that series exactly as it was.
      console.warn(
        `  channel ${channel.name}: could not be read (${(error as Error).message.split('\n')[0]}) ` +
          `— skipping this run, its episodes stay as they were`,
      );
      continue;
    }
    const cache: YoutubeSourceCache = {
      fetchedAt: new Date().toISOString(),
      kind: 'channel',
      id: channel.id,
      name: channel.name,
      covers: [],
      videos,
    };
    writeJson(youtubeCachePath(channel.id), cache);
    console.log(`  channel ${channel.name}: ${videos.length} uploads`);
  }

  // Third-party playlists ingest through the identical path — same endpoint,
  // same per-page cost. Only the recorded provenance differs, and that is what
  // lets a rotting source be identified and dropped as a unit later.
  for (const playlist of playlists) {
    const cachePath = youtubeCachePath(playlist.id);
    if (isFresh(cachePath, maxAgeHours)) {
      console.log(
        `  playlist ${playlist.name ?? playlist.id}: cached ${freshnessLabel(cachePath)} — skipping`,
      );
      continue;
    }

    let videos: YoutubeVideo[];
    try {
      videos = await listPlaylistVideos(playlist.id);
    } catch (error) {
      // Same reasoning as a channel: one rotting or temporarily unreadable
      // playlist among dozens must not abort the whole run. match.ts already
      // knows how to leave a series alone when its source has nothing new to
      // say — this is what puts it in that position instead of crashing here.
      console.warn(
        `  playlist ${playlist.name ?? playlist.id}: could not be read (${(error as Error).message.split('\n')[0]}) ` +
          `— skipping this run, its episodes stay as they were`,
      );
      continue;
    }
    const cache: YoutubeSourceCache = {
      fetchedAt: new Date().toISOString(),
      kind: 'playlist',
      id: playlist.id,
      name: playlist.name ?? playlist.id,
      covers: playlist.covers,
      videos,
    };
    writeJson(youtubeCachePath(playlist.id), cache);
    const credit = playlist.curator ? ` (${playlist.curator})` : ' (unattributed)';
    console.log(`  playlist ${playlist.name ?? playlist.id}${credit}: ${videos.length} videos`);
  }

  // Hand-picked sets. Order is given rather than read, so an id that resolves
  // to nothing is reported and skipped: numbering an episode around a video
  // nobody can play would ship a row that renders as available and is not.
  for (const set of videoSets) {
    const cachePath = youtubeCachePath(videoSetCacheId(set.episodesFor));
    if (isFresh(cachePath, maxAgeHours)) {
      console.log(`  video set ${set.episodesFor}: cached ${freshnessLabel(cachePath)} — skipping`);
      continue;
    }

    const resolved = await listVideos(set.videos);

    const videos = resolved.filter((video): video is YoutubeVideo => video !== null);
    const missing = set.videos.filter((_, index) => resolved[index] === null);
    if (missing.length > 0) {
      console.warn(
        `  video set ${set.episodesFor}: ${missing.length} of ${set.videos.length} could not be read ` +
          `(${missing.join(', ')}) — private, removed or region-blocked from here`,
      );
    }

    // Every video unreadable is a fact about this run, not about the archive —
    // the same thing an unreachable channel or playlist says, and it gets the
    // same answer: leave the previous dump alone. Writing an empty one here
    // would stamp a failure as a successful read, and the freshness check above
    // would then decline to retry it for a whole day.
    if (videos.length === 0 && set.videos.length > 0) {
      console.warn(
        `  video set ${set.episodesFor}: none of its ${set.videos.length} videos could be read ` +
          `— skipping this run, its episodes stay as they were`,
      );
      continue;
    }

    const cache: YoutubeSourceCache = {
      fetchedAt: new Date().toISOString(),
      kind: 'videos',
      id: videoSetCacheId(set.episodesFor),
      name: `losse afleveringen voor ${set.episodesFor}`,
      covers: [set.episodesFor],
      videos,
    };
    writeJson(youtubeCachePath(cache.id), cache);
    console.log(`  video set ${set.episodesFor}: ${videos.length} videos`);
  }
}

/**
 * Which real TMDB id, if any, stands behind a series' placeholder id.
 *
 * Every series in this archive is keyed by a negative placeholder, so the id in
 * `content/series.json` is never something TMDB can answer for. The mapping is
 * whatever `npm run enrich-tmdb` reviewed and wrote down. A series with no
 * entry has not been matched — that is the ordinary state of a catalogue
 * listing, not an error, and it keeps whatever episode list a playlist gave it.
 */
function resolveTmdbId(
  source: SeriesSource,
  metadata: TmdbMetadataFile,
): number | null {
  if (!isPlaceholderTmdbId(source.tmdbId)) return source.tmdbId;
  return metadata.matches[String(source.tmdbId)]?.tmdbId ?? null;
}

/**
 * The first air year the era gate is measured against.
 *
 * Taken from the same three places `build-data.ts` reads identity from, in the
 * same order, so a series cannot be in period for one and out for the other.
 */
function firstAirYearOf(
  source: SeriesSource,
  historicalSeed: HistoricalSeriesSeed | undefined,
  metadata: TmdbMetadataFile,
): number | null {
  if (historicalSeed) return historicalSeed.firstAirYear;
  const matched = metadata.matches[String(source.tmdbId)];
  const fromMatch = yearOfDate(matched?.firstAirDate);
  if (fromMatch !== null) return fromMatch;

  const seedPath = seriesMetadataPath(source.tmdbId);
  if (!existsSync(seedPath)) return null;
  const seed = readJson(seedPath) as { detail?: { first_air_date?: string | null } };
  return yearOfDate(seed.detail?.first_air_date);
}

async function fetchTmdb(only: string[] | null, maxAgeHours: number): Promise<void> {
  const all = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const metadata = readValidated(contentPath('tmdb-metadata.json'), tmdbMetadataFileSchema);
  const historicalById = new Map(
    readValidated(contentPath('historical-series.json'), historicalSeriesSeedsFileSchema).map(
      (seed) => [seed.tmdbId, seed] as const,
    ),
  );

  if (only) {
    const known = new Set(all.map((s) => s.slug));
    const unknown = only.filter((slug) => !known.has(slug));
    if (unknown.length > 0) {
      throw new Error(`--series names slugs not in content/series.json: ${unknown.join(', ')}`);
    }
  }

  const selected = only ? all.filter((s) => only.includes(s.slug)) : all;

  let fetched = 0;
  let reused = 0;
  let unmatched = 0;
  let outOfPeriod = 0;

  for (const entry of selected) {
    // The era gate, before any request. A series that began after the ceiling
    // is not part of this archive; nothing is spent asking TMDB about it.
    if (!isSeriesInScope(firstAirYearOf(entry, historicalById.get(entry.tmdbId), metadata))) {
      outOfPeriod += 1;
      continue;
    }

    // No reviewed match means TMDB has nothing to say about this series under
    // an id anyone has checked. Guessing one here is exactly what enrich-tmdb
    // exists to do carefully, so this declines to do it carelessly.
    const tmdbId = resolveTmdbId(entry, metadata);
    if (tmdbId === null) {
      unmatched += 1;
      continue;
    }

    const cachePath = tmdbEpisodesPath(entry.tmdbId);
    if (isFresh(cachePath, maxAgeHours)) {
      reused += 1;
      continue;
    }

    const detail = await getSeriesDetail(tmdbId, 'nl-NL');

    // Season 0 is TMDB's specials bucket; it is a real part of the archive and
    // is fetched like any other.
    const seasons: TmdbSeason[] = [];
    for (const season of detail.seasons) {
      seasons.push(await getSeason(tmdbId, season.season_number));
    }

    const [images, externalIds] = await Promise.all([getImages(tmdbId), getExternalIds(tmdbId)]);

    // Every id downstream is the placeholder, because that is what
    // content/series.json and content/episodes.json are keyed by. `tmdbId`
    // below is the one field that remembers where this came from — overwriting
    // detail.id with the upstream id would break every identity check in
    // loadSeriesCache.
    const cache: TmdbSeriesCache = {
      fetchedAt: new Date().toISOString(),
      detail: { ...detail, id: entry.tmdbId },
      seasons: seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => ({
          ...episode,
          // Preserve any IMDb id an earlier bounded pass already read, so a
          // metadata refresh does not throw that work away.
          imdbId: episode.imdbId,
        })),
      })),
      images,
      imdbId: externalIds.imdb_id || null,
      tmdbId,
    };
    writeJson(cachePath, mergeEpisodeImdbIds(cachePath, cache));

    fetched += 1;
    const episodeCount = seasons.reduce((total, s) => total + s.episodes.length, 0);
    console.log(
      `  ${entry.slug}: ${seasons.length} seasons, ${episodeCount} episodes (TMDB ${tmdbId})`,
    );
  }

  const notes = [
    `${fetched} fetched`,
    reused > 0 ? `${reused} still fresh` : null,
    unmatched > 0 ? `${unmatched} without a reviewed TMDB match` : null,
    outOfPeriod > 0 ? `${outOfPeriod} after ${SERIES_MAX_FIRST_AIR_YEAR}` : null,
  ].filter(Boolean);
  console.log(`  ${notes.join(', ')}`);
}

/**
 * Carry forward the per-episode IMDb ids a previous run read.
 *
 * They cost one request each and are gathered by a separate bounded pass, so a
 * routine metadata refresh must not discard them. Matched on season/episode
 * number rather than position, because TMDB can insert an episode.
 */
function mergeEpisodeImdbIds(cachePath: string, fresh: TmdbSeriesCache): TmdbSeriesCache {
  if (!existsSync(cachePath)) return fresh;

  const previous = readJson(cachePath) as TmdbSeriesCache;
  const known = new Map<string, string | null | undefined>();
  for (const season of previous.seasons ?? []) {
    for (const episode of season.episodes ?? []) {
      if (episode.imdbId !== undefined) {
        known.set(`${episode.season_number}:${episode.episode_number}`, episode.imdbId);
      }
    }
  }
  if (known.size === 0) return fresh;

  return {
    ...fresh,
    seasons: fresh.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => {
        const carried = known.get(`${episode.season_number}:${episode.episode_number}`);
        return carried === undefined ? episode : { ...episode, imdbId: carried };
      }),
    })),
  };
}

/** `--series slug,slug` limits the TMDB half of the run. Absent, every series
 * is fetched, exactly as before. */
function parseSeriesFilter(argv: string[]): string[] | null {
  const index = argv.findIndex((arg) => arg === '--series' || arg.startsWith('--series='));
  if (index === -1) return null;

  const arg = argv[index];
  const inline = arg?.startsWith('--series=') ? arg.slice('--series='.length) : argv[index + 1];
  if (!inline || inline.startsWith('--')) throw new Error('--series needs a value');

  const slugs = inline
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (slugs.length === 0) throw new Error('--series listed no slugs');
  return slugs;
}

/**
 * How old a cached dump may be before it is read again, in hours.
 *
 * `--force` is the same statement as `--max-age-hours 0` and is spelled out
 * because that is what a person reaches for. The environment variable exists so
 * a workflow can set the policy once rather than repeating a flag on every step.
 */
function parseMaxAgeHours(argv: string[]): number {
  if (argv.includes('--force')) return 0;

  const index = argv.findIndex(
    (arg) => arg === '--max-age-hours' || arg.startsWith('--max-age-hours='),
  );
  const raw =
    index === -1
      ? process.env.FETCH_MAX_AGE_HOURS
      : argv[index]?.startsWith('--max-age-hours=')
        ? argv[index].slice('--max-age-hours='.length)
        : argv[index + 1];

  if (raw === undefined || raw === '') return DEFAULT_MAX_AGE_HOURS;
  if (raw.startsWith('--')) throw new Error('--max-age-hours needs a value');

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`--max-age-hours needs a non-negative number, got '${raw}'`);
  }
  return hours;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = parseSeriesFilter(argv);
  // Skips the TMDB half outright. It used to be the only way to run at all —
  // every series carried a placeholder id and the TMDB half refused those — and
  // it now means what it says: read the video sources and leave the episode
  // lists alone.
  const youtubeOnly = argv.includes('--youtube-only');
  const maxAgeHours = parseMaxAgeHours(argv);

  if (youtubeOnly && only) {
    throw new Error('--youtube-only and --series contradict each other: one skips TMDB, the other scopes it');
  }

  ensureDirs(CONTENT_DIR, TMDB_CACHE_DIR, TMDB_EPISODES_DIR, YOUTUBE_CACHE_DIR);

  console.log(
    maxAgeHours > 0
      ? `fetching YouTube sources… (reusing dumps under ${maxAgeHours}h old)`
      : 'fetching YouTube sources… (--force: ignoring cached dumps)',
  );
  await fetchYoutube(maxAgeHours);

  if (youtubeOnly) {
    console.log('skipping TMDB (--youtube-only)');
  } else if (!hasTmdbCredential()) {
    // The safe fallback. content/tmdb-episodes/ is committed, so an archive
    // built without a credential still has every episode list it had at the
    // last successful fetch — it simply does not learn anything new.
    console.log(
      'no TMDB credential set — keeping the committed episode lists in content/tmdb-episodes/.\n' +
        '  Set TMDB_API_TOKEN to refresh them; the build needs no key either way.',
    );
  } else {
    console.log(only ? `fetching TMDB metadata for ${only.join(', ')}…` : 'fetching TMDB metadata…');
    await fetchTmdb(only, maxAgeHours);
  }

  console.log('done — cache written to data/ and content/tmdb-episodes/');
}

await main();
