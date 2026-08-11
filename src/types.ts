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
  kind: 'channel' | 'playlist';
  /** YouTube channel id or playlist id, matching content/{channels,playlists}.json */
  id: string;
};

export type Episode = {
  tmdbEpisodeId: number;
  /** TMDB series id, not the slug. */
  seriesId: number;
  season: number;
  episode: number;
  /** Exactly 11 characters, or null when status is 'missing'. */
  youtubeId: string | null;
  status: EpisodeStatus;
  /** ISO date, written by the health check. */
  checkedAt: string;
  /** Null exactly when youtubeId is null. */
  source: EpisodeSource | null;
};

export type Network = {
  slug: string;
  name: string;
  /** Whether this broadcaster belongs in the public historical channel strip. */
  listed: boolean;
  /** Drives the channel strip ordering. */
  channelNumber: number;
  /** Hex, from the design token set. */
  colour: string;
  /** Light-theme variant of `colour`. Deviation from the spec's single hex:
   * the shipped light theme reads this, and collapsing to one value would
   * silently break it. */
  colourLight: string;
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

/** A viewer-facing regional or historical television feed. Do not confuse
 * this with `ChannelSource` below: that type describes a YouTube ingest
 * source, while this type is part of the broadcast domain. */
export type BroadcastChannel = {
  id: string;
  networkSlug: string;
  name: string;
  country: string;
  language: string;
  /** IANA timezone used by the guide and all on-air clock labels. */
  timezone: string;
  /** Null while this channel has no playable schedule in the archive. */
  scheduleId: string | null;
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
export type BroadcastChannelSource = Omit<BroadcastChannel, 'scheduleId'>;

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
};

export type PublicSeason = {
  season: number;
  name: string;
  episodes: PublicEpisode[];
};

/** public/data/series-{slug}.json — fetched on series/episode route entry. */
export type SeriesFile = {
  slug: string;
  tmdbId: number;
  name: string;
  overview: string;
  networkSlug: string;
  type: SeriesType;
  age: AgeBand;
  firstAirYear: number;
  lastAirYear: number;
  firstAirDate: string | null;
  decade: string;
  episodeCount: number;
  availableCount: number;
  /** Languages found among the currently playable episode sources. Empty
   * exactly when there are no playable episodes. */
  availableLanguages: ContentLanguage[];
  /** TMDB file_path. */
  backdrop: string | null;
  poster: string | null;
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
  type: SeriesType;
  age: AgeBand;
  firstAirYear: number;
  lastAirYear: number;
  firstAirDate: string | null;
  decade: string;
  episodeCount: number;
  availableCount: number;
  availableLanguages: ContentLanguage[];
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
