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
  kind: z.enum(['channel', 'playlist']),
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

export const channelSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  note: z.string(),
});

export const channelsFileSchema = z.array(channelSourceSchema);

export const playlistSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  curator: z.string().min(1),
  covers: z.array(slugSchema),
  note: z.string(),
});

export const playlistsFileSchema = z.array(playlistSourceSchema);

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
  type: seriesTypeSchema,
  age: ageBandSchema,
  firstAirYear: z.number().int(),
  lastAirYear: z.number().int(),
  firstAirDate: z.string().nullable(),
  decade: z.string().regex(/^\d{4}s$/),
  episodeCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
  backdrop: z.string().startsWith('/').nullable(),
  poster: z.string().startsWith('/').nullable(),
  seasons: z.array(publicSeasonSchema),
});

export const seriesStubSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  overview: z.string(),
  networkSlug: slugSchema,
  type: seriesTypeSchema,
  age: ageBandSchema,
  firstAirYear: z.number().int(),
  lastAirYear: z.number().int(),
  firstAirDate: z.string().nullable(),
  decade: z.string().regex(/^\d{4}s$/),
  episodeCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
  poster: z.string().startsWith('/').nullable(),
});

export const indexFileSchema = z.object({
  generatedAt: z.string().min(1),
  networks: networksFileSchema,
  decades: z.array(z.string().regex(/^\d{4}s$/)),
  series: z.array(seriesStubSchema),
});
