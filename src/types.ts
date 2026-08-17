/**
 * Every type in this file is shared by the build pipeline (scripts/) and the
 * app (src/). The pipeline produces the "public" shapes at the bottom; the app
 * only ever reads those. Nothing here is validated at runtime in a component —
 * `scripts/build-data.ts` runs the Zod equivalents in src/schemas.ts and throws
 * before anything reaches `public/data/`.
 */

/* ------------------------------------------------------------------ */
/* Curated inputs — committed under content/, hand-editable            */
/* ------------------------------------------------------------------ */

export type EpisodeStatus = 'available' | 'region-locked' | 'missing';

export type SeriesType = 'Animation' | 'Live-action';

export type AgeBand = 'Preschool' | 'Kids' | 'Tween' | 'Adult';

/** Spoken language of an indexed YouTube source. Keep this deliberately
 * narrow: these are the languages the archive currently curates, not a list
 * of every language YouTube may contain. */
export type ContentLanguage = 'nl' | 'en';

/** Where a matched upload came from. Channel uploads are rights-holder
 * material and stable; third-party playlists are curated but can point at
 * uploads that rot, so provenance is recorded per episode and a whole source
 * can be dropped as a unit when it goes bad. */
export type EpisodeSource = {
  kind: 'channel' | 'playlist' | 'video';
  /**
   * The id of the thing this episode came from: a YouTube channel id, a
   * playlist id, or — for `video` — the video's own id.
   *
   * The first two name a source that holds many episodes, so provenance points
   * at the collection. A hand-picked set is different in kind: a curator chose
   * each video separately and any one of them can rot while the rest keep
   * playing, so each episode is its own source and can be dropped alone.
   */
  id: string;
};

/**
 * One upload that carries a given episode.
 *
 * The same episode can exist on YouTube several times over — a rights-holder
 * upload and a curator's copy, an English original and a Dutch dub. They are
 * genuinely different files with different lifetimes: one can be taken down,
 * region-locked or re-encoded while the others keep playing. So availability,
 * the last check and the audio tracks are all recorded per video rather than
 * per episode, and a viewer can be offered the choice.
 */
export type EpisodeVideo = {
  /** Exactly 11 characters. */
  youtubeId: string;
  /** Where this particular upload came from. */
  source: EpisodeSource;
  status: EpisodeStatus;
  /** ISO date, written by the health check. */
  checkedAt: string;
  /**
   * Every spoken language this video carries an audio track for, written by
   * `scripts/scan-audio-tracks.ts`.
   *
   * A YouTube upload can carry a dub alongside its original audio, and the
   * source it came from cannot say so: `PlaylistSource.language` describes the
   * track that plays by default, which is one fact about a whole collection.
   * Which dubs exist is a fact about one video, so it is measured per video and
   * stored here.
   *
   * Three states, and the difference between the last two is what makes the
   * scan repeatable:
   *   • null  — not looked up yet
   *   • []    — looked up, and this video has only its default track
   *   • [..]  — looked up; these are the languages on offer, default included
   */
  audioLanguages: ContentLanguage[] | null;
};

export type Episode = {
  tmdbEpisodeId: number;
  /** TMDB series id, not the slug. */
  seriesId: number;
  season: number;
  episode: number;
  /**
   * Every upload found for this episode, best first.
   *
   * The head is the default — what the player opens and what the schedule
   * books. It is deliberately stable: `match.ts` appends newly found uploads to
   * the tail and never reorders, because the head may have been chosen by a
   * human in the admin and a later run finding a higher-scoring candidate is
   * not grounds for overruling that.
   *
   * An empty array is a gap: nobody has found a video for this episode, or
   * every one that was found has since gone. That is a normal state and the
   * archive renders it as a greyed row rather than hiding the episode.
   */
  videos: EpisodeVideo[];
};

