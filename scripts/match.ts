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
 */
import { readdirSync } from 'node:fs';
import type { Episode, EpisodeSource, QueueCandidate, QueueEntry } from '../src/types';
import { episodesFileSchema, queueFileSchema, seriesSourceFileSchema } from '../src/schemas';
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

function main(): void {
  const seriesSources = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const existing = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const youtubeSources = loadYoutubeSources();

  // A record in episodes.json means a decision was made about that episode —
  // auto-matched here, chosen by a human in the admin, or corrected by the
  // health check — and a decision is final. Absence means nobody has looked
  // yet, which is the only state matching is allowed to act on.
  //
  // Nothing may write a placeholder record for an unexamined episode. Doing so
  // marks it decided and silently excludes it from every future match run;
  // build-data.ts already renders a record-less episode as a gap, so a
  // placeholder buys nothing and costs the episode its chance of being found.
  const decided = new Set(existing.map((ep) => `${ep.seriesId}:${ep.season}:${ep.episode}`));

  const added: Episode[] = [];
  const queue: QueueEntry[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const source of seriesSources) {
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

  const episodes = [...existing, ...added].sort(
    (a, b) => a.seriesId - b.seriesId || a.season - b.season || a.episode - b.episode,
  );

  // Validate before writing so match.ts can never hand build-data.ts something
  // the gate will reject.
  writeJson(contentPath('episodes.json'), episodesFileSchema.parse(episodes));
  writeJson(contentPath('queue.json'), queueFileSchema.parse(queue));

  const attempted = added.length + queue.length;
  const rate = attempted > 0 ? Math.round((added.length / attempted) * 100) : 0;
  console.log(
    `matched ${added.length} automatically, queued ${queue.length} for review (${rate}% automatic)`,
  );
}

main();
