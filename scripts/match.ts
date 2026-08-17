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
  EpisodeVideo,
  HistoricalSeriesSeed,
  PlaylistSource,
  QueueCandidate,
  QueueEntry,
  SeriesSource,
  VideoSetSource,
} from '../src/types';
import type { TmdbSeriesCache } from './lib/tmdb';
import type { YoutubeVideo } from './lib/youtube';
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
import { isTmdbLed, loadSeriesCache } from './lib/series-metadata';
import { isPlayable } from './lib/episodes';
import { CONFIDENCE_THRESHOLD, scoreMatch } from './lib/similarity';
import { derivePlaylistSeries, type SourcedVideo } from './lib/playlist-episodes';
import type { YoutubeSourceCache } from './fetch';

/** How many ranked candidates a queue entry carries. Enough to choose from,
 * few enough to scan without scrolling — the admin is built for one decision
 * per keystroke. */
const MAX_CANDIDATES = 6;

/**
 * How many uploads one episode may carry.
 *
 * A viewer choosing between two or three copies is being offered a way around
 * a bad upload. A viewer choosing between twelve is being handed the matcher's
 * uncertainty to sort out, and past a few the extras are almost always the same
 * episode found again rather than a genuinely different copy.
 */
const MAX_SOURCES = 5;

/** One upload's claim on one episode. */
type Candidate = {
  youtubeId: string;
  title: string;
  publishedAt: string;
  score: number;
  source: EpisodeSource;
};

/** What matching one series against a fixed episode list produced. */
type MatchOutcome = {
  episodes: Episode[];
  queue: QueueEntry[];
  /** Episodes that ended up with at least one upload somebody can play. This
   * is the number the retention guarantee compares. */
  playable: number;
};

/**
 * Fit a pool of uploads into an episode list that already exists.
 *
 * This is the TMDB-led path: the list is fixed and authoritative, and the
 * uploads are candidates for its slots. An episode nobody found a video for
 * gets no record at all — absence is how the archive spells a gap, and writing
 * an empty record would mark the episode decided and exclude it from every
 * future run.
 */