export type Network = {
  slug: string;
  name: string;
  /** Whether a broadcaster of this name actually went on air. False marks the
   * bookkeeping buckets — syndication and the like — that hold material with
   * no established channel. Nothing that is not `real` is ever presented to a
   * viewer as a channel. */
  real: boolean;
  /** Whether this broadcaster belongs in the public historical channel strip. */
  listed: boolean;
  /** Drives the channel strip ordering. */
  channelNumber: number;
  /** Hex, from the design token set. */
  colour: string;
  /** Path under /networks/. */
  logo: string;
  /** [first, last] active year. A last year at or beyond the current year
   * renders as "present" — that is a display rule, not a data sentinel. */
  activeYears: [number, number];
  /** One line, shown on the broadcaster page. */
  note: string;
  /** Greyed in the channel strip — a marker rather than a branded channel
   * (e.g. syndication). */
  neutral: boolean;
};

/** A viewer-facing regional television feed. Do not confuse this with
 * `ChannelSource` below: that type describes a YouTube ingest source, while
 * this type is part of the broadcast domain. Exactly one per network. */
export type BroadcastChannel = {
  id: string;
  networkSlug: string;
  name: string;
  country: string;
  language: ContentLanguage;
  /** IANA timezone used by the guide and all on-air clock labels. */
  timezone: string;
  /** Null while this channel has no playable schedule in the archive. */
  scheduleId: string | null;
  /**
   * The same station without the language filter: every programme on this
   * network the archive can play, whatever it is spoken in.
   *
   * A second timeline rather than a flag on the first, because a schedule is an
   * absolute running order and a viewer setting cannot rewrite one. Null when
   * the wider line-up would be the Dutch one — either the network has nothing
   * else, or it has nothing at all.
   */
  openScheduleId: string | null;
};

export type BroadcastType =
  | 'Episode'
  | 'Movie'
  | 'NetworkIdent'
  | 'ShowBumper'
  | 'Commercial'
  | 'CommercialBlock'
  | 'Promo'
  | 'Trailer'
  | 'Interstitial';

export type MediaAsset = {
  id: string;
  type: BroadcastType;
  durationSeconds: number;
  source: {
    provider: 'youtube';
    id: string;
  };
  networkSlug: string;
  channelId: string;
  showSlug: string | null;
};

/** One immutable item in a repeating, build-generated channel timeline.
 * Absolute `startsAt` and `endsAt` values are intentionally not stored: the
 * broadcast engine materialises them for the requested timestamp. */
export type ScheduledBroadcast = {
  id: string;
  type: BroadcastType;
  startsAtOffsetSeconds: number;
  endsAtOffsetSeconds: number;
  mediaAsset: MediaAsset;
  show: {
    slug: string;
    title: string;
  } | null;
  episode: {
    season: number;
    episode: number;
    title: string;
  } | null;
  metadata: Record<string, string | number | boolean | null>;
};

export type BroadcastSchedule = {
  id: string;
  channelId: string;
  /** Stable cycle origin. Together with the slots this makes every result
   * reproducible for every viewer without a runtime scheduling backend. */
  anchorAt: string;
  cycleDurationSeconds: number;
  broadcasts: ScheduledBroadcast[];
};

/** The engine's resolved answer to `channel + timestamp`. */
export type Broadcast = Omit<ScheduledBroadcast, 'startsAtOffsetSeconds' | 'endsAtOffsetSeconds'> & {
  startsAt: string;
  endsAt: string;
  scheduleId: string;
  channelId: string;
};

/** public/data/broadcast.json — loaded by network, guide and live routes. */
export type BroadcastDataFile = {
  generatedAt: string;
  channels: BroadcastChannel[];
  schedules: BroadcastSchedule[];
};

/**
 * public/data/broadcast-open.json — the wider line-ups, fetched only when a
 * viewer asks for them.
 *
 * Its own payload rather than more of `broadcast.json` because these schedules
 * are the same size again as the broadcast ones, and every route loads that
 * file. A viewer who never widens the line-up never downloads this.
 */
export type BroadcastOpenFile = {
  generatedAt: string;
  schedules: BroadcastSchedule[];
};

