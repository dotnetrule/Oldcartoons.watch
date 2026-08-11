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
  SeriesSource,
  SeriesStub,
} from '../src/types';
import {
  broadcastChannelSourcesFileSchema,
  broadcastDataFileSchema,
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
} from '../src/schemas';
import {
  PUBLIC_DATA_DIR,
  contentPath,
  ensureDirs,
  readJson,
  readValidated,
  seriesMetadataPath,
  writeJson,
} from './lib/paths';
import type { TmdbSeriesCache } from './lib/tmdb';

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
  language: ContentLanguage;
  showSlug: string;
  showTitle: string;
  season: number;
  episode: number;
  episodeTitle: string;
  runtime: number | null;
  youtubeId: string;
};

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
  historicalGuide: HistoricalGuide | null = null,
): BroadcastSchedule | null {
  if (seeds.length === 0) return null;

  const byShow = new Map<string, ScheduleSeed[]>();
  for (const seed of seeds) {
    const bucket = byShow.get(seed.showSlug);
    if (bucket) bucket.push(seed);
    else byShow.set(seed.showSlug, [seed]);
  }

  const channelHash = stableHash(channel.id);
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
      episodes: rotate(
        episodes.sort((a, b) => a.season - b.season || a.episode - b.episode),
        stableHash(`${channel.id}:${slug}`),
      ),
    }));
  const groups = historicalGuide ? sortedGroups : rotate(sortedGroups, channelHash);

  const ordered: ScheduleSeed[] = [];
  let row = 0;
  while (groups.some((group) => row < group.episodes.length)) {
    for (const group of groups) {
      const episode = group.episodes[row];
      if (episode) ordered.push(episode);
    }
    row += 1;
  }

  let cursor = 0;
  const broadcasts: ScheduledBroadcast[] = ordered.map((seed, index) => {
    // Playlist-authored archive entries honestly carry no runtime. A classic
    // half-hour cartoon contains roughly 22 minutes of programme; the engine
    // uses that conservative editorial slot until authoritative runtime data
    // is available, without pretending it came from the upload itself.
    const durationSeconds = Math.min(180 * 60, Math.max(5 * 60, (seed.runtime ?? 22) * 60));
    const startsAtOffsetSeconds = cursor;
    cursor += durationSeconds;
    return {
      id: `${channel.id}:${index}:${seed.showSlug}:s${seed.season}e${seed.episode}`,
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
        runtimeEstimated: seed.runtime === null,
        historicalGuide: historicalGuide?.id ?? null,
        requestedWeek: historicalGuide
          ? `${historicalGuide.requestedFrom}/${historicalGuide.requestedTo}`
          : null,
        sourceCoverage: historicalGuide?.coverage ?? null,
      },
    };
  });

  return {
    id: `${channel.id}-daily`,
    channelId: channel.id,
    anchorAt: '2000-01-01T00:00:00.000Z',
    cycleDurationSeconds: cursor,
    broadcasts,
  };
}

