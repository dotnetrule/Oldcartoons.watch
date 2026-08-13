/**
 * Step 2 of 3. Scores every cached upload against every cached TMDB episode,
 * per series. Confident matches go straight to content/episodes.json; the rest
 * go to content/queue.json for a human in the admin.
 *
 * Roughly 60% resolving automatically is the expected outcome. The remaining
 * 40% is manual and that is fine — heuristics chasing the tail cost more to
 * maintain than the keystrokes they save.
 *
 * Existing entries in episodes.json are never overwritten: a human decision,
 * or a status the health check has already corrected, outranks a fresh guess.
 *
 * A series whose episode list a playlist owns (`episodesFor` in
 * content/playlists.json) skips all of that. There is nothing to score, because
 * the playlist supplies both the episodes and the videos — see
 * lib/playlist-episodes.ts.
 */
import { readdirSync } from 'node:fs';
import type {
  Episode,
  EpisodeSource,
  HistoricalSeriesSeed,
  PlaylistSource,
  QueueCandidate,
  QueueEntry,
  SeriesSource,
  VideoSetSource,
} from '../src/types';
import {
  episodesFileSchema,
  historicalSeriesSeedsFileSchema,
  playlistsFileSchema,
  queueFileSchema,
  seriesSourceFileSchema,
  videoSetsFileSchema,
} from '../src/schemas';
import {
  YOUTUBE_CACHE_DIR,
  contentPath,
  readJson,
  readValidated,
  seriesMetadataPath,
  writeJson,
} from './lib/paths';
import { loadSeriesCache } from './lib/series-metadata';
import { CONFIDENCE_THRESHOLD, scoreMatch } from './lib/similarity';
import { derivePlaylistSeries } from './lib/playlist-episodes';
import type { YoutubeSourceCache } from './fetch';

/** How many ranked candidates a queue entry carries. Enough to choose from,
 * few enough to scan without scrolling — the admin is built for one decision
 * per keystroke. */
const MAX_CANDIDATES = 6;

