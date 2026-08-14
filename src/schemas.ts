/**
 * Zod mirrors of src/types.ts. These run in exactly two places: the build
 * pipeline (scripts/build-data.ts) and the admin dev-server middleware. There
 * are deliberately no runtime schema checks in components — the build gate
 * carries that, and a component that has to defend against its own data means
 * the gate leaked.
 */
import { z } from 'zod';

export const episodeStatusSchema = z.enum(['available', 'region-locked', 'missing']);

export const seriesTypeSchema = z.enum(['Animation', 'Live-action']);

export const ageBandSchema = z.enum(['Preschool', 'Kids', 'Tween', 'Adult']);

export const contentLanguageSchema = z.enum(['nl', 'en']);

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug');

const hexColourSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'must be a 6-digit hex colour');

/**
 * A TMDB id, or a negative placeholder.
 *
 * Real TMDB ids are always positive. Seeded catalog entries that have not yet
 * been resolved against TMDB carry a negative id instead, which `scripts/fetch.ts`
 * refuses outright. Inventing a plausible positive id would make a mis-seeded
 * series fetch the wrong show in silence; a negative one cannot be mistaken for
 * real data by any consumer.
 */
const tmdbIdSchema = z
  .number()
  .int()
  .refine((n) => n !== 0, 'a TMDB id is never zero');

/** True for the seed placeholders described on `tmdbIdSchema`. */
export const isPlaceholderTmdbId = (id: number): boolean => id < 0;

/** YouTube video ids are exactly 11 characters of [A-Za-z0-9_-]. */
export const youtubeIdSchema = z
  .string()
  .length(11, 'a YouTube video id is exactly 11 characters')
  .regex(/^[A-Za-z0-9_-]{11}$/, 'invalid characters in YouTube video id');

export const episodeSourceSchema = z.object({
  kind: z.enum(['channel', 'playlist', 'video']),
  id: z.string().min(1),
});

export const episodeSchema = z
  .object({
    tmdbEpisodeId: tmdbIdSchema,
    seriesId: tmdbIdSchema,
    season: z.number().int().nonnegative(),
    episode: z.number().int().positive(),
    youtubeId: youtubeIdSchema.nullable(),
    status: episodeStatusSchema,
    checkedAt: z.string().min(1),
    source: episodeSourceSchema.nullable(),
    // Defaulted rather than required: every record written before the audio
    // scan existed lacks the key, and those are decisions the archive keeps.
    // Null reads as 'not looked up yet', which is exactly what they are.
    audioLanguages: z.array(contentLanguageSchema).nullable().default(null),
  })
  .superRefine((ep, ctx) => {
    // The spec's headline invariant: a non-null id with status 'missing' is
    // incoherent — either the video exists and plays, or the row is a gap.
    if (ep.status === 'missing' && ep.youtubeId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['youtubeId'],
        message: `status is 'missing' but youtubeId is '${ep.youtubeId}' — a missing episode has no video`,
      });
    }
    if (ep.status !== 'missing' && ep.youtubeId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['youtubeId'],
        message: `status is '${ep.status}' but youtubeId is null — only 'missing' episodes may lack a video`,
      });
    }
    // Provenance tracks the video, so the two are present or absent together.
    if ((ep.youtubeId === null) !== (ep.source === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: 'youtubeId and source must both be set or both be null',
      });
    }
    // Audio tracks describe a video. A row that lost its video keeps no
    // reading of one, or the health check would leave a claim about a file
    // nobody can play behind.
    if (ep.youtubeId === null && ep.audioLanguages !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audioLanguages'],
        message: 'youtubeId is null but audioLanguages is set — a row with no video has no tracks',
      });
    }
  });