/** Sparse. Holds only the keys that differ from TMDB, keyed by TMDB series id
 * in content/overrides.json. Every key must exist on the corresponding TMDB
 * object or the build fails — that catches typos and surfaces TMDB schema
 * changes instead of letting a stale override sit unapplied. */
export type Override = Partial<{
  name: string;
  overview: string;
  firstAirYear: number;
  /** TMDB file_path. */
  backdrop: string;
  networkSlug: string;
}>;

/** The curated series list `scripts/fetch.ts` iterates. Carries what TMDB
 * cannot supply: which broadcaster aired it here, and the two facets the
 * schedule grid filters on. These cannot live in overrides.json — the
 * "every override key must exist on TMDB" rule would reject them. */
export type SeriesSource = {
  slug: string;
  tmdbId: number;
  networkSlug: string;
  type: SeriesType;
  age: AgeBand;
};

/** Minimal metadata for a guide-derived catalog entry that has not been
 * resolved against TMDB yet. Unlike a fabricated ISO date, separate year
 * fields preserve exactly the precision the historical source gives us. */
export type HistoricalSeriesSeed = {
  tmdbId: number;
  name: string;
  overview: string;
  firstAirYear: number;
  lastAirYear: number;
};

/** Build-time TMDB metadata attached to a placeholder series without changing
 * the negative id that owns its curated episode list. The positive id records
 * the reviewed upstream match; the remaining fields are a refreshable cache
 * committed with content so a deploy never needs the API token. */
export type TmdbSeriesMetadata = {
  tmdbId: number;
  name: string;
  originalName: string;
  overview: string;
  firstAirDate: string | null;
  lastAirDate: string | null;
  backdrop: string | null;
  poster: string | null;
  genres: string[];
  /**
   * The series' IMDb id, from TMDB's external_ids.
   *
   * There is no free IMDb API, and none is needed: TMDB already holds the
   * mapping, so one credential produces links to both. Optional because every
   * record written before this field existed has no opinion, which is not the
   * same as TMDB having looked and found nothing (null).
   */
  imdbId?: string | null;
};

export type TmdbMetadataFile = {
  fetchedAt: string;
  matches: Record<string, TmdbSeriesMetadata>;
};

/** Additional historical broadcaster memberships. A programme keeps one
 * canonical source network, while this list lets it appear on every Dutch
 * channel that carried it. The same slug may deliberately occur in multiple
 * lineups. */
export type NetworkProgrammeLineup = {
  networkSlug: string;
  seriesSlugs: string[];
};

export type HistoricalGuideCoverage =
  | 'direct'
  | 'reconstructed'
  | 'partial'
  | 'not-yet-launched';

/** Provenance and the de-duplicated series result of one historical guide
 * pass. A channel id opts the lineup into today's playable archive feeds. */
export type HistoricalGuide = {
  id: string;
  broadcaster: string;
  networkSlug: string;
  channelId: string | null;
  requestedFrom: string;
  requestedTo: string;
  coverage: HistoricalGuideCoverage;
  evidenceDate: string | null;
  sourceUrls: string[];
  note: string;
  seriesSlugs: string[];
  excludedTitles: string[];
};

/** A whitelisted rights-holder channel. */
export type ChannelSource = {
  id: string;
  name: string;
  language: ContentLanguage;
  note: string;
};

/** Hand-curated input from content/broadcast-channels.json. */
export type BroadcastChannelSource = Omit<BroadcastChannel, 'scheduleId' | 'openScheduleId'>;

/** A whitelisted third-party playlist. Same ingest path as a channel — the
 * only difference is provenance and the trust that follows from it. */
