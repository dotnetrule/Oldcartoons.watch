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
 * ordered playlist of one show. Several playlists may make up one list; they
 * arrive here already flattened in whitelist order, each video still carrying
 * the playlist it came from.
 *
 * Two kinds of video are cut before anything is numbered: one an earlier
 * playlist already contributed, and one longer than its playlist's stated
 * ceiling — a compilation of the same episodes, which is a real upload but not
 * an episode. Cutting first is what keeps the surviving numbers contiguous.
 *
 * Two facts are deliberately not invented here. A video's upload date is not
 * an air date, and a playlist carries no editorial runtime, so both stay null
 * rather than becoming plausible-looking wrong values. The video's measured
 * length is carried through when the source reported one, because a broadcast
 * slot cut to a guess is what puts the live player past the end of its own
 * video.
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

/** The separators an uploader uses to divide a title into segments. Narrower
 * than LEADING_SEPARATOR: a comma or a colon divides a sentence far more often
 * than it divides a title, and cutting at one would take real words. */
const SEGMENT_SEPARATOR = /\s[-–—|·•]\s|\s{2,}/;

/**
 * A leading "S01E02" marker.
 *
 * The season-and-episode form is not covered by the episode-number pattern
 * below, which reads "Ep 2" and a bare leading number but not the two glued
 * together. Left in, it becomes part of the episode title and every row on the
 * page opens with a code the row's own numbering already states.
 */
const LEADING_SEASON_EPISODE = /^s\s*\d{1,2}\s*[.:e_-]\s*(?:e\s*)?\d{1,3}\b[\s.:|—–-]*/i;

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

/**
 * A leading episode word carrying no number — "aflevering Lieve Pappa".
 *
 * Dutch and English uploaders both use this as a bare label meaning "here is
 * an episode", which is exactly what the row it becomes already says. The
 * lookahead keeps it from eating a title that is only the word itself.
 */
const LEADING_EPISODE_WORD = /^(?:ep(?:isode)?|afl(?:evering)?)\b[\s.:|—–-]*(?=\S)/i;

/** Trailing decorations that describe the upload rather than the episode. */
const TRAILING_NOISE =
  /[\s\-–—|]*[([{]\s*(?:full\s*episode|full\s*episodes|full|hd|4k|1080p?|720p?|remastered|official|complete)\s*[)\]}]\s*$/i;

/** Pipe- or dash-delimited source labels that some rights-holder uploads put
 * directly in the title instead of wrapping in brackets. Removing one per
 * cleanup pass lets a stack such as "| Full Episode | Classic 90s Cartoon |
 * Kabillion" peel away without treating an ordinary subtitle as noise. */