function matchIntoList(
  source: SeriesSource,
  cache: TmdbSeriesCache,
  pool: { video: YoutubeVideo; provenance: EpisodeSource }[],
  existingBySlot: Map<string, Episode>,
  today: string,
): MatchOutcome {
  const episodes: Episode[] = [];
  const queue: QueueEntry[] = [];
  let playable = 0;

  /**
   * Uploads already spoken for by an earlier episode of this series.
   *
   * One video is one episode. Without this a generically titled upload that
   * scores above the threshold against several episodes is booked into all of
   * them, and the schedule then plays the same file three times over claiming
   * it is three different episodes. Earlier episodes win, which is arbitrary
   * but stable — and the alternative, letting one video stand for many, is
   * wrong rather than merely arbitrary.
   */
  const spokenFor = new Set<string>();
  for (const episode of existingBySlot.values()) {
    for (const video of episode.videos) spokenFor.add(video.youtubeId);
  }

  for (const season of cache.seasons) {
    for (const tmdbEpisode of season.episodes) {
      const slot = `${tmdbEpisode.season_number}:${tmdbEpisode.episode_number}`;
      const existing = existingBySlot.get(slot);

      const ranked: Candidate[] = pool
        .map(({ video, provenance }) => ({
          youtubeId: video.youtubeId,
          title: video.title,
          publishedAt: video.publishedAt,
          score: scoreMatch({
            videoTitle: video.title,
            episodeTitle: tmdbEpisode.name,
            seriesName: cache.detail.name,
            season: tmdbEpisode.season_number,
            episode: tmdbEpisode.episode_number,
          }),
          source: provenance,
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);

      // Everything confident enough, not merely the best one — that is what
      // gives an episode alternates to fall back on. Existing uploads keep
      // their place at the head: one of them may have been chosen by a person
      // in the admin, and a fresh run scoring something higher is not grounds
      // for overruling that.
      const kept = existing?.videos ?? [];
      const additions: Candidate[] = [];
      for (const candidate of ranked) {
        if (candidate.score < CONFIDENCE_THRESHOLD) break;
        if (kept.length + additions.length >= MAX_SOURCES) break;
        if (spokenFor.has(candidate.youtubeId)) continue;
        additions.push(candidate);
        spokenFor.add(candidate.youtubeId);
      }

      const videos: EpisodeVideo[] = [
        ...kept,
        ...additions.map((candidate) => ({
          youtubeId: candidate.youtubeId,
          // Region-locking is decided at ingest by the health check, which
          // reads contentDetails.regionRestriction. Matching only asserts that
          // a video exists for this episode.
          status: 'available' as const,
          checkedAt: today,
          source: candidate.source,
          // Which audio tracks the video carries is a reading of the video
          // itself, and matching never opens one. `scan-audio-tracks` fills
          // this in on the same run, after this script has decided.
          audioLanguages: null,
        })),
      ];

      if (videos.length > 0) {
        episodes.push({
          tmdbEpisodeId: tmdbEpisode.id,
          seriesId: source.tmdbId,
          season: tmdbEpisode.season_number,
          episode: tmdbEpisode.episode_number,
          videos,
        });
        if (videos.some((video) => video.status !== 'missing')) playable += 1;
        continue;
      }

      // Nothing confident, but something scored: a person can settle it.
      if (ranked.length > 0) {
        queue.push({
          tmdbEpisodeId: tmdbEpisode.id,
          seriesId: source.tmdbId,
          seriesSlug: source.slug,
          season: tmdbEpisode.season_number,
          episode: tmdbEpisode.episode_number,
          episodeTitle: tmdbEpisode.name,
          candidates: ranked.slice(0, MAX_CANDIDATES) satisfies QueueCandidate[],
        });
      }
    }
  }

  return { episodes, queue, playable };
}

/**
 * The records worth carrying into a fresh match of this series.
 *
 * A record is kept only when the episode list still has its slot *and* still
 * agrees about which episode that is. That second half is what makes the switch
 * to a TMDB-led list safe: records numbered by an earlier playlist ordering
 * carry that ordering's episode ids, fail the check, and are dropped rather
 * than left pointing at whichever episode now happens to sit at S01E07.
 */
function carryForward(existing: Episode[], cache: TmdbSeriesCache): Map<string, Episode> {
  const listed = new Map<string, number>();
  for (const season of cache.seasons) {
    for (const episode of season.episodes) {
      listed.set(`${episode.season_number}:${episode.episode_number}`, episode.id);
    }
  }

  const carried = new Map<string, Episode>();
  for (const record of existing) {
    const slot = `${record.season}:${record.episode}`;
    if (listed.get(slot) === record.tmdbEpisodeId) carried.set(slot, record);
  }
  return carried;
}

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
  /** One or more playlists, in whitelist order — that order is the episode
   * order across the group, so the array is never re-sorted here. */
  | { kind: 'playlists'; playlists: PlaylistSource[] }
  | { kind: 'videos'; set: VideoSetSource };

/** How one playlist reads in a log line or an error. */
const playlistLabel = (playlist: PlaylistSource): string =>
  `playlist '${playlist.name ?? playlist.id}' (${playlist.id})`;

/** How the owner reads in a log line or an error. */
const ownerLabel = (owner: EpisodeListOwner): string =>
  owner.kind === 'playlists'
    ? owner.playlists.map(playlistLabel).join(' + ')
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
  // A TMDB-led series computes this path only to weigh it against the matched
  // one — see the retention guarantee in `main`. Reporting that speculative
  // pass would describe an episode list the run is about to discard, and it
  // must not write the metadata seed for the same reason.
  options: { quiet?: boolean } = {},
): Episode[] | null {
  const quiet = options.quiet ?? false;
  // The group's playlists are read in whitelist order and their videos laid
  // end to end. That order is the episode order, so it is preserved exactly as
  // content/playlists.json states it.
  const videos: SourcedVideo[] = [];
  if (owner.kind === 'playlists') {
    for (const playlist of owner.playlists) {
      const dump = youtubeSources.find((yt) => yt.id === playlist.id);
      if (!dump) {
        // A playlist that could not be fetched this run — network trouble, or
        // the page shape moving on — must not silently drop out of the middle
        // of the group: the videos after it would shift into its slot and
        // take its episode numbers. Skip the whole series this run instead,
        // the same way an all-unreadable hand-picked set is skipped below,
        // and leave its episode list exactly as an earlier successful run
        // left it. (`main` already throws up front if nothing was fetched at
        // all, so reaching this with some other dump present means this one
        // specific source is what failed.)
        if (!quiet) {
          console.warn(
            `  ${source.slug}: ${playlistLabel(playlist)} owns part of its episode list but was not ` +
              `fetched this run — leaving the episode list as it was`,
          );
        }
        return null;
      }
      // A playlist that cached nothing means the fetch went wrong: the reader
      // throws on an unreadable playlist rather than returning an empty one,
      // so zero items is a state that should not exist and is worth failing
      // on.
      videos.push(
        ...dump.videos.map((video) => ({
          video,
          playlistId: playlist.id,
          maxDurationSeconds: playlist.maxDurationSeconds,
          episodeNumber: null,
        })),
      );
    }
  } else {
    const dump = youtubeSources.find((yt) => yt.id === `videoset-${owner.set.episodesFor}`);
    if (!dump) {
      throw new Error(
        `${ownerLabel(owner)} owns the episode list for '${source.slug}' ` +
          `but has not been fetched — run 'npm run fetch' first`,
      );
    }
    // A hand-picked set is different from a playlist. `fetch` resolves its
    // videos one at a time and deliberately keeps what it got, so an empty set
    // means every one of them was unreadable from that machine — a fact about
    // the run, not about the archive. Saying so and moving on leaves the other
    // sources to ingest and leaves any episodes a previous run derived exactly
    // where they are.
    if (dump.videos.length === 0) {
      if (!quiet) {
        console.warn(
          `  ${source.slug}: none of the ${owner.set.videos.length} hand-picked videos could be read — ` +
            `leaving the episode list as it was`,
        );
      }
      return null;
    }
    const requestedIds = dump.requestedVideoIds ?? dump.videos.map((video) => video.youtubeId);
    if (
      requestedIds.length !== owner.set.videos.length ||
      requestedIds.some((id, index) => id !== owner.set.videos[index])
    ) {
      if (!quiet) {
        console.warn(
          `  ${source.slug}: the cached hand-picked set does not match content/videos.json — ` +
            `leaving the episode list as it was; run 'npm run fetch' first`,
        );
      }
      return null;
    }
    const positionById = new Map(owner.set.videos.map((id, index) => [id, index + 1] as const));
    videos.push(
      ...dump.videos.flatMap((video) => {
        const episodeNumber = positionById.get(video.youtubeId);
        return episodeNumber === undefined
          ? []
          : [{ video, playlistId: null, maxDurationSeconds: null, episodeNumber }];
      }),
    );
  }

  const seedPath = seriesMetadataPath(source.tmdbId);
  const existing = loadSeriesCache(source, historicalSeed);

  const { cache, episodes, skipped } = derivePlaylistSeries({
    source,
    seriesName: existing.detail.name,
    existing,
    videos,
    origin:
      owner.kind === 'playlists'
        ? { kind: 'playlists', ids: owner.playlists.map((playlist) => playlist.id) }
        : { kind: 'videos', label: owner.set.episodesFor },
    today,
  });

  // A speculative pass must leave no trace. Writing the seed here would hand
  // the series a metadata file describing an episode list the run is about to
  // throw away in favour of TMDB's.
  if (quiet) return episodes;

  writeJson(seedPath, cache);
  console.log(
    owner.kind === 'playlists'
      ? `  ${source.slug}: ${episodes.length} episodes from ${owner.playlists.length === 1 ? 'playlist' : `${owner.playlists.length} playlists`} ` +
          owner.playlists
            .map((p) => `'${p.name ?? p.id}'${p.curator ? ` by ${p.curator}` : ''}`)
            .join(' + ')
      : `  ${source.slug}: ${episodes.length} episodes from ${episodes.length === 1 ? 'a hand-picked video' : 'hand-picked videos'}`,
  );
  // A video left out is reported, never dropped in silence: unmentioned, a cut
  // list is indistinguishable from a playlist that was always this short.
  for (const item of skipped) {
    const length =
      item.video.durationSeconds === null ? 'unknown length' : `${item.video.durationSeconds}s`;
    console.log(
      item.reason === 'too-long'
        ? `    skipped (${length}, over the ceiling): ${item.video.title}`
        : `    skipped (already listed by an earlier playlist): ${item.video.title}`,
    );
  }
  return episodes;
}

function main(): void {
  const seriesSources = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const existing = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);
  const videoSets = readValidated(contentPath('videos.json'), videoSetsFileSchema);
  const youtubeSources = loadYoutubeSources();
  // Distinguishes "fetch ran and one source among many failed" (handled per
  // series below, by leaving that series alone) from "fetch was never run at
  // all" (every playlist- and video-set-owned series would otherwise fail
  // that same way, one at a time, which reads as forty broken sources rather
  // than one missed step).
  if (youtubeSources.length === 0 && (playlists.length > 0 || videoSets.length > 0)) {
    throw new Error(`no fetched YouTube sources found in data/youtube/ — run 'npm run fetch' first`);
  }
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
  //
  // Several playlists may name the same series. They are grouped in the order
  // content/playlists.json lists them, because that order is the episode order
  // across the group.
  const playlistGroups = new Map<string, PlaylistSource[]>();
  for (const playlist of playlists) {
    if (playlist.episodesFor === null) continue;
    const group = playlistGroups.get(playlist.episodesFor);
    if (group) group.push(playlist);
    else playlistGroups.set(playlist.episodesFor, [playlist]);
  }

  const episodeListOwner = new Map<string, EpisodeListOwner>([
    ...[...playlistGroups].map(
      ([slug, group]) => [slug, { kind: 'playlists', playlists: group }] as const,
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

  const existingBySeries = new Map<number, Episode[]>();
  for (const record of existing) {
    const bucket = existingBySeries.get(record.seriesId);
    if (bucket) bucket.push(record);
    else existingBySeries.set(record.seriesId, [record]);
  }

  const resulting: Episode[] = [];
  const queue: QueueEntry[] = [];
  let derivedCount = 0;
  let matchedCount = 0;
  let heldBack = 0;
  let flipped = 0;

  for (const source of seriesSources) {
    const historicalSeed = historicalSeedById.get(source.tmdbId);
    const owner = episodeListOwner.get(source.slug);
    const priorRecords = existingBySeries.get(source.tmdbId) ?? [];

    // A series TMDB has not been matched to keeps the world it has always had:
    // a playlist authors its episode list, or it has none.
    if (!isTmdbLed(source)) {
      if (!owner) {
        resulting.push(...priorRecords);
        continue;
      }
      const episodes = rebuildFromSource(source, owner, historicalSeed, youtubeSources, today);
      // Null is "this source had nothing to say this run", so whatever the
      // series already had is what it keeps.
      if (episodes === null) {
        resulting.push(...priorRecords);
        continue;
      }
      resulting.push(...episodes);
      derivedCount += episodes.length;
      continue;
    }

    // TMDB-led. The episode list is fixed; every whitelisted upload scoped to
    // this series is a candidate for one of its slots — including a
    // hand-picked set's, which under the old rules could never be matched
    // because the set owned the list outright.
    const cache = loadSeriesCache(source, historicalSeed);
    const pool = youtubeSources
      .filter((yt) => yt.kind === 'channel' || yt.covers.includes(source.slug))
      .flatMap((yt) =>
        yt.videos.map((video) => ({
          video,
          provenance: {
            // A hand-picked video is its own source: a curator chose each one
            // separately and any one can rot while the rest keep playing.
            kind: yt.kind === 'videos' ? ('video' as const) : yt.kind,
            id: yt.kind === 'videos' ? video.youtubeId : yt.id,
          } satisfies EpisodeSource,
        })),
      );

    const outcome = matchIntoList(source, cache, pool, carryForward(priorRecords, cache), today);

    // The retention guarantee.
    //
    // Switching a series to a TMDB-led list is an improvement in shape — real
    // seasons, real numbering, honest gaps — but only if it does not cost the
    // archive episodes a viewer can currently watch. Dutch upload titles match
    // English TMDB titles badly, and a series whose playlist covered it fully
    // could come out of matching nearly empty.
    //
    // So both answers are computed and the TMDB-led one has to earn it. If it
    // plays fewer episodes than the playlist did, the playlist keeps the
    // series and this says so out loud. `npm run enrich-tmdb -- --remove
    // <slug>` makes that permanent when the upstream match is simply wrong.
    if (owner) {
      const fallback = rebuildFromSource(source, owner, historicalSeed, youtubeSources, today, {
        quiet: true,
      });
      const fallbackPlayable = fallback?.filter((ep) => isPlayable(ep)).length ?? 0;

      if (fallback !== null && outcome.playable < fallbackPlayable) {
        heldBack += 1;
        console.warn(
          `  ${source.slug}: TMDB lists ${countEpisodes(cache)} episodes but matching placed only ` +
            `${outcome.playable} of the ${fallbackPlayable} videos ${ownerLabel(owner)} supplies — ` +
            `keeping the source-authored list`,
        );
        resulting.push(...fallback);
        derivedCount += fallback.length;
        continue;
      }

      // Taking the TMDB list means the source-authored seed is no longer this
      // series' metadata. It is left on disk rather than deleted: it is what
      // the series falls back to if the TMDB match is ever removed.
      flipped += 1;
      console.log(
        `  ${source.slug}: ${outcome.playable} of ${countEpisodes(cache)} TMDB episodes matched ` +
          `(was ${fallbackPlayable} from ${ownerLabel(owner)})`,
      );
    }

    resulting.push(...outcome.episodes);
    queue.push(...outcome.queue);
    matchedCount += outcome.episodes.length;
  }

  const episodes = resulting.sort(
    (a, b) => a.seriesId - b.seriesId || a.season - b.season || a.episode - b.episode,
  );

  // Validate before writing so match.ts can never hand build-data.ts something
  // the gate will reject.
  writeJson(contentPath('episodes.json'), episodesFileSchema.parse(episodes));
  writeJson(contentPath('queue.json'), queueFileSchema.parse(queue));

  const playable = episodes.filter((ep) => isPlayable(ep)).length;
  const alternates = episodes.filter((ep) => ep.videos.length > 1).length;
  console.log(
    `${episodes.length} episode records — ${playable} playable, ${alternates} with a second source.\n` +
      `  ${matchedCount} from TMDB-led matching across ${flipped} series, ` +
      `${derivedCount} straight from curated sources, ${queue.length} queued for review.` +
      (heldBack > 0
        ? `\n  ${heldBack} series kept their source-authored list because TMDB-led matching would have lost episodes.`
        : ''),
  );
}

/** How many episodes a resolved list actually holds. */
const countEpisodes = (cache: TmdbSeriesCache): number =>
  cache.seasons.reduce((total, season) => total + season.episodes.length, 0);

main();