export type PlaylistSource = {
  id: string;
  /**
   * Display name, or null when it has not been looked up yet.
   *
   * The id is the only part of a playlist a person actually has — it is in the
   * link they paste. The title and the curator credit live on YouTube, so a
   * machine without network access to it can whitelist a playlist but cannot
   * attribute one. Null records that gap honestly instead of inventing a
   * credit; `npm run resolve-playlists` fills it in where the network is.
   */
  name: string | null;
  /** Who published the playlist, shown as attribution. Null as for `name`. */
  curator: string | null;
  /** Spoken language of the uploads in this curated source. */
  language: ContentLanguage;
  /** Series slugs this playlist is expected to cover. Advisory: it scopes
   * matching so a playlist cannot pull in unrelated series. */
  covers: string[];
  /**
   * When set, this playlist *is* the episode list for that series rather than
   * a pool of candidates matched against TMDB's.
   *
   * The fuzzy path can only surface episodes TMDB already lists, so a series
   * with no real TMDB id has nothing for a playlist to match against and every
   * row renders as a gap no matter how good the playlist is. Naming the series
   * here inverts that: playlist order becomes episode order, video titles
   * become episode titles, and the series' metadata seed is regenerated from
   * the playlist. The slug must also appear in `covers`.
   */
  episodesFor: string | null;
  /**
   * Longest video this playlist may contribute, in seconds, or null for no
   * ceiling.
   *
   * Curated playlists of short-form children's shows routinely mix the
   * episodes with hour-long compilations of those same episodes. Both are
   * legitimate uploads, but only one of them is an episode: a compilation
   * ingested as a row claims a 45-minute broadcast slot and replays material
   * the rows around it already carry. Length is what separates the two — an
   * episode of Peppa runs five minutes and a compilation runs fifty — and it
   * is measured rather than claimed, which is what makes it safe to cut on.
   */
  maxDurationSeconds: number | null;
  note: string;
};

/**
 * A hand-picked set of individual videos, from content/videos.json.
 *
 * Some series were never gathered into a playlist by anybody. What exists is a
 * handful of separate uploads that a person found one at a time, and the
 * archive would otherwise have to turn those away — `add-playlist` rightly
 * refuses a `watch?v=…` link, because it names a video and not a playlist.
 *
 * This is the same claim `episodesFor` makes on a playlist, with the ordering
 * supplied by hand instead of by a curator's playlist: the listed videos *are*
 * that series' episode list, in the order given. The difference that matters
 * downstream is provenance — every episode records its own video id, because
 * these videos share nothing but the person who chose them.
 */
export type VideoSetSource = {
  /** The series whose episode list this set is. */
  episodesFor: string;
  /** Spoken language of these uploads. */
  language: ContentLanguage;
  /** Video ids, in the order they should be numbered. */
  videos: string[];
  note: string;
};

/** One unresolved match awaiting a human, in content/queue.json. */
export type QueueEntry = {
  tmdbEpisodeId: number;
  seriesId: number;
  seriesSlug: string;
  season: number;
  episode: number;
  episodeTitle: string;
  candidates: QueueCandidate[];
};

export type QueueCandidate = {
  youtubeId: string;
  title: string;
  publishedAt: string;
  score: number;
  source: EpisodeSource;
};

/* ------------------------------------------------------------------ */
/* Public outputs — generated into public/data/, read by the app       */
/* ------------------------------------------------------------------ */

/**
 * One upload a viewer can choose between, as the app sees it.
 *
 * A flattened, named version of `EpisodeVideo`: the app never learns a source
 * id, only something it can put in front of a person. The picker in the player
 * is the only thing that reads this.
 */
export type PublicEpisodeSource = {
  youtubeId: string;
  /** Where it came from, for the one-line provenance under each choice. */
  kind: EpisodeSource['kind'];
  /** What to call this upload: a playlist's title and curator, or a channel's
   * name. Falls back to something honest when the source was never named. */
  label: string;
  status: EpisodeStatus;
  /** The track that plays without the viewer doing anything. */
  defaultAudioLanguage: ContentLanguage | null;
  audioLanguages: ContentLanguage[];
};