const TRAILING_SOURCE_LABEL =
  /\s*(?:[-–—|]\s*)?(?:full\s*episode(?:\s*#?\d+)?|classic\s*90s\s*cartoon|kabillion)\s*$/i;

/** Flint's playlist wraps real episode names in square brackets. Only unwrap
 * when the brackets enclose the entire surviving title, so meaningful inner
 * punctuation elsewhere remains untouched. */
const BRACKETED_TITLE = /^\[\s*([^\[\]]+?)\s*\]$/;

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

  // An uploader's branding is often longer than the series name: "Kikker &
  // Vriendjes - Kikker en de warme dag". Stripping only the name it matches
  // leaves "& Vriendjes - Kikker en de warme dag", which is the branding with a
  // bite out of it rather than an episode title. So when the first segment
  // *starts* with the series name and something follows the separator, the
  // whole segment goes.
  if (namePattern) {
    const separator = title.match(SEGMENT_SEPARATOR);
    if (separator?.index !== undefined) {
      const head = title.slice(0, separator.index);
      const tail = title.slice(separator.index + separator[0].length).trim();
      if (tail && namePattern.test(head)) title = tail;
    }
  }

  // Uploaders stack these in any order — "SPC - Ep 4 - …", "Episode 4 |
  // Samurai Pizza Cats — …" — so strip repeatedly until a pass changes
  // nothing rather than assuming one arrangement.
  for (let pass = 0; pass < 6; pass += 1) {
    const before = title;
    title = title.replace(LEADING_SEPARATOR, '');
    // A title may open with the series name because the name is its subject —
    // "Kikker is verliefd" — and there the name is the first word of a
    // sentence, not a label in front of one. A lowercase word after it is what
    // tells the two apart, and taking the name there would leave a fragment
    // starting mid-sentence.
    if (namePattern) {
      const stripped = title.replace(namePattern, '');
      if (!/^\s+\p{Ll}/u.test(stripped)) title = stripped;
    }
    title = title.replace(LEADING_SEPARATOR, '');
    title = title.replace(LEADING_SEASON_EPISODE, '');
    title = title.replace(LEADING_EPISODE_NUMBER, '');
    title = title.replace(LEADING_EPISODE_WORD, '');
    title = title.replace(TRAILING_NOISE, '');
    title = title.replace(TRAILING_SOURCE_LABEL, '');
    if (title === before) break;
  }

  const cleaned = title
    .replace(LEADING_SEPARATOR, '')
    .replace(/[\s\-–—:|·•,_~]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.match(BRACKETED_TITLE)?.[1]?.trim() ?? cleaned;
}

export type DerivedSeries = {
  /** Regenerated metadata seed, written back to content/tmdb-seed/. */
  cache: TmdbSeriesCache;
  /** One record per contributed video, all playable. */
  episodes: Episode[];
  /** Videos left out, and why — reported by the caller. Never silent: a
   * dropped item that nobody mentions looks exactly like a playlist that was
   * always this short. */
  skipped: SkippedVideo[];
};

export type SkippedVideo = {
  video: YoutubeVideo;
  reason: 'too-long' | 'duplicate';
  /** The playlist the video came from, for a log line that names it. */
  playlistId: string | null;
};

/**
 * What owns this episode list, and therefore what each episode records as its
 * provenance.
 *
 * A playlist is one source holding many episodes: every row points back at the
 * playlist it came from, and a playlist that starts rotting is dropped as a
 * unit — which stays true when several playlists make up one list, because
 * each row names its own. A hand-picked set is the opposite: the videos have
 * nothing in common but the person who chose them, so each episode points at
 * its own video and can be dropped alone.
 */
export type EpisodeListOrigin =
  | { kind: 'playlists'; ids: string[] }
  | { kind: 'videos'; label: string };

const originLabel = (origin: EpisodeListOrigin): string =>
  origin.kind === 'playlists'
    ? origin.ids.length === 1
      ? `playlist ${origin.ids[0]}`
      : `playlists ${origin.ids.join(' + ')}`
    : `video set '${origin.label}'`;

/**
 * One video and the playlist it was contributed by.
 *
 * A series' list can be assembled from several playlists, so the caller hands
 * over videos already flattened in whitelist order with their provenance
 * attached, rather than one anonymous array.
 */
export type SourcedVideo = {
  video: YoutubeVideo;
  /** Null for a hand-picked set: there is no playlist to name. */
  playlistId: string | null;
  /** Length ceiling of the playlist this came from, null for none. */
  maxDurationSeconds: number | null;
};

/**
 * Derive a series' episode list and metadata seed from the source that owns it.
 *
 * `existing` is the series' current seed, which supplies everything the source
 * cannot: the show's name, overview, first air date and artwork. Only the
 * episode list is replaced — a curated list knows the episodes, not the show.
 */
export function derivePlaylistSeries(args: {
  source: SeriesSource;
  seriesName: string;
  existing: TmdbSeriesCache;
  videos: SourcedVideo[];
  origin: EpisodeListOrigin;
  today: string;
}): DerivedSeries {
  const { source, seriesName, existing, videos, origin, today } = args;

  if (videos.length === 0) {
    throw new Error(
      `${originLabel(origin)} owns the episode list for '${source.slug}' but cached zero videos — re-run 'npm run fetch'`,
    );
  }

  // Both cuts happen before anything is numbered, so the episode numbers that
  // survive run 1, 2, 3 … with no hole where a dropped video used to be.
  const skipped: SkippedVideo[] = [];
  const seen = new Set<string>();
  const kept = videos.filter(({ video, playlistId, maxDurationSeconds }) => {
    if (seen.has(video.youtubeId)) {
      skipped.push({ video, reason: 'duplicate', playlistId });
      return false;
    }
    // A ceiling is a comparison against a measurement. When the source stated
    // no length there is nothing to compare, and dropping the video on the
    // suspicion that it might be long would be the guess this filter exists to
    // avoid — so it is kept, and the caller says so.
    if (
      maxDurationSeconds !== null &&
      video.durationSeconds !== null &&
      video.durationSeconds > maxDurationSeconds
    ) {
      skipped.push({ video, reason: 'too-long', playlistId });
      return false;
    }
    seen.add(video.youtubeId);
    return true;
  });

  if (kept.length === 0) {
    throw new Error(
      `${originLabel(origin)} owns the episode list for '${source.slug}' but every one of its ` +
        `${videos.length} videos was filtered out — check the maxDurationSeconds ceiling`,
    );
  }
  if (kept.length > MAX_EPISODES) {
    throw new Error(
      `${originLabel(origin)} has ${kept.length} videos, past the ${MAX_EPISODES} an episode list can number for one series`,
    );
  }

  const tmdbEpisodes: TmdbEpisode[] = [];
  const episodes: Episode[] = [];

  kept.forEach(({ video, playlistId }, index) => {
    const position = index + 1;
    const id = derivedEpisodeId(source.tmdbId, position);

    tmdbEpisodes.push({
      id,
      name: cleanEpisodeTitle(video.title, seriesName),
      season_number: SEASON,
      episode_number: position,
      // An upload date is not an air date, and a playlist states no editorial
      // runtime. The video's own length is a different thing: it is measured,
      // not claimed, and it is what the broadcast slot has to be cut to.
      air_date: null,
      runtime: null,
      runtimeSeconds: video.durationSeconds,
      still_path: null,
    });

    episodes.push({
      tmdbEpisodeId: id,
      seriesId: source.tmdbId,
      season: SEASON,
      episode: position,
      youtubeId: video.youtubeId,
      // The source listed the video, so it exists and is claimed playable.
      // Embeddability and region locks are the health check's call, at ingest,
      // never at render.
      status: 'available',
      checkedAt: today,
      source:
        playlistId === null
          ? { kind: 'video', id: video.youtubeId }
          : { kind: 'playlist', id: playlistId },
      // Not looked up here: a playlist listing states a title and a length,
      // never a track list. `scan-audio-tracks` reads that per video.
      audioLanguages: null,
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

  return { cache, episodes, skipped };
}