export const episodesFileSchema = z.array(episodeSchema).superRefine((all, ctx) => {
  // One record per episode. Two records for the same slot is not a merge
  // conflict the build can resolve — it would silently pick one and hide the
  // other, so it fails here instead.
  const seen = new Map<string, number>();
  all.forEach((ep, index) => {
    const key = `${ep.seriesId}:${ep.season}:${ep.episode}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [index],
      message: `duplicate record for series ${ep.seriesId} S${ep.season}E${ep.episode} (also at index ${first})`,
    });
  });
});

export const networkSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  real: z.boolean(),
  listed: z.boolean(),
  channelNumber: z.number().int().nonnegative(),
  colour: hexColourSchema,
  colourLight: hexColourSchema,
  logo: z.string().startsWith('/networks/'),
  activeYears: z
    .tuple([z.number().int(), z.number().int()])
    .refine(([from, to]) => to >= from, 'activeYears must not end before it starts'),
  note: z.string().min(1),
  neutral: z.boolean(),
});

export const broadcastTypeSchema = z.enum([
  'Episode',
  'Movie',
  'NetworkIdent',
  'ShowBumper',
  'Commercial',
  'CommercialBlock',
  'Promo',
  'Trailer',
  'Interstitial',
]);

export const broadcastChannelSourceSchema = z.object({
  id: slugSchema,
  networkSlug: slugSchema,
  name: z.string().min(1),
  country: z.string().length(2),
  language: z.string().min(2),
  timezone: z.string().min(1),
});

export const broadcastChannelSourcesFileSchema = z
  .array(broadcastChannelSourceSchema)
  .refine(
    (channels) => new Set(channels.map((channel) => channel.id)).size === channels.length,
    'duplicate broadcast channel id',
  );

export const broadcastChannelSchema = broadcastChannelSourceSchema.extend({
  scheduleId: slugSchema.nullable(),
});

export const mediaAssetSchema = z.object({
  id: z.string().min(1),
  type: broadcastTypeSchema,
  durationSeconds: z.number().int().positive(),
  source: z.object({
    provider: z.literal('youtube'),
    id: youtubeIdSchema,
  }),
  networkSlug: slugSchema,
  channelId: slugSchema,
  showSlug: slugSchema.nullable(),
});

export const scheduledBroadcastSchema = z
  .object({
    id: z.string().min(1),
    type: broadcastTypeSchema,
    startsAtOffsetSeconds: z.number().int().nonnegative(),
    endsAtOffsetSeconds: z.number().int().positive(),
    mediaAsset: mediaAssetSchema,
    show: z.object({ slug: slugSchema, title: z.string().min(1) }).nullable(),
    episode: z
      .object({
        season: z.number().int().nonnegative(),
        episode: z.number().int().positive(),
        title: z.string().min(1),
      })
      .nullable(),
    metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .refine(
    (broadcast) => broadcast.endsAtOffsetSeconds > broadcast.startsAtOffsetSeconds,
    'a broadcast must end after it starts',
  );

export const broadcastScheduleSchema = z
  .object({
    id: slugSchema,
    channelId: slugSchema,
    anchorAt: z.string().datetime(),
    cycleDurationSeconds: z.number().int().positive(),
    broadcasts: z.array(scheduledBroadcastSchema).min(1),
  })
  .superRefine((schedule, ctx) => {
    let cursor = 0;
    schedule.broadcasts.forEach((broadcast, index) => {
      if (broadcast.startsAtOffsetSeconds !== cursor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['broadcasts', index, 'startsAtOffsetSeconds'],
          message: `timeline gap or overlap: expected ${cursor}`,
        });
      }
      cursor = broadcast.endsAtOffsetSeconds;
    });
    if (cursor !== schedule.cycleDurationSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cycleDurationSeconds'],
        message: `cycle ends at ${cursor}, not ${schedule.cycleDurationSeconds}`,
      });
    }
  });

export const broadcastDataFileSchema = z
  .object({
    generatedAt: z.string().datetime(),
    channels: z.array(broadcastChannelSchema),
    schedules: z.array(broadcastScheduleSchema),
  })
  .superRefine((data, ctx) => {
    const channelIds = new Set(data.channels.map((channel) => channel.id));
    const scheduleIds = new Set(data.schedules.map((schedule) => schedule.id));
    data.channels.forEach((channel, index) => {
      if (channel.scheduleId !== null && !scheduleIds.has(channel.scheduleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['channels', index, 'scheduleId'],
          message: `unknown schedule '${channel.scheduleId}'`,
        });
      }
    });
    data.schedules.forEach((schedule, index) => {
      if (!channelIds.has(schedule.channelId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedules', index, 'channelId'],
          message: `unknown channel '${schedule.channelId}'`,
        });
      }
    });
  });

export const networksFileSchema = z
  .array(networkSchema)
  .refine(
    (nets) => new Set(nets.map((n) => n.slug)).size === nets.length,
    'duplicate network slug',
  )
  .refine(
    (nets) => new Set(nets.map((n) => n.channelNumber)).size === nets.length,
    'duplicate channelNumber — the channel strip ordering must be total',
  );

export const overrideSchema = z
  .object({
    name: z.string().min(1),
    overview: z.string(),
    firstAirYear: z.number().int(),
    backdrop: z.string().startsWith('/'),
    networkSlug: slugSchema,
  })
  .partial()
  .strict();

/** Keyed by TMDB series id (JSON object keys are strings). */
export const overridesFileSchema = z.record(z.string().regex(/^-?\d+$/), overrideSchema);

export const seriesSourceSchema = z.object({
  slug: slugSchema,
  tmdbId: tmdbIdSchema,
  networkSlug: slugSchema,
  type: seriesTypeSchema,
  age: ageBandSchema,
});

export const seriesSourceFileSchema = z
  .array(seriesSourceSchema)
  .refine((all) => new Set(all.map((s) => s.slug)).size === all.length, 'duplicate series slug')
  .refine((all) => new Set(all.map((s) => s.tmdbId)).size === all.length, 'duplicate series tmdbId');

export const historicalSeriesSeedSchema = z
  .object({
    tmdbId: tmdbIdSchema.refine((id) => id < 0, 'a historical placeholder id must be negative'),
    name: z.string().min(1),
    overview: z.string().min(1),
    firstAirYear: z.number().int().min(1900),
    lastAirYear: z.number().int().min(1900),
  })
  .refine((seed) => seed.lastAirYear >= seed.firstAirYear, 'lastAirYear must not precede firstAirYear');

export const historicalSeriesSeedsFileSchema = z
  .array(historicalSeriesSeedSchema)
  .refine((all) => new Set(all.map((seed) => seed.tmdbId)).size === all.length, 'duplicate historical series id');

export const tmdbSeriesMetadataSchema = z.object({
  tmdbId: z.number().int().positive(),
  name: z.string().min(1),
  originalName: z.string().min(1),
  overview: z.string(),
  firstAirDate: z.string().date().nullable(),
  lastAirDate: z.string().date().nullable(),
  backdrop: z.string().startsWith('/').nullable(),
  poster: z.string().startsWith('/').nullable(),
  genres: z.array(z.string().min(1)),
});

export const tmdbMetadataFileSchema = z.object({
  fetchedAt: z.string().datetime(),
  matches: z.record(z.string().regex(/^-\d+$/), tmdbSeriesMetadataSchema),
});

export const networkProgrammeLineupSchema = z.object({
  networkSlug: slugSchema,
  seriesSlugs: z.array(slugSchema),
});

export const networkProgrammeLineupsFileSchema = z
  .array(networkProgrammeLineupSchema)
  .refine(
    (all) => new Set(all.map((lineup) => lineup.networkSlug)).size === all.length,
    'duplicate network programme lineup',
  );

export const historicalGuideSchema = z.object({
  id: slugSchema,
  broadcaster: z.string().min(1),
  networkSlug: slugSchema,
  channelId: slugSchema.nullable(),
  requestedFrom: z.string().date(),
  requestedTo: z.string().date(),
  coverage: z.enum(['direct', 'reconstructed', 'partial', 'not-yet-launched']),
  evidenceDate: z.string().date().nullable(),
  sourceUrls: z.array(z.string().url()),
  note: z.string().min(1),
  seriesSlugs: z.array(slugSchema),
  excludedTitles: z.array(z.string().min(1)),
});

export const historicalGuidesFileSchema = z
  .array(historicalGuideSchema)
  .refine((all) => new Set(all.map((guide) => guide.id)).size === all.length, 'duplicate historical guide id')
  .refine(
    (all) => new Set(all.flatMap((guide) => guide.channelId ? [guide.channelId] : [])).size ===
      all.filter((guide) => guide.channelId !== null).length,
    'a live historical channel can only belong to one guide',
  );

export const channelSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  language: contentLanguageSchema,
  note: z.string(),
});

export const channelsFileSchema = z.array(channelSourceSchema);

export const playlistSourceSchema = z
  .object({
    id: z.string().min(1),
    // Null means "not looked up yet", not "has no title". An empty string
    // would be a third state meaning the same thing, so it is rejected.
    name: z.string().min(1).nullable().default(null),
    curator: z.string().min(1).nullable().default(null),
    language: contentLanguageSchema,
    // Scoping is what keeps a third-party playlist from reaching series it has
    // no business matching, and match.ts scopes with `covers.includes(slug)` —
    // so an empty list is not a looser playlist, it is an inert one that ingests
    // and then silently matches nothing.
    covers: z.array(slugSchema).min(1, 'a playlist must name at least one series it covers'),
    // Absent in a hand-written entry means the ordinary candidate-pool
    // behaviour, which is what every playlist did before this field existed.
    episodesFor: slugSchema.nullable().default(null),
    // Null is "no ceiling", the behaviour every playlist had before this field
    // existed. A ceiling only makes sense on a playlist that authors an
    // episode list — the candidate-pool path scores against TMDB's own list
    // and never numbers an upload it did not match.
    maxDurationSeconds: z.number().int().positive().nullable().default(null),
    note: z.string(),
  })
  .superRefine((playlist, ctx) => {
    // A playlist that owns a series' episode list but is not scoped to that
    // series is self-contradictory: it would author the rows and then be
    // filtered out of matching them.
    if (playlist.episodesFor !== null && !playlist.covers.includes(playlist.episodesFor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['episodesFor'],
        message: `'${playlist.episodesFor}' is not in covers (${playlist.covers.join(', ')}) — a playlist cannot own the episode list of a series it is not scoped to`,
      });
    }
    // A ceiling on a candidate-pool playlist would read as a working filter
    // and do nothing: that path numbers TMDB's episodes, never the uploads.
    if (playlist.maxDurationSeconds !== null && playlist.episodesFor === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxDurationSeconds'],
        message:
          'maxDurationSeconds only applies to a playlist that owns an episode list — set episodesFor, or drop the ceiling',
      });
    }
  });

/**
 * Several playlists may together be one series' episode list.
 *
 * A curator rarely gathers a whole show into a single list — one holds the
 * first two seasons and another the rest, or a rights-holder splits the
 * uploads across two lists years apart. Turning the second one away leaves
 * real episodes out of the archive.
 *
 * What made two owners a problem was never the count, it was the ordering:
 * two lists are two sequences, and merging them by guesswork picks an episode
 * order nobody chose. So the order is stated instead of inferred — **the
 * playlists are concatenated in the order they appear in this file**, exactly
 * as the array order in content/videos.json is the episode order there. Where
 * a playlist sits in the file is a decision, not a formality.
 *
 * `derivePlaylistSeries` drops a video already contributed by an earlier
 * playlist, so overlapping lists produce one row per episode rather than a
 * duplicate that shifts every number after it.
 */
export const playlistsFileSchema = z.array(playlistSourceSchema).superRefine((all, ctx) => {
  // Within the file a playlist id appears once. The same list whitelisted
  // twice is a paste slip, and appending it to a series twice would number
  // every one of its episodes a second time.
  const seen = new Map<string, number>();
  all.forEach((playlist, index) => {
    const first = seen.get(playlist.id);
    if (first === undefined) {
      seen.set(playlist.id, index);
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [index, 'id'],
      message: `playlist '${playlist.id}' is already whitelisted at index ${first}`,
    });
  });
});

export const videoSetSchema = z.object({
  episodesFor: slugSchema,
  language: contentLanguageSchema,
  // A set is the whole episode list of one series, so order is meaning: the
  // position of a video here is the episode number it becomes.
  videos: z
    .array(youtubeIdSchema)
    .min(1, 'a video set must list at least one video')
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'the same video is listed twice — position is episode number, so a duplicate shifts every episode after it',
    ),
  note: z.string(),
});

export const videoSetsFileSchema = z.array(videoSetSchema).superRefine((all, ctx) => {
  const owners = new Map<string, number>();
  all.forEach((set, index) => {
    const first = owners.get(set.episodesFor);
    if (first === undefined) {
      owners.set(set.episodesFor, index);
      return;
    }
    // Two sets for one series means two orderings of its episodes, and there
    // is no correct way to merge them. Put the videos in one set instead.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [index, 'episodesFor'],
      message: `'${set.episodesFor}' already has a video set at index ${first} — one series, one list`,
    });
  });

  // Within the file, a video belongs to exactly one series. The same upload
  // appearing under two shows is a mis-transcribed id far more often than it
  // is a genuine crossover, and the schema is where that gets caught.
  const seen = new Map<string, string>();
  all.forEach((set, index) => {
    set.videos.forEach((id, position) => {
      const owner = seen.get(id);
      if (owner === undefined) {
        seen.set(id, set.episodesFor);
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'videos', position],
        message: `video '${id}' is already listed for '${owner}'`,
      });
    });
  });
});

export const queueCandidateSchema = z.object({
  youtubeId: youtubeIdSchema,
  title: z.string(),
  publishedAt: z.string(),
  score: z.number(),
  source: episodeSourceSchema,
});

export const queueEntrySchema = z.object({
  tmdbEpisodeId: tmdbIdSchema,
  seriesId: tmdbIdSchema,
  seriesSlug: slugSchema,
  season: z.number().int().nonnegative(),
  episode: z.number().int().positive(),
  episodeTitle: z.string(),
  candidates: z.array(queueCandidateSchema),
});

export const queueFileSchema = z.array(queueEntrySchema);

/* ------------------------------------------------------------------ */
/* Public outputs                                                      */
/* ------------------------------------------------------------------ */

export const publicEpisodeSchema = z.object({
  season: z.number().int().nonnegative(),
  episode: z.number().int().positive(),
  title: z.string().min(1),
  airDate: z.string().nullable(),
  runtime: z.number().int().positive().nullable(),
  status: episodeStatusSchema,
  youtubeId: youtubeIdSchema.nullable(),
  still: z.string().startsWith('/').nullable(),
  defaultAudioLanguage: contentLanguageSchema.nullable(),
  audioLanguages: z.array(contentLanguageSchema),
});

export const publicSeasonSchema = z.object({
  season: z.number().int().nonnegative(),
  name: z.string().min(1),
  episodes: z.array(publicEpisodeSchema),
});

export const seriesFileSchema = z.object({
  slug: slugSchema,
  tmdbId: tmdbIdSchema,
  name: z.string().min(1),
  overview: z.string(),
  networkSlug: slugSchema,
  networkSlugs: z.array(slugSchema).min(1),
  type: seriesTypeSchema,
  age: ageBandSchema,
  firstAirYear: z.number().int(),
  lastAirYear: z.number().int(),
  firstAirDate: z.string().nullable(),
  decade: z.string().regex(/^\d{4}s$/),
  episodeCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
  availableLanguages: z.array(contentLanguageSchema),
  dubbedLanguages: z.array(contentLanguageSchema),
  backdrop: z.string().startsWith('/').nullable(),
  poster: z.string().startsWith('/').nullable(),
  genres: z.array(z.string().min(1)),
  seasons: z.array(publicSeasonSchema),
});

export const seriesStubSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  overview: z.string(),
  networkSlug: slugSchema,
  networkSlugs: z.array(slugSchema).min(1),
  type: seriesTypeSchema,
  age: ageBandSchema,
  firstAirYear: z.number().int(),
  lastAirYear: z.number().int(),
  firstAirDate: z.string().nullable(),
  decade: z.string().regex(/^\d{4}s$/),
  episodeCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
  availableLanguages: z.array(contentLanguageSchema),
  dubbedLanguages: z.array(contentLanguageSchema),
  poster: z.string().startsWith('/').nullable(),
});

export const indexFileSchema = z.object({
  generatedAt: z.string().min(1),
  networks: networksFileSchema,
  decades: z.array(z.string().regex(/^\d{4}s$/)),
  series: z.array(seriesStubSchema),
});
