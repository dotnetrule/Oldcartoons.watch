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
  BroadcastChannelSource,
  BroadcastDataFile,
  BroadcastOpenFile,
  BroadcastSchedule,
  ChannelSource,
  ContentLanguage,
  Episode,
  HistoricalGuide,
  HistoricalSeriesSeed,
  IndexFile,
  Network,
  NetworkProgrammeLineup,
  PublicEpisode,
  PublicSeason,
  PlaylistSource,
  ScheduledBroadcast,
  SeriesFile,
  SeriesStub,
  TmdbMetadataFile,
  VideoSetSource,
} from '../src/types';
import {
  broadcastChannelSourcesFileSchema,
  broadcastDataFileSchema,
  broadcastOpenFileSchema,
  channelsFileSchema,
  episodesFileSchema,
  historicalGuidesFileSchema,
  historicalSeriesSeedsFileSchema,
  indexFileSchema,
  networkProgrammeLineupsFileSchema,
  networksFileSchema,
  overridesFileSchema,
  playlistsFileSchema,
  seriesFileSchema,
  seriesSourceFileSchema,
  tmdbMetadataFileSchema,
  videoSetsFileSchema,
} from '../src/schemas';
import {
  PUBLIC_DATA_DIR,
  contentPath,
  ensureDirs,
  readValidated,
  writeJson,
} from './lib/paths';
import { loadSeriesCache } from './lib/series-metadata';
import { audioLanguagesOf, defaultVideo, episodeStatus, playableVideos } from './lib/episodes';
import { EPISODE_MAX_AIR_YEAR, isEpisodeInScope } from './lib/cutoff';

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

type ScheduleSeed = {
  networkSlug: string;
  /**
   * Every language this episode can be heard in: the language of the source it
   * came from, plus any dub measured on the video itself.
   *
   * A list rather than one value because a single upload can serve two
   * stations. The safety rule the plural does *not* relax: a language only
   * lands here after something read it off the video, never because a curator
   * hoped for it.
   */
  languages: ContentLanguage[];
  /**
   * The track that plays without the viewer doing anything. When a channel
   * schedules this episode for a language that is not this one, the live
   * player has to tell the viewer where the switch is.
   */
  defaultLanguage: ContentLanguage;
  showSlug: string;
  showTitle: string;
  season: number;
  episode: number;
  episodeTitle: string;
  runtime: number | null;
  runtimeSeconds: number | null;
  youtubeId: string;
};

/**
 * The slot given to an episode nobody measured. A classic half-hour cartoon
 * carries roughly this much programme, and it is an editorial guess — which is
 * why `metadata.runtimeEstimated` says so on every broadcast built from it.
 */
const ESTIMATED_SLOT_SECONDS = 22 * 60;

/** A slot has to be long enough to be a programme and short enough to be one
 * episode. Both ends are guards against a bad measurement, not editorial. */
const MIN_SLOT_SECONDS = 60;
const MAX_SLOT_SECONDS = 180 * 60;

/**
 * A cycle shorter than this repeats inside a single sitting: the same episodes
 * come round in the same order, and — because the anchor never moves — at the
 * same clock time tomorrow. Channels with few programmes get extra passes,
 * each one reshuffled, so the loop is long and lands somewhere different every
 * day instead of drumming out the same afternoon.
 */
const MIN_CYCLE_SECONDS = 30 * 60 * 60;
const MAX_PASSES = 24;
const MAX_BROADCASTS_PER_CYCLE = 600;

/** How long one episode occupies the air. */
function slotSeconds(seed: ScheduleSeed): number {
  const measured = seed.runtimeSeconds ?? (seed.runtime === null ? null : seed.runtime * 60);
  if (measured === null) return ESTIMATED_SLOT_SECONDS;
  return Math.min(MAX_SLOT_SECONDS, Math.max(MIN_SLOT_SECONDS, Math.round(measured)));
}

/** A small stable hash is enough here: it offsets regional channels so they
 * do not broadcast the same episode at the same moment, without introducing
 * build-time randomness. */
function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate<T>(values: T[], offset: number): T[] {
  if (values.length === 0) return [];
  const at = offset % values.length;
  return [...values.slice(at), ...values.slice(0, at)];
}

/** Round-robin the available shows into a gapless repeating schedule. The
 * result is stored in broadcast.json and is fully reproducible from curated
 * content; the browser only resolves an absolute timestamp within it. */