function loadCache(source: SeriesSource, historicalSeed: HistoricalSeriesSeed | undefined): TmdbSeriesCache {
  if (historicalSeed) {
    return {
      fetchedAt: 'historical-guide',
      detail: {
        id: source.tmdbId,
        name: historicalSeed.name,
        overview: historicalSeed.overview,
        first_air_date: null,
        last_air_date: null,
        number_of_episodes: 0,
        backdrop_path: null,
        poster_path: null,
        seasons: [],
      },
      seasons: [],
      images: { backdrops: [], posters: [] },
    };
  }
  const path = seriesMetadataPath(source.tmdbId);
  const cache = readJson(path) as TmdbSeriesCache;
  if (cache.detail?.id !== source.tmdbId) {
    throw new Error(
      `${path} holds series ${cache.detail?.id}, not ${source.tmdbId} — re-run 'npm run fetch'`,
    );
  }
  return cache;
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
    const unknown = guide.seriesSlugs.filter((slug) => !seriesSlugs.has(slug));
    if (unknown.length > 0) {
      throw new Error(`historical guide '${guide.id}' references unknown series: ${unknown.join(', ')}`);
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

  // One primary feed per network is what makes "one card per channel" true on
  // the channel map. Archive weeks are extra views of that same feed.
  for (const network of networks) {
    const primaries = broadcastChannelSources.filter(
      (channel) => channel.networkSlug === network.slug && channel.kind === 'primary',
    );
    if (network.listed && primaries.length === 0) {
      throw new Error(`network '${network.slug}' has no primary broadcast channel`);
    }
    if (primaries.length > 1) {
      throw new Error(
        `network '${network.slug}' has ${primaries.length} primary broadcast channels: ${primaries
          .map((channel) => channel.id)
          .join(', ')}`,
      );
    }
  }

  for (const channel of broadcastChannelSources) {
    if (
      channel.kind === 'archive' &&
      !broadcastChannelSources.some(
        (other) => other.networkSlug === channel.networkSlug && other.kind === 'primary',
      )
    ) {
      throw new Error(
        `archive channel '${channel.id}' has no primary channel on network '${channel.networkSlug}'`,
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

  // Index episodes by series so each series file is a single pass, and so an
  // episode pointing at a series that no longer exists is caught rather than
  // silently dropped.
  const episodesBySeries = new Map<number, Episode[]>();
  const sourceLanguageByKey = new Map<string, ContentLanguage>([
    ...youtubeChannelSources.map((source) => [`channel:${source.id}`, source.language] as const),
    ...playlists.map((source) => [`playlist:${source.id}`, source.language] as const),
  ]);
  for (const episode of episodes) {
    if (!seriesByTmdbId.has(episode.seriesId)) {
      throw new Error(
        `content/episodes.json has S${episode.season}E${episode.episode} for series ${episode.seriesId}, ` +
          `which is not in content/series.json`,
      );
    }
    if (episode.source && !sourceLanguageByKey.has(`${episode.source.kind}:${episode.source.id}`)) {
      throw new Error(
        `content/episodes.json references unknown ${episode.source.kind} source '${episode.source.id}'`,
      );
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

  for (const source of seriesSources) {
    const historicalSeed = historicalSeriesByTmdbId.get(source.tmdbId);
    const cache = loadCache(source, historicalSeed);
    const { detail } = cache;

    const firstAirYear = historicalSeed?.firstAirYear ?? yearOf(detail.first_air_date);
    if (firstAirYear === null) {
      throw new Error(`series '${source.slug}' has no usable first_air_date — the schedule grid needs a decade`);
    }

    const base = applyOverride(
      {
        name: detail.name,
        overview: detail.overview,
        firstAirYear,
        backdrop: detail.backdrop_path,
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
    const languageByEpisode = new Map(
      (episodesBySeries.get(source.tmdbId) ?? []).flatMap((episode) => {
        if (!episode.source) return [];
        const language = sourceLanguageByKey.get(`${episode.source.kind}:${episode.source.id}`);
        return language ? [[`${episode.season}:${episode.episode}`, language] as const] : [];
      }),
    );
    const availableLanguages = [...new Set(
      (episodesBySeries.get(source.tmdbId) ?? []).flatMap((episode) => {
        if (episode.status === 'missing' || !episode.source) return [];
        const language = sourceLanguageByKey.get(`${episode.source.kind}:${episode.source.id}`);
        return language ? [language] : [];
      }),
    )].sort();

    const seasons: PublicSeason[] = [];
    let availableCount = 0;

    for (const season of cache.seasons) {
      const publicEpisodes: PublicEpisode[] = season.episodes.map((episode) => {
        const record = statusByEpisode.get(`${episode.season_number}:${episode.episode_number}`);
        statusByEpisode.delete(`${episode.season_number}:${episode.episode_number}`);

        if (record && record.status !== 'missing') availableCount += 1;

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
          status: record?.status ?? 'missing',
          youtubeId: record?.youtubeId ?? null,
          still: episode.still_path,
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
      throw new Error(
        `content/episodes.json has entries for '${source.slug}' that TMDB does not list: ${orphans}`,
      );
    }

    seasons.sort((a, b) => a.season - b.season);

    const lastAirYear = historicalSeed?.lastAirYear ?? yearOf(detail.last_air_date) ?? firstAirYear;
    const decade = decadeOf(base.firstAirYear);
    decades.add(decade);

    const seriesFile: SeriesFile = {
      slug: source.slug,
      tmdbId: source.tmdbId,
      name: base.name,
      overview: base.overview,
      networkSlug: base.networkSlug,
      networkSlugs: [...new Set([base.networkSlug, ...(mappedNetworksBySeries.get(source.slug) ?? [])])],
      type: source.type,
      age: source.age,
      firstAirYear: base.firstAirYear,
      lastAirYear: Math.max(lastAirYear, base.firstAirYear),
      firstAirDate: historicalSeed ? null : detail.first_air_date,
      decade,
      episodeCount: detail.number_of_episodes,
      availableCount,
      availableLanguages,
      backdrop: base.backdrop,
      poster: detail.poster_path,
      seasons,
    };

    writeJson(`${PUBLIC_DATA_DIR}/series-${source.slug}.json`, seriesFileSchema.parse(seriesFile));

    for (const publicSeason of seriesFile.seasons) {
      for (const publicEpisode of publicSeason.episodes) {
        if (publicEpisode.status === 'missing' || publicEpisode.youtubeId === null) continue;
        for (const networkSlug of seriesFile.networkSlugs) {
          scheduleSeeds.push({
            networkSlug,
            language: languageByEpisode.get(`${publicEpisode.season}:${publicEpisode.episode}`)!,
            showSlug: seriesFile.slug,
            showTitle: seriesFile.name,
            season: publicEpisode.season,
            episode: publicEpisode.episode,
            episodeTitle: publicEpisode.title,
            runtime: publicEpisode.runtime,
            youtubeId: publicEpisode.youtubeId,
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

  const schedules = broadcastChannelSources.flatMap((channel) => {
    const historicalGuide = historicalGuides.find((guide) => guide.channelId === channel.id) ?? null;
    const guideSeries = historicalGuide ? new Set(historicalGuide.seriesSlugs) : null;
    const schedule = buildSchedule(
      channel,
      scheduleSeeds.filter(
        (seed) =>
          seed.networkSlug === channel.networkSlug &&
          seed.language === channel.language &&
          (!guideSeries || guideSeries.has(seed.showSlug)),
      ),
      historicalGuide,
    );
    return schedule ? [schedule] : [];
  });
  const scheduleIdByChannel = new Map(schedules.map((schedule) => [schedule.channelId, schedule.id]));
  const channelOrder = new Map(networks.map((network, index) => [network.slug, index]));
  const broadcastData: BroadcastDataFile = {
    generatedAt: index.generatedAt,
    channels: broadcastChannelSources
      .map((channel) => ({
        ...channel,
        scheduleId: scheduleIdByChannel.get(channel.id) ?? null,
      }))
      .sort(
        (a, b) =>
          (channelOrder.get(a.networkSlug) ?? 0) - (channelOrder.get(b.networkSlug) ?? 0) ||
          a.name.localeCompare(b.name),
      ),
    schedules,
  };
  writeJson(`${PUBLIC_DATA_DIR}/broadcast.json`, broadcastDataFileSchema.parse(broadcastData));

  const playable = stubs.reduce((total, s) => total + s.availableCount, 0);
  console.log(
    `emitted index.json + broadcast.json + ${stubs.length} series files — ` +
      `${networks.length} networks, ${broadcastData.channels.length} channels, ` +
      `${schedules.length} live schedules, ${playable} playable episodes`,
  );
}

main();
