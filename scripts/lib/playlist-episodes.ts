/**
 * Turning a curated playlist into a series' episode list.
 *
 * The ordinary ingest path treats a playlist as a pool of candidate uploads
 * and matches them against the episode list TMDB already publishes. That only
 * works when TMDB metadata exists. For a series carrying a placeholder id
 * there is nothing to match against, so a perfectly good playlist produces a
 * page of gaps — the videos are cached, and not one of them has an episode to
 * attach to.
 *
 * A playlist named as `episodesFor` a series takes the other route: the
 * playlist is the list. Its order is the episode order and its titles are the
 * episode titles, which is exactly what a curator asserts by publishing an
 * ordered playlist of one show.
 *
 * Two facts are deliberately not invented here. A video's upload date is not
 * an air date, and a playlist carries no runtime, so both stay null rather
 * than becoming plausible-looking wrong values.
 */
import type { Episode, SeriesSource } from '../../src/types';
import type { TmdbEpisode, TmdbSeriesCache } from './tmdb';
import type { YoutubeVideo } from './youtube';

/**
 * Everything a playlist-backed series flattens into. A curated playlist is a
 * flat ordered list — it asserts sequence, and nothing about season
 * boundaries — so claiming to know where seasons divide would be a guess.
 */
const SEASON = 1;

/** Guards the episode-id scheme below: ids are allotted 1000 per series. */
const MAX_EPISODES = 999;

/**
 * A stable, obviously-not-TMDB id for a derived episode.
 *
 * Real TMDB episode ids are positive, so a negative id can never be mistaken
 * for one. Deriving it from the series id keeps each series inside its own
 * block, and keeps the id stable across re-runs so a re-ingest of an unchanged
 * playlist produces an unchanged file.
 */
const derivedEpisodeId = (tmdbId: number, position: number): number =>
  -(Math.abs(tmdbId) * 1000 + position);

/** Build a regex matching the series name at the start of an upload title,
 * tolerant of whatever punctuation the uploader used between the words. */
function seriesNamePattern(seriesName: string): RegExp | null {
  const tokens = seriesName.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  return new RegExp(`^${tokens.join('[^a-z0-9]+')}\\b`, 'i');
}

/** Leading separators an uploader puts between the parts of a title. */
const LEADING_SEPARATOR = /^[\s\-–—:|·•,_~]+/;

/**
 * A leading episode marker: "Episode 12", "Ep. 3", "E04", "#7", or a bare
 * number followed by a separator ("01 - Meet the Pizza Cats", "8. Mission").
 *
 * A bare leading number with nothing after it is left alone — it may be the
 * title. The separator is consumed along with the number, because a full stop
 * only reads as punctuation *here*, after a number, and stripping leading dots
 * in general would eat the first character of a title that starts with one.
 */
const LEADING_EPISODE_NUMBER =
  /^(?:(?:ep(?:isode)?|afl(?:evering)?|e|#|no)\.?\s*#?\s*\d{1,4}\b|\d{1,4}\b(?=\s*[-–—:|·•.]\s*\S))\s*[-–—:|·•.]?\s*/i;

/** Trailing decorations that describe the upload rather than the episode. */
const TRAILING_NOISE =
  /[\s\-–—|]*[([{]\s*(?:full\s*episode|full\s*episodes|full|hd|4k|1080p?|720p?|remastered|official|complete)\s*[)\]}]\s*$/i;

/**
 * Reduce an upload title to the episode title inside it.
 *
 * Returns an empty string when nothing survives — a title that was only the
 * series name and a number carries no episode title, and `build-data.ts`
 * already renders that case as "Episode N", which is the honest thing for the
 * row to say.
 */
export function cleanEpisodeTitle(rawTitle: string, seriesName: string): string {
  const namePattern = seriesNamePattern(seriesName);
  let title = rawTitle.trim();

  // Uploaders stack these in any order — "SPC - Ep 4 - …", "Episode 4 |
  // Samurai Pizza Cats — …" — so strip repeatedly until a pass changes
  // nothing rather than assuming one arrangement.
  for (let pass = 0; pass < 6; pass += 1) {
    const before = title;
    title = title.replace(LEADING_SEPARATOR, '');
    if (namePattern) title = title.replace(namePattern, '');
    title = title.replace(LEADING_SEPARATOR, '');
    title = title.replace(LEADING_EPISODE_NUMBER, '');
    title = title.replace(TRAILING_NOISE, '');
    if (title === before) break;
  }

  return title.replace(LEADING_SEPARATOR, '').replace(/[\s\-–—:|·•,_~]+$/, '').replace(/\s+/g, ' ').trim();
}

export type DerivedSeries = {
  /** Regenerated metadata seed, written back to content/tmdb-seed/. */
  cache: TmdbSeriesCache;
  /** One record per playlist item, all playable. */
  episodes: Episode[];
};

/**
 * Derive a series' episode list and metadata seed from its playlist.
 *
 * `existing` is the series' current seed, which supplies everything the
 * playlist cannot: the show's name, overview, first air date and artwork.
 * Only the episode list is replaced — a playlist knows the episodes, not the
 * show.
 */
export function derivePlaylistSeries(args: {
  source: SeriesSource;
  seriesName: string;
  existing: TmdbSeriesCache;
  videos: YoutubeVideo[];
  playlistId: string;
  today: string;
}): DerivedSeries {
  const { source, seriesName, existing, videos, playlistId, today } = args;

  if (videos.length === 0) {
    throw new Error(
      `playlist ${playlistId} owns the episode list for '${source.slug}' but cached zero videos — re-run 'npm run fetch'`,
    );
  }
  if (videos.length > MAX_EPISODES) {
    throw new Error(
      `playlist ${playlistId} has ${videos.length} videos, past the ${MAX_EPISODES} an episode-list playlist can number for one series`,
    );
  }

  const tmdbEpisodes: TmdbEpisode[] = [];
  const episodes: Episode[] = [];

  videos.forEach((video, index) => {
    const position = index + 1;
    const id = derivedEpisodeId(source.tmdbId, position);

    tmdbEpisodes.push({
      id,
      name: cleanEpisodeTitle(video.title, seriesName),
      season_number: SEASON,
      episode_number: position,
      // An upload date is not an air date and a playlist has no runtime.
      air_date: null,
      runtime: null,
      still_path: null,
    });

    episodes.push({
      tmdbEpisodeId: id,
      seriesId: source.tmdbId,
      season: SEASON,
      episode: position,
      youtubeId: video.youtubeId,
      // The video is in the playlist, so it exists and is claimed playable.
      // Embeddability and region locks are the health check's call, at ingest,
      // never at render.
      status: 'available',
      checkedAt: today,
      source: { kind: 'playlist', id: playlistId },
    });
  });

  const cache: TmdbSeriesCache = {
    fetchedAt: new Date().toISOString(),
    detail: {
      ...existing.detail,
      // The show may have aired more episodes than the playlist carries, and
      // that difference is worth showing: the series page reads "N of M".
      // Fewer would mean the seed is stale, so the playlist wins.
      number_of_episodes: Math.max(existing.detail.number_of_episodes, tmdbEpisodes.length),
      seasons: [{ season_number: SEASON, name: 'Season 1', episode_count: tmdbEpisodes.length }],
    },
    seasons: [{ season_number: SEASON, name: 'Season 1', episodes: tmdbEpisodes }],
    images: existing.images ?? { backdrops: [], posters: [] },
  };

  return { cache, episodes };
}
