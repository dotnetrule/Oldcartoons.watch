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
  PlaylistSource,
  QueueCandidate,
  QueueEntry,
  SeriesSource,
} from '../src/types';
import {
  episodesFileSchema,
  playlistsFileSchema,
  queueFileSchema,
  seriesSourceFileSchema,
} from '../src/schemas';
import {
  YOUTUBE_CACHE_DIR,
  contentPath,
  readJson,
  readValidated,
  seriesMetadataPath,
  writeJson,
} from './lib/paths';
import type { TmdbSeriesCache } from './lib/tmdb';
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
 * Rebuild a playlist-backed series from its playlist, writing the regenerated
 * metadata seed and returning the episode records.
 *
 * These records are not decisions in the sense the fuzzy path means. The
 * curator's ordering is the decision, it lives in the playlist, and it is
 * re-read on every run — so unlike a matched or hand-resolved episode, a
 * derived one is replaced rather than preserved. That is what lets a playlist
 * gaining or reordering episodes show up by re-running the pipeline.
 */
function rebuildFromPlaylist(
  source: SeriesSource,
  playlist: PlaylistSource,
  youtubeSources: YoutubeSourceCache[],
  today: string,
): Episode[] {
  const dump = youtubeSources.find((yt) => yt.id === playlist.id);
  if (!dump) {
    throw new Error(
      `playlist '${playlist.name ?? playlist.id}' (${playlist.id}) owns the episode list for '${source.slug}' ` +
        `but has not been fetched — run 'npm run fetch' first`,
    );
  }

  const seedPath = seriesMetadataPath(source.tmdbId);
  const existing = readJson(seedPath) as TmdbSeriesCache;

  const { cache, episodes } = derivePlaylistSeries({
    source,
    seriesName: existing.detail.name,
    existing,
    videos: dump.videos,
    playlistId: playlist.id,
    today,
  });

  writeJson(seedPath, cache);
  console.log(
    `  ${source.slug}: ${episodes.length} episodes from playlist '${playlist.name ?? playlist.id}'` +
      (playlist.curator ? ` by ${playlist.curator}` : ''),
  );
  return episodes;
}

function main(): void {
  const seriesSources = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const existing = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);
  const youtubeSources = loadYoutubeSources();

  const today = new Date().toISOString().slice(0, 10);

  // A series whose episode list a playlist owns does not go through matching
  // at all: there is nothing to match, because the playlist authors both sides
  // of the pairing.
  const episodeListOwner = new Map<string, PlaylistSource>(
    playlists.flatMap((p) => (p.episodesFor === null ? [] : [[p.episodesFor, p] as const])),
  );

  const derived: Episode[] = [];
  const derivedSeries = new Set<number>();

  for (const source of seriesSources) {
    const owner = episodeListOwner.get(source.slug);
    if (!owner) continue;
    derived.push(...rebuildFromPlaylist(source, owner, youtubeSources, today));
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

    const cache = readJson(seriesMetadataPath(source.tmdbId)) as TmdbSeriesCache;

    // A channel carries only its rights-holder's material, so it is open to
    // every series. A playlist is scoped by its `covers` list, which stops a
    // third-party playlist from pulling in series it has no business matching.
    const pool = youtubeSources
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