function buildSchedule(
  channel: BroadcastChannelSource,
  seeds: ScheduleSeed[],
  /** Distinguishes a channel's two feeds — see `scheduleVariants` below. Part
   * of the id, and of every hash that orders the cycle, so the two timelines
   * are independently shuffled rather than one being a prefix of the other. */
  variant: 'daily' | 'open',
  historicalGuide: HistoricalGuide | null = null,
): BroadcastSchedule | null {
  if (seeds.length === 0) return null;

  const byShow = new Map<string, ScheduleSeed[]>();
  for (const seed of seeds) {
    const bucket = byShow.get(seed.showSlug);
    if (bucket) bucket.push(seed);
    else byShow.set(seed.showSlug, [seed]);
  }

  const guideOrder = new Map(historicalGuide?.seriesSlugs.map((slug, index) => [slug, index]) ?? []);
  const sortedGroups = [...byShow.entries()]
    .sort(([a], [b]) => {
      if (!historicalGuide) return a.localeCompare(b);
      return (
        (guideOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (guideOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b)
      );
    })
    .map(([slug, episodes]) => ({
      slug,
      episodes: episodes.sort((a, b) => a.season - b.season || a.episode - b.episode),
    }));

  /** One round-robin pass over every show, at its own rotation. */
  function orderPass(pass: number): ScheduleSeed[] {
    const rotated = sortedGroups.map((group) => ({
      slug: group.slug,
      episodes: rotate(group.episodes, stableHash(`${channel.id}:${variant}:${group.slug}:${pass}`)),
    }));
    // An archive week reconstructs a printed running order, so its shows go out
    // in the order the guide listed them. Everywhere else the starting show
    // rotates too, or every pass would open with the same programme.
    const groups = historicalGuide
      ? rotated
      : rotate(rotated, stableHash(`${channel.id}:${variant}:pass:${pass}`));

    const ordered: ScheduleSeed[] = [];
    let row = 0;
    while (groups.some((group) => row < group.episodes.length)) {
      for (const group of groups) {
        const episode = group.episodes[row];
        if (episode) ordered.push(episode);
      }
      row += 1;
    }
    return ordered;
  }

  const firstPass = orderPass(0);
  const passSeconds = firstPass.reduce((total, seed) => total + slotSeconds(seed), 0);

  // An archive week is a fixed reconstruction: replaying it in a new order
  // would be a schedule the guide it came from never printed.
  let passes = 1;
  if (!historicalGuide) {
    while (
      passes < MAX_PASSES &&
      passSeconds * passes < MIN_CYCLE_SECONDS &&
      firstPass.length * (passes + 1) <= MAX_BROADCASTS_PER_CYCLE
    ) {
      passes += 1;
    }
  }

  const ordered = Array.from({ length: passes }, (_, pass) => orderPass(pass)).flat();

  let cursor = 0;
  const broadcasts: ScheduledBroadcast[] = ordered.map((seed, index) => {
    const durationSeconds = slotSeconds(seed);
    const startsAtOffsetSeconds = cursor;
    cursor += durationSeconds;
    /**
     * What this slot is actually spoken in.
     *
     * The station's language whenever the video can be heard in it, and the
     * video's own otherwise. That second case only arises on the open schedule
     * below, where a channel airs whatever the archive has for it rather than
     * only what it can broadcast in its own language — and there, claiming the
     * station's language would ask the player for a track that is not on the
     * video and point the viewer at a menu that cannot deliver one.
     */
    const spoken = seed.languages.some((language) => language === channel.language)
      ? channel.language
      : seed.defaultLanguage;
    return {
      id: `${channel.id}:${variant}:${index}:${seed.showSlug}:s${seed.season}e${seed.episode}`,
      type: 'Episode',
      startsAtOffsetSeconds,
      endsAtOffsetSeconds: cursor,
      mediaAsset: {
        id: `youtube:${seed.youtubeId}`,
        type: 'Episode',
        durationSeconds,
        source: { provider: 'youtube', id: seed.youtubeId },
        networkSlug: seed.networkSlug,
        channelId: channel.id,
        showSlug: seed.showSlug,
      },
      show: { slug: seed.showSlug, title: seed.showTitle },
      episode: {
        season: seed.season,
        episode: seed.episode,
        title: seed.episodeTitle,
      },
      metadata: {
        runtimeEstimated: seed.runtimeSeconds === null && seed.runtime === null,
        // The slot's language when this video does not start in it: the track
        // exists, but the viewer has to pick it in the player. Null when the
        // audio needs no intervention, which is the ordinary case.
        //
        // Decided here rather than in the player because the player knows what
        // is loaded, not what the schedule chose it for — and it is precisely
        // the difference between those two that the viewer has to be told
        // about.
        dubbedAudio: seed.defaultLanguage === spoken ? null : spoken,
        // The language this slot goes out in, said plainly and always —
        // `dubbedAudio` above only speaks up when the video disagrees with it,
        // so it cannot be what the player asks for. Preferring a track is not
        // a correction of anything; it is the slot's language, every time,
        // whether or not the upload already happened to be in it.
        audioLanguage: spoken,
        historicalGuide: historicalGuide?.id ?? null,
        requestedWeek: historicalGuide
          ? `${historicalGuide.requestedFrom}/${historicalGuide.requestedTo}`
          : null,
        sourceCoverage: historicalGuide?.coverage ?? null,
      },
    };
  });

  return {
    id: `${channel.id}-${variant}`,
    channelId: channel.id,
    anchorAt: '2000-01-01T00:00:00.000Z',
    cycleDurationSeconds: cursor,
    broadcasts,
  };
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
  const historicalSeriesSeeds: HistoricalSeriesSeed[] = readValidated(
    contentPath('historical-series.json'),
    historicalSeriesSeedsFileSchema,
  );
  const historicalGuides: HistoricalGuide[] = readValidated(
    contentPath('historical-guides.json'),
    historicalGuidesFileSchema,
  );
  const networkProgrammeLineups: NetworkProgrammeLineup[] = readValidated(
    contentPath('network-programmes.json'),
    networkProgrammeLineupsFileSchema,
  );
  const episodes = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const overrides = readValidated(contentPath('overrides.json'), overridesFileSchema);
  const tmdbMetadata: TmdbMetadataFile = readValidated(
    contentPath('tmdb-metadata.json'),
    tmdbMetadataFileSchema,
  );
  const broadcastChannelSources = readValidated(
    contentPath('broadcast-channels.json'),
    broadcastChannelSourcesFileSchema,
  );

  // The ingest whitelists are not inputs to this step, but they are hand-edited
  // and nothing else in a normal build would look at them — a bad edit would
  // otherwise sit unnoticed until the next `npm run fetch`. Validating them
  // here makes `npm run build` a total gate over content/.
  const youtubeChannelSources: ChannelSource[] = readValidated(
    contentPath('channels.json'),
    channelsFileSchema,
  );
  const playlists: PlaylistSource[] = readValidated(
    contentPath('playlists.json'),
    playlistsFileSchema,
  );
  const videoSets: VideoSetSource[] = readValidated(
    contentPath('videos.json'),
    videoSetsFileSchema,
  );

  const networkSlugs = new Set(networks.map((n) => n.slug));
  const seriesByTmdbId = new Map(seriesSources.map((s) => [s.tmdbId, s]));
  const seriesSlugs = new Set(seriesSources.map((s) => s.slug));
  const historicalSeriesByTmdbId = new Map(
    historicalSeriesSeeds.map((seed) => [seed.tmdbId, seed]),
  );
  const channelIds = new Set(broadcastChannelSources.map((channel) => channel.id));
  const listedNetworkSlugs = new Set(networks.filter((network) => network.listed).map((network) => network.slug));

  // A network that never went on air must not reach a viewer as a channel:
  // it cannot be listed, and it cannot carry a feed of any kind.
  for (const network of networks) {
    if (network.real) continue;
    if (network.listed) {
      throw new Error(`network '${network.slug}' is not a real broadcaster and cannot be listed`);
    }
    const feed = broadcastChannelSources.find((channel) => channel.networkSlug === network.slug);
    if (feed) {
      throw new Error(
        `network '${network.slug}' is not a real broadcaster but has broadcast channel '${feed.id}'`,
      );
    }
  }


  for (const seed of historicalSeriesSeeds) {
    if (!seriesByTmdbId.has(seed.tmdbId)) {
      throw new Error(`historical series seed ${seed.tmdbId} matches no series in content/series.json`);
    }
  }

  for (const guide of historicalGuides) {
    if (!networkSlugs.has(guide.networkSlug)) {
      throw new Error(`historical guide '${guide.id}' references unknown network '${guide.networkSlug}'`);
    }
    if (guide.channelId !== null && !channelIds.has(guide.channelId)) {
      throw new Error(`historical guide '${guide.id}' references unknown channel '${guide.channelId}'`);
    }
    const guideChannel = broadcastChannelSources.find((channel) => channel.id === guide.channelId);
    if (guideChannel && guideChannel.networkSlug !== guide.networkSlug) {
      throw new Error(
        `historical guide '${guide.id}' belongs to '${guide.networkSlug}' but names channel ` +
          `'${guideChannel.id}' on '${guideChannel.networkSlug}'`,
      );
    }
    const unknown = guide.seriesSlugs.filter((slug) => !seriesSlugs.has(slug));
    if (unknown.length > 0) {
      throw new Error(`historical guide '${guide.id}' references unknown series: ${unknown.join(', ')}`);
    }
  }

  // A series' episode list has exactly one author. Each whitelist rejects its
  // own duplicates; a clash between the two files can only be caught here.
  for (const set of videoSets) {
    if (!seriesSlugs.has(set.episodesFor)) {
      throw new Error(`content/videos.json names series '${set.episodesFor}', which is not in content/series.json`);
    }
    const playlist = playlists.find((p) => p.episodesFor === set.episodesFor);
    if (playlist) {
      throw new Error(
        `'${set.episodesFor}' has its episode list claimed by both a video set and playlist ` +
          `${playlist.id} — one series, one list`,
      );
    }
  }

  for (const lineup of networkProgrammeLineups) {
    if (!listedNetworkSlugs.has(lineup.networkSlug)) {
      throw new Error(`programme lineup references unlisted network '${lineup.networkSlug}'`);
    }
    const unknown = lineup.seriesSlugs.filter((slug) => !seriesSlugs.has(slug));
    if (unknown.length > 0) {
      throw new Error(
        `programme lineup '${lineup.networkSlug}' references unknown series: ${unknown.join(', ')}`,
      );
    }
  }
  for (const networkSlug of listedNetworkSlugs) {
    const lineup = networkProgrammeLineups.find((item) => item.networkSlug === networkSlug);
    if (!lineup) {
      throw new Error(`listed network '${networkSlug}' has no programme lineup`);
    }
    const programmeCount = new Set([
      ...lineup.seriesSlugs,
      ...seriesSources
        .filter((series) => series.networkSlug === networkSlug)
        .map((series) => series.slug),
    ]).size;
    if (programmeCount === 0) {
      throw new Error(`listed network '${networkSlug}' has an empty programme lineup`);
    }
  }

  const mappedNetworksBySeries = new Map<string, string[]>();
  for (const lineup of networkProgrammeLineups) {
    for (const seriesSlug of lineup.seriesSlugs) {
      const memberships = mappedNetworksBySeries.get(seriesSlug) ?? [];
      memberships.push(lineup.networkSlug);
      mappedNetworksBySeries.set(seriesSlug, memberships);
    }
  }

  for (const channel of broadcastChannelSources) {
    if (!networkSlugs.has(channel.networkSlug)) {
      throw new Error(`broadcast channel '${channel.id}' references unknown network '${channel.networkSlug}'`);
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: channel.timezone }).format(new Date(0));
    } catch {
      throw new Error(`broadcast channel '${channel.id}' has invalid timezone '${channel.timezone}'`);
    }
  }

  // One feed per network is what makes "one card per channel" true on the
  // channel map.
  for (const network of networks) {
    const feeds = broadcastChannelSources.filter((channel) => channel.networkSlug === network.slug);
    if (network.listed && feeds.length === 0) {
      throw new Error(`network '${network.slug}' has no broadcast channel`);
    }
    if (feeds.length > 1) {
      throw new Error(
        `network '${network.slug}' has ${feeds.length} broadcast channels: ${feeds
          .map((channel) => channel.id)
          .join(', ')}`,
      );
    }
  }

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

  for (const placeholderId of Object.keys(tmdbMetadata.matches)) {
    const source = seriesByTmdbId.get(Number(placeholderId));
    if (!source) {
      throw new Error(
        `TMDB metadata keyed ${placeholderId} matches no series in content/series.json`,
      );
    }
    if (source.tmdbId > 0) {
      throw new Error(
        `TMDB metadata for '${source.slug}' is keyed by a real id — npm run fetch owns resolved series`,
      );
    }
  }

  // Index episodes by series so each series file is a single pass, and so an
  // episode pointing at a series that no longer exists is caught rather than
  // silently dropped.
  const episodesBySeries = new Map<number, Episode[]>();
  const sourceLanguageByKey = new Map<string, ContentLanguage>([
    ...youtubeChannelSources.map((source) => [`channel:${source.id}`, source.language] as const),
    ...playlists.map((source) => [`playlist:${source.id}`, source.language] as const),
    // A hand-picked video is its own source, so each one registers separately
    // and carries the language of the set it was chosen into.
    ...videoSets.flatMap((set) =>
      set.videos.map((youtubeId) => [`video:${youtubeId}`, set.language] as const),
    ),
  ]);

  /**
   * What to call each source in front of a viewer.
   *
   * The app is never told a playlist id — it gets something a person can read
   * and, where a curator is known, the credit they are owed. A source that was
   * whitelisted from its id alone has no name yet (`resolve-playlists` fills
   * those in), and rather than print a raw id at somebody the archive says what
   * it honestly knows: this came from a playlist.
   */
  const sourceLabelByKey = new Map<string, string>([
    ...youtubeChannelSources.map((source) => [`channel:${source.id}`, source.name] as const),
    ...playlists.map(
      (source) =>
        [
          `playlist:${source.id}`,
          source.name
            ? source.curator
              ? `${source.name} — ${source.curator}`
              : source.name
            : 'Playlist',
        ] as const,
    ),
    ...videoSets.flatMap((set) =>
      set.videos.map((youtubeId) => [`video:${youtubeId}`, 'Losse upload'] as const),
    ),
  ]);
  for (const episode of episodes) {
    if (!seriesByTmdbId.has(episode.seriesId)) {
      throw new Error(
        `content/episodes.json has S${episode.season}E${episode.episode} for series ${episode.seriesId}, ` +
          `which is not in content/series.json`,
      );
    }
    for (const video of episode.videos) {
      if (!sourceLanguageByKey.has(`${video.source.kind}:${video.source.id}`)) {
        throw new Error(
          `content/episodes.json references unknown ${video.source.kind} source '${video.source.id}'`,
        );
      }
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
  const scheduleSeeds: ScheduleSeed[] = [];
  const decades = new Set<string>();
  /** Episodes the era ceiling removed, reported at the end so a sudden change
   * in the archive's size has a stated reason rather than being noticed later. */
  let cutByYear = 0;

  for (const source of seriesSources) {
    const historicalSeed = historicalSeriesByTmdbId.get(source.tmdbId);
    const cache = loadSeriesCache(source, historicalSeed);
    const { detail } = cache;
    const metadata = tmdbMetadata.matches[String(source.tmdbId)];

    const firstAirYear = historicalSeed?.firstAirYear ?? yearOf(detail.first_air_date);
    if (firstAirYear === null) {
      throw new Error(`series '${source.slug}' has no usable first_air_date — the schedule grid needs a decade`);
    }

    const base = applyOverride(
      {
        name: detail.name,
        overview: metadata?.overview || detail.overview,
        firstAirYear,
        backdrop: metadata?.backdrop ?? detail.backdrop_path,
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
    /**
     * What one episode can be heard in.
     *
     * Two languages, kept apart on purpose. `defaultLanguage` is the source's:
     * the track that plays when nobody intervenes, and the only claim a
     * curator ever makes by hand. `languages` adds the dubs the audio scan
     * measured on the video, which is the whole point of the field — an
     * English upload carrying a Nederlandse track belongs on a Dutch station
     * even though its source is honestly marked `en`.
     *
     * Null means no source, which means no episode to hear.
     */
    const audioOf = (
      episode: Episode,
    ): { defaultLanguage: ContentLanguage; languages: ContentLanguage[] } | null => {
      const chosen = defaultVideo(episode);
      if (!chosen) return null;
      const defaultLanguage = sourceLanguageByKey.get(`${chosen.source.kind}:${chosen.source.id}`);
      if (!defaultLanguage) return null;
      // Every upload of this episode counts, not just the default one: an
      // English default with a Dutch alternate behind it genuinely is available
      // in Dutch, and a viewer can reach it from the player. The scan writes
      // each video's own default language too, so the union is the whole
      // answer and the order never matters.
      const languages = audioLanguagesOf(episode, (video) =>
        sourceLanguageByKey.get(`${video.source.kind}:${video.source.id}`) ?? null,
      );
      return { defaultLanguage, languages };
    };

    const audioByEpisode = new Map(
      (episodesBySeries.get(source.tmdbId) ?? []).flatMap((episode) => {
        const audio = audioOf(episode);
        return audio ? [[`${episode.season}:${episode.episode}`, audio] as const] : [];
      }),
    );

    const playableAudio = (episodesBySeries.get(source.tmdbId) ?? []).flatMap((episode) =>
      episodeStatus(episode) === 'missing' ? [] : (audioOf(episode) ?? []),
    );
    const availableLanguages = [...new Set(playableAudio.flatMap((audio) => audio.languages))].sort();
    // A language nothing plays by default is reachable only through the
    // player's own audio-track picker. The archive says so rather than
    // colouring the series as if a Dutch upload existed.
    const defaultLanguages = new Set(playableAudio.map((audio) => audio.defaultLanguage));
    const dubbedLanguages = availableLanguages.filter(
      (language) => !defaultLanguages.has(language),
    );

    // Measured video lengths live on the metadata seed, not on the public
    // episode: a viewer reads the editorial runtime, the schedule needs the
    // exact one. Keyed here so the schedule seeds below can pick it up.
    const runtimeSecondsByEpisode = new Map(
      cache.seasons.flatMap((season) =>
        season.episodes.map(
          (episode) =>
            [`${episode.season_number}:${episode.episode_number}`, episode.runtimeSeconds ?? null] as const,
        ),
      ),
    );

    const seasons: PublicSeason[] = [];
    let availableCount = 0;

    for (const season of cache.seasons) {
      // The era ceiling. A series that ran past it keeps the seasons that fall
      // inside and loses the ones that do not, so the archive stays what it
      // says it is rather than following a long-running show into the 2010s.
      //
      // Episodes are dropped here rather than filtered later because the
      // orphan check below reads what survived: a record for an episode we
      // deliberately cut is not the same fault as a record for one TMDB never
      // listed, and only the second should fail the build.
      const inPeriod = season.episodes.filter((episode) => isEpisodeInScope(episode.air_date));
      for (const episode of season.episodes) {
        if (inPeriod.includes(episode)) continue;
        statusByEpisode.delete(`${episode.season_number}:${episode.episode_number}`);
        cutByYear += 1;
      }

      const publicEpisodes: PublicEpisode[] = inPeriod.map((episode) => {
        const slot = `${episode.season_number}:${episode.episode_number}` as const;
        const record = statusByEpisode.get(slot);
        const audio = audioByEpisode.get(slot);
        statusByEpisode.delete(slot);

        const chosen = record ? defaultVideo(record) : null;
        if (chosen) availableCount += 1;

        return {
          season: episode.season_number,
          episode: episode.episode_number,
          // TMDB leaves untitled episodes blank; the row still has to say
          // something, and the number is the only honest thing to say.
          title: episode.name || `Aflevering ${episode.episode_number}`,
          airDate: episode.air_date || null,
          runtime: episode.runtime && episode.runtime > 0 ? episode.runtime : null,
          // No record at all means nobody has looked for this episode yet,
          // which reads the same way to a viewer as looking and finding
          // nothing: a gap.
          status: record ? episodeStatus(record) : 'missing',
          youtubeId: chosen?.youtubeId ?? null,
          still: episode.still_path,
          // Every upload, default first, so the player can offer a way around
          // a bad one. A dead upload is left out: it is not a choice.
          sources: (record ? playableVideos(record) : []).map((video) => {
            const key = `${video.source.kind}:${video.source.id}`;
            const defaultLanguage = sourceLanguageByKey.get(key) ?? null;
            return {
              youtubeId: video.youtubeId,
              kind: video.source.kind,
              label: sourceLabelByKey.get(key) ?? 'Onbekende bron',
              status: video.status,
              defaultAudioLanguage: defaultLanguage,
              audioLanguages: [
                ...new Set([
                  ...(defaultLanguage ? [defaultLanguage] : []),
                  ...(video.audioLanguages ?? []),
                ]),
              ].sort(),
            };
          }),
          imdbId: episode.imdbId ?? null,
          // Absent for a gap, and absent for a video whose tracks nobody has
          // read yet — the player says nothing in either case.
          defaultAudioLanguage: audio?.defaultLanguage ?? null,
          audioLanguages: audio?.languages ?? [],
        };
      });

      if (publicEpisodes.length === 0) continue;

      seasons.push({
        season: season.season_number,
        name: season.name || `Seizoen ${season.season_number}`,
        episodes: publicEpisodes,
      });
    }

    // Anything left over points at a season/episode TMDB no longer lists.
    if (statusByEpisode.size > 0) {
      const orphans = [...statusByEpisode.keys()].map((k) => `S${k.replace(':', 'E')}`).join(', ');
      console.warn(
        `content/episodes.json has entries for '${source.slug}' that TMDB does not list: ${orphans}`,
      );
    }

    seasons.sort((a, b) => a.season - b.season);

    const lastAirYear =
      historicalSeed?.lastAirYear ??
      yearOf(metadata?.lastAirDate ?? detail.last_air_date) ??
      firstAirYear;
    const decade = decadeOf(base.firstAirYear);
    decades.add(decade);

    // What the archive actually lists, not what TMDB says the show ran to.
    // The two differ whenever the era ceiling cut a late season, and the
    // difference is not cosmetic: `availableCount / episodeCount` is what
    // decides whether a series reads as complete, and measuring completeness
    // against episodes the archive deliberately does not show would leave every
    // long-running series permanently short of itself.
    const episodeCount = seasons.reduce((total, season) => total + season.episodes.length, 0);

    const seriesFile: SeriesFile = {
      slug: source.slug,
      tmdbId: source.tmdbId,
      tmdbRealId: cache.tmdbId ?? metadata?.tmdbId ?? null,
      imdbId: cache.imdbId ?? metadata?.imdbId ?? null,
      name: base.name,
      overview: base.overview,
      networkSlug: base.networkSlug,
      networkSlugs: [...new Set([base.networkSlug, ...(mappedNetworksBySeries.get(source.slug) ?? [])])],
      type: source.type,
      age: source.age,
      firstAirYear: base.firstAirYear,
      lastAirYear: Math.max(lastAirYear, base.firstAirYear),
      firstAirDate: metadata?.firstAirDate ?? (historicalSeed ? null : detail.first_air_date),
      decade,
      episodeCount,
      availableCount,
      availableLanguages,
      dubbedLanguages,
      backdrop: base.backdrop,
      poster: metadata?.poster ?? detail.poster_path,
      genres: metadata?.genres ?? detail.genres?.map((genre) => genre.name).filter(Boolean) ?? [],
      seasons,
    };

    writeJson(`${PUBLIC_DATA_DIR}/series-${source.slug}.json`, seriesFileSchema.parse(seriesFile));

    for (const publicSeason of seriesFile.seasons) {
      for (const publicEpisode of publicSeason.episodes) {
        if (publicEpisode.status === 'missing' || publicEpisode.youtubeId === null) continue;
        // A broadcast books the head source, so its language claim must come
        // from that same video. `publicEpisode.audioLanguages` is the union of
        // every selectable source; using it here could schedule an English head
        // on a Dutch station merely because a Dutch alternate exists behind it.
        const scheduledSource = publicEpisode.sources[0]!;
        for (const networkSlug of seriesFile.networkSlugs) {
          scheduleSeeds.push({
            networkSlug,
            languages: scheduledSource.audioLanguages,
            defaultLanguage: scheduledSource.defaultAudioLanguage!,
            showSlug: seriesFile.slug,
            showTitle: seriesFile.name,
            season: publicEpisode.season,
            episode: publicEpisode.episode,
            episodeTitle: publicEpisode.title,
            runtime: publicEpisode.runtime,
            runtimeSeconds:
              runtimeSecondsByEpisode.get(`${publicEpisode.season}:${publicEpisode.episode}`) ?? null,
            youtubeId: scheduledSource.youtubeId,
          });
        }
      }
    }

    stubs.push({
      slug: seriesFile.slug,
      name: seriesFile.name,
      overview: seriesFile.overview,
      networkSlug: seriesFile.networkSlug,
      networkSlugs: seriesFile.networkSlugs,
      type: seriesFile.type,
      age: seriesFile.age,
      firstAirYear: seriesFile.firstAirYear,
      lastAirYear: seriesFile.lastAirYear,
      firstAirDate: seriesFile.firstAirDate,
      decade: seriesFile.decade,
      episodeCount: seriesFile.episodeCount,
      availableCount: seriesFile.availableCount,
      availableLanguages: seriesFile.availableLanguages,
      dubbedLanguages: seriesFile.dubbedLanguages,
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

  /**
   * Each channel's two feeds.
   *
   * `daily` is the station as it broadcasts: only what it can carry in its own
   * language, which is the archive's whole premise and stays the default.
   * `open` is the same network without that filter — every programme the
   * archive can play on it, whatever it is spoken in. A viewer picks between
   * them; both are ordinary gapless timelines, so neither has to apologise for
   * gaps the other does not have.
   *
   * Two generated timelines rather than one filtered at runtime because a
   * schedule is an absolute running order: a per-viewer setting can hide a slot
   * (see the age ceiling) but cannot conjure one, and filtering the wide feed
   * down to Dutch would leave the default viewer watching skip cards.
   */
  const scheduleVariants = broadcastChannelSources.flatMap((channel) => {
    const historicalGuide = historicalGuides.find((guide) => guide.channelId === channel.id) ?? null;
    const guideSeries = historicalGuide ? new Set(historicalGuide.seriesSlugs) : null;
    const onNetwork = scheduleSeeds.filter(
      (seed) =>
        seed.networkSlug === channel.networkSlug &&
        (!guideSeries || guideSeries.has(seed.showSlug)),
    );
    // `channel.language` is a plain string on the channel source, so this
    // compares rather than casts.
    const inLanguage = onNetwork.filter((seed) =>
      seed.languages.some((language) => language === channel.language),
    );

    const daily = buildSchedule(channel, inLanguage, 'daily', historicalGuide);
    // Only when it is a different station. A network whose material is all in
    // the channel's language would produce the same line-up under another id,
    // and shipping that doubles the payload to offer the viewer a choice
    // between two identical things.
    const open =
      onNetwork.length > inLanguage.length
        ? buildSchedule(channel, onNetwork, 'open', historicalGuide)
        : null;
    return [{ channel, daily, open }];
  });

  const isSchedule = (schedule: BroadcastSchedule | null): schedule is BroadcastSchedule =>
    schedule !== null;
  const schedules = scheduleVariants.map((entry) => entry.daily).filter(isSchedule);
  const openSchedules = scheduleVariants.map((entry) => entry.open).filter(isSchedule);
  const scheduleIdsByChannel = new Map(
    scheduleVariants.map((entry) => [
      entry.channel.id,
      { scheduleId: entry.daily?.id ?? null, openScheduleId: entry.open?.id ?? null },
    ]),
  );
  const channelOrder = new Map(networks.map((network, index) => [network.slug, index]));
  const broadcastData: BroadcastDataFile = {
    generatedAt: index.generatedAt,
    channels: broadcastChannelSources
      .map((channel) => ({
        ...channel,
        scheduleId: scheduleIdsByChannel.get(channel.id)?.scheduleId ?? null,
        openScheduleId: scheduleIdsByChannel.get(channel.id)?.openScheduleId ?? null,
      }))
      .sort(
        (a, b) =>
          (channelOrder.get(a.networkSlug) ?? 0) - (channelOrder.get(b.networkSlug) ?? 0) ||
          a.name.localeCompare(b.name),
      ),
    schedules,
  };
  writeJson(`${PUBLIC_DATA_DIR}/broadcast.json`, broadcastDataFileSchema.parse(broadcastData));

  const openData: BroadcastOpenFile = { generatedAt: index.generatedAt, schedules: openSchedules };
  // The one reference the schemas cannot check, because the two sides of it are
  // written to different files: a channel pointing at a wider line-up that was
  // never emitted would go dark the moment a viewer asked for it.
  const openIds = new Set(openSchedules.map((schedule) => schedule.id));
  for (const channel of broadcastData.channels) {
    if (channel.openScheduleId !== null && !openIds.has(channel.openScheduleId)) {
      throw new Error(
        `channel '${channel.id}' names open schedule '${channel.openScheduleId}', ` +
          'which broadcast-open.json does not carry',
      );
    }
  }
  writeJson(`${PUBLIC_DATA_DIR}/broadcast-open.json`, broadcastOpenFileSchema.parse(openData));

  const playable = stubs.reduce((total, s) => total + s.availableCount, 0);
  console.log(
    `emitted index.json + broadcast.json + broadcast-open.json + ${stubs.length} series files — ` +
      `${networks.length} networks, ${broadcastData.channels.length} channels, ` +
      `${schedules.length} live schedules, ${openSchedules.length} wider line-ups, ` +
      `${playable} playable episodes` +
      (cutByYear > 0 ? `\n${cutByYear} episodes aired after ${EPISODE_MAX_AIR_YEAR} and are not listed` : ''),
  );
}

main();