function loadYoutubeSources(): YoutubeSourceCache[] {
  let files: string[];
  try {
    files = readdirSync(YOUTUBE_CACHE_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  return files.map((file) => readJson(`${YOUTUBE_CACHE_DIR}/${file}`) as YoutubeSourceCache);
}

/**
 * Whatever owns a series' episode list outright: a playlist that is the list,
 * or a hand-picked set of videos that is.
 */
type EpisodeListOwner =
  | { kind: 'playlist'; playlist: PlaylistSource }
  | { kind: 'videos'; set: VideoSetSource };

/** Where the cached dump for this owner was written by `fetch`. */
const ownerCacheId = (owner: EpisodeListOwner): string =>
  owner.kind === 'playlist' ? owner.playlist.id : `videoset-${owner.set.episodesFor}`;

/** How the owner reads in a log line or an error. */
const ownerLabel = (owner: EpisodeListOwner): string =>
  owner.kind === 'playlist'
    ? `playlist '${owner.playlist.name ?? owner.playlist.id}' (${owner.playlist.id})`
    : `the hand-picked video set for '${owner.set.episodesFor}'`;

/**
 * Rebuild a source-backed series from the source that owns its episode list,
 * writing the regenerated metadata seed and returning the episode records.
 *
 * These records are not decisions in the sense the fuzzy path means. The
 * ordering is the decision, it lives in the source, and it is re-read on every
 * run — so unlike a matched or hand-resolved episode, a derived one is
 * replaced rather than preserved. That is what lets a playlist gaining or
 * reordering episodes, or a video added to a set, show up by re-running the
 * pipeline.
 */
function rebuildFromSource(
  source: SeriesSource,
  owner: EpisodeListOwner,
  historicalSeed: HistoricalSeriesSeed | undefined,
  youtubeSources: YoutubeSourceCache[],
  today: string,
): Episode[] | null {
  const cacheId = ownerCacheId(owner);
  const dump = youtubeSources.find((yt) => yt.id === cacheId);
  if (!dump) {
    throw new Error(
      `${ownerLabel(owner)} owns the episode list for '${source.slug}' ` +
        `but has not been fetched — run 'npm run fetch' first`,
    );
  }

  // A playlist that cached nothing means the fetch went wrong: the reader
  // throws on an unreadable playlist rather than returning an empty one, so
  // zero items is a state that should not exist and is worth failing on.
  //
  // A hand-picked set is different. `fetch` resolves its videos one at a time
  // and deliberately keeps what it got, so an empty set means every one of
  // them was unreadable from that machine — a fact about the run, not about
  // the archive. Saying so and moving on leaves the other sources to ingest
  // and leaves any episodes a previous run derived exactly where they are.
  if (owner.kind === 'videos' && dump.videos.length === 0) {
    console.warn(
      `  ${source.slug}: none of the ${owner.set.videos.length} hand-picked videos could be read — ` +
        `leaving the episode list as it was`,
    );
    return null;
  }

  const seedPath = seriesMetadataPath(source.tmdbId);
  const existing = loadSeriesCache(source, historicalSeed);

  const { cache, episodes } = derivePlaylistSeries({
    source,
    seriesName: existing.detail.name,
    existing,
    videos: dump.videos,
    origin:
      owner.kind === 'playlist'
        ? { kind: 'playlist', id: owner.playlist.id }
        : { kind: 'videos', label: owner.set.episodesFor },
    today,
  });

  writeJson(seedPath, cache);
  console.log(
    owner.kind === 'playlist'
      ? `  ${source.slug}: ${episodes.length} episodes from playlist '${owner.playlist.name ?? owner.playlist.id}'` +
          (owner.playlist.curator ? ` by ${owner.playlist.curator}` : '')
      : `  ${source.slug}: ${episodes.length} episodes from ${episodes.length === 1 ? 'a hand-picked video' : 'hand-picked videos'}`,
  );
  return episodes;
}

function main(): void {
  const seriesSources = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const existing = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);
  const videoSets = readValidated(contentPath('videos.json'), videoSetsFileSchema);
  const youtubeSources = loadYoutubeSources();
  // A series lifted from a historical TV guide has its identity here rather
  // than in a metadata file; loadSeriesCache needs it to answer for that series
  // at all, whether the answer is an empty episode list or one a playlist wrote.
  const historicalSeedById = new Map<number, HistoricalSeriesSeed>(
    readValidated(contentPath('historical-series.json'), historicalSeriesSeedsFileSchema).map(
      (seed) => [seed.tmdbId, seed],
    ),
  );

  const today = new Date().toISOString().slice(0, 10);

  // A series whose episode list a curated source owns does not go through
  // matching at all: there is nothing to match, because the source authors
  // both sides of the pairing.
  const episodeListOwner = new Map<string, EpisodeListOwner>([
    ...playlists.flatMap((playlist) =>
      playlist.episodesFor === null
        ? []
        : [[playlist.episodesFor, { kind: 'playlist', playlist }] as const],
    ),
    ...videoSets.map((set) => [set.episodesFor, { kind: 'videos', set }] as const),
  ]);

  // Two sources both claiming to author one series' list would mean two
  // orderings, and there is no correct way to merge them. Each file rejects
  // its own duplicates; only a clash across the two can reach here.
  for (const set of videoSets) {
    const playlist = playlists.find((p) => p.episodesFor === set.episodesFor);
    if (playlist) {
      throw new Error(
        `'${set.episodesFor}' has its episode list claimed by both a video set and playlist ` +
          `${playlist.id} — one series, one list. Drop one of the two.`,
      );
    }
  }

  const derived: Episode[] = [];
  const derivedSeries = new Set<number>();

  for (const source of seriesSources) {
    const owner = episodeListOwner.get(source.slug);
    if (!owner) continue;
    const episodes = rebuildFromSource(
      source,
      owner,
      historicalSeedById.get(source.tmdbId),
      youtubeSources,
      today,
    );
    // Null is "this source had nothing to say this run". Leaving the series
    // out of `derivedSeries` is what preserves whatever it already had.
    if (episodes === null) continue;
    derived.push(...episodes);
    derivedSeries.add(source.tmdbId);
  }

  // The old records for a derived series are discarded, not merged: the
  // playlist just restated the whole list, and keeping a record from a
  // previous ordering would leave an episode pointing at the wrong video.
  const preserved = existing.filter((ep) => !derivedSeries.has(ep.seriesId));

  // A record in episodes.json means a decision was made about that episode —
  // auto-matched here, chosen by a human in the admin, or corrected by the
  // health check — and a decision is final. Absence means nobody has looked
  // yet, which is the only state matching is allowed to act on.
  //
  // Nothing may write a placeholder record for an unexamined episode. Doing so
  // marks it decided and silently excludes it from every future match run;
  // build-data.ts already renders a record-less episode as a gap, so a
  // placeholder buys nothing and costs the episode its chance of being found.
  const decided = new Set(
    [...preserved, ...derived].map((ep) => `${ep.seriesId}:${ep.season}:${ep.episode}`),
  );

  const added: Episode[] = [];
  const queue: QueueEntry[] = [];

  for (const source of seriesSources) {
    if (episodeListOwner.has(source.slug)) continue;

    const cache = loadSeriesCache(source, historicalSeedById.get(source.tmdbId));

    // A channel carries only its rights-holder's material, so it is open to
    // every series. A playlist is scoped by its `covers` list, which stops a
    // third-party playlist from pulling in series it has no business matching.
    //
    // A hand-picked set never joins the pool. It is already the whole episode
    // list of the one series it names, and that series left this loop at the
    // top — so the only thing scoring its videos here could do is offer them
    // to some other show.
    const pool = youtubeSources
      .filter((yt): yt is YoutubeSourceCache & { kind: 'channel' | 'playlist' } => yt.kind !== 'videos')
      .filter((yt) => yt.kind === 'channel' || yt.covers.includes(source.slug))
      .flatMap((yt) =>
        yt.videos.map((video) => ({
          video,
          provenance: { kind: yt.kind, id: yt.id } satisfies EpisodeSource,
        })),
      );

    if (pool.length === 0) continue;

    for (const season of cache.seasons) {
      for (const episode of season.episodes) {
        const key = `${source.tmdbId}:${episode.season_number}:${episode.episode_number}`;
        if (decided.has(key)) continue;

        const ranked = pool
          .map(({ video, provenance }) => ({
            youtubeId: video.youtubeId,
            title: video.title,
            publishedAt: video.publishedAt,
            score: scoreMatch({
              videoTitle: video.title,
              episodeTitle: episode.name,
              seriesName: cache.detail.name,
              season: episode.season_number,
              episode: episode.episode_number,
            }),
            source: provenance,
          }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score);

        const best = ranked[0];

        if (best && best.score >= CONFIDENCE_THRESHOLD) {
          added.push({
            tmdbEpisodeId: episode.id,
            seriesId: source.tmdbId,
            season: episode.season_number,
            episode: episode.episode_number,
            youtubeId: best.youtubeId,
            // Region-locking is decided at ingest by the health check, which
            // reads contentDetails.regionRestriction. Matching only asserts
            // that a video exists for this episode.
            status: 'available',
            checkedAt: today,
            source: best.source,
          });
          decided.add(key);
          continue;
        }

        if (ranked.length > 0) {
          queue.push({
            tmdbEpisodeId: episode.id,
            seriesId: source.tmdbId,
            seriesSlug: source.slug,
            season: episode.season_number,
            episode: episode.episode_number,
            episodeTitle: episode.name,
            candidates: ranked.slice(0, MAX_CANDIDATES) satisfies QueueCandidate[],
          });
        }
      }
    }
  }

  const episodes = [...preserved, ...derived, ...added].sort(
    (a, b) => a.seriesId - b.seriesId || a.season - b.season || a.episode - b.episode,
  );

  // Validate before writing so match.ts can never hand build-data.ts something
  // the gate will reject.
  writeJson(contentPath('episodes.json'), episodesFileSchema.parse(episodes));
  writeJson(contentPath('queue.json'), queueFileSchema.parse(queue));

  const attempted = added.length + queue.length;
  const rate = attempted > 0 ? Math.round((added.length / attempted) * 100) : 0;
  console.log(
    (derived.length > 0 ? `took ${derived.length} episodes straight from playlists, ` : '') +
      `matched ${added.length} automatically, queued ${queue.length} for review (${rate}% automatic)`,
  );
}

main();