export type PublicEpisode = {
  season: number;
  episode: number;
  title: string;
  /** ISO date from TMDB, or null when TMDB has no air date. */
  airDate: string | null;
  /** Minutes, or null when TMDB has no runtime. */
  runtime: number | null;
  status: EpisodeStatus;
  youtubeId: string | null;
  /** TMDB file_path for the episode still. */
  still: string | null;
  /**
   * Every upload of this episode, best first, the default at index 0.
   *
   * Empty exactly when `youtubeId` is null. One entry is the ordinary case and
   * the player shows no picker for it; two or more is what the picker exists
   * for.
   */
  sources: PublicEpisodeSource[];
  /**
   * This episode's IMDb id, when one is known.
   *
   * Null is common and not a failure: TMDB serves these one episode at a time,
   * so they are gathered by a bounded pass over episodes that have a video. The
   * app falls back to the series' own IMDb page for the season, so a row always
   * has somewhere to link.
   */
  imdbId: string | null;
  /**
   * The track that plays without the viewer doing anything — the language of
   * the source this episode came from. Null when there is no video.
   */
  defaultAudioLanguage: ContentLanguage | null;
  /**
   * Every language this video has an audio track for, `defaultAudioLanguage`
   * included. Empty when there is no video, or when the tracks have not been
   * read yet — the player treats both the same way, by saying nothing.
   */
  audioLanguages: ContentLanguage[];
};

export type PublicSeason = {
  season: number;
  name: string;
  episodes: PublicEpisode[];
};

/** public/data/series-{slug}.json — fetched on series/episode route entry. */
export type SeriesFile = {
  slug: string;
  /** The archive's own id — negative for every series in the catalogue today. */
  tmdbId: number;
  /**
   * The real themoviedb.org id behind it, when the series has been matched.
   *
   * Kept apart from `tmdbId` because they answer different questions: one keys
   * the archive's own records, the other builds a link somebody can follow.
   * Null for a series nobody has matched yet.
   */
  tmdbRealId: number | null;
  /** The series' IMDb id, when TMDB knows one. Also the fallback for building
   * per-season episode links when an episode has no id of its own. */
  imdbId: string | null;
  name: string;
  overview: string;
  networkSlug: string;
  networkSlugs: string[];
  type: SeriesType;
  age: AgeBand;
  firstAirYear: number;
  lastAirYear: number;
  firstAirDate: string | null;
  decade: string;
  episodeCount: number;
  availableCount: number;
  /** Languages a viewer can hear this series in. Empty exactly when there are
   * no playable episodes. Includes languages that are only reachable as an
   * extra audio track — see `dubbedLanguages` for that distinction. */
  availableLanguages: ContentLanguage[];
  /**
   * The subset of `availableLanguages` that no episode plays by default: they
   * exist as a dub on the video and the viewer may have to pick them in the
   * player. Kept apart so the archive's status dot cannot call a series
   * "compleet in het Nederlands" on the strength of an English upload.
   */
  dubbedLanguages: ContentLanguage[];
  /** TMDB file_path. */
  backdrop: string | null;
  poster: string | null;
  /** Localized TMDB genre labels. Empty for a catalogue entry with no match. */
  genres: string[];
  seasons: PublicSeason[];
};

/** The schedule grid's row entries. Everything the grid, the broadcaster page
 * and the hover preview dock need — and nothing more, so the archive's
 * thousands of episodes never load just to draw the grid. */
export type SeriesStub = {
  slug: string;
  name: string;
  overview: string;
  networkSlug: string;
  networkSlugs: string[];
  type: SeriesType;
  age: AgeBand;
  firstAirYear: number;
  lastAirYear: number;
  firstAirDate: string | null;
  decade: string;
  episodeCount: number;
  availableCount: number;
  availableLanguages: ContentLanguage[];
  dubbedLanguages: ContentLanguage[];
  poster: string | null;
};

/** public/data/index.json — the only payload the schedule route loads. */
export type IndexFile = {
  generatedAt: string;
  networks: Network[];
  /** Decade labels present in the catalog, ascending: "1970s", "1980s", … */
  decades: string[];
  series: SeriesStub[];
};
