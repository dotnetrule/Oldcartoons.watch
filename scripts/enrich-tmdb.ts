/**
 * Attach refreshable TMDB presentation metadata to the catalogue's negative
 * placeholder ids without changing the ids that own curated episode lists.
 *
 * Matches are deliberately conservative. Exact titles are safe; otherwise a
 * result needs both a close air year and meaningful title overlap. Anything
 * else is printed for review and left unchanged. A reviewed match can be set
 * explicitly with `--match slug=1234`.
 */
import { existsSync, readFileSync } from 'node:fs';
import type {
  HistoricalSeriesSeed,
  SeriesSource,
  TmdbMetadataFile,
  TmdbSeriesMetadata,
  SeriesType,
} from '../src/types';
import {
  historicalSeriesSeedsFileSchema,
  seriesSourceFileSchema,
  tmdbMetadataFileSchema,
} from '../src/schemas';
import { normalize } from './lib/similarity';
import {
  contentPath,
  readValidated,
  writeJson,
} from './lib/paths';
import {
  getImages,
  getSeriesDetail,
  searchSeries,
  type TmdbImage,
  type TmdbSeriesSearchResult,
} from './lib/tmdb';

type Identity = {
  placeholderId: number;
  slug: string;
  name: string;
  firstAirYear: number;
  type: SeriesType;
};

type Candidate = {
  result: TmdbSeriesSearchResult;
  reason: string;
};

type Arguments = {
  dryRun: boolean;
  only: Set<string> | null;
  explicitMatches: Map<string, number>;
  removals: Set<string>;
};

const METADATA_PATH = contentPath('tmdb-metadata.json');

function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

function parseArguments(argv: string[]): Arguments {
  let dryRun = false;
  let only: Set<string> | null = null;
  const explicitMatches = new Map<string, number>();
  const removals = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--series' || arg?.startsWith('--series=')) {
      const value = arg.startsWith('--series=') ? arg.slice('--series='.length) : argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--series needs a comma-separated value');
      only = new Set(value.split(',').map((slug) => slug.trim()).filter(Boolean));
      continue;
    }

    if (arg === '--match' || arg?.startsWith('--match=')) {
      const value = arg.startsWith('--match=') ? arg.slice('--match='.length) : argv[++index];
      const match = value?.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)=(\d+)$/);
      if (!match?.[1] || !match[2]) throw new Error('--match needs slug=positiveTmdbId');
      explicitMatches.set(match[1], Number(match[2]));
      continue;
    }

    if (arg === '--remove' || arg?.startsWith('--remove=')) {
      const value = arg.startsWith('--remove=') ? arg.slice('--remove='.length) : argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--remove needs a series slug');
      removals.add(value);
      continue;
    }

    throw new Error(`unknown argument '${arg}'`);
  }

  return { dryRun, only, explicitMatches, removals };
}

function readMetadata(): TmdbMetadataFile {
  if (!existsSync(METADATA_PATH)) {
    return { fetchedAt: new Date(0).toISOString(), matches: {} };
  }
  return readValidated(METADATA_PATH, tmdbMetadataFileSchema);
}

function readIdentity(
  source: SeriesSource,
  historicalById: Map<number, HistoricalSeriesSeed>,
): Identity {
  const historical = historicalById.get(source.tmdbId);
  if (historical) {
    return {
      placeholderId: source.tmdbId,
      slug: source.slug,
      name: historical.name,
      firstAirYear: historical.firstAirYear,
      type: source.type,
    };
  }

  const seedPath = contentPath(`tmdb-seed/${source.tmdbId}.json`);
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as {
    detail?: { name?: unknown; first_air_date?: unknown };
  };
  const name = seed.detail?.name;
  const firstAirDate = seed.detail?.first_air_date;
  if (typeof name !== 'string' || typeof firstAirDate !== 'string') {
    throw new Error(`${seedPath} has no usable series name and first_air_date`);
  }
  const firstAirYear = yearOf(firstAirDate);
  if (firstAirYear === null) throw new Error(`${seedPath} has invalid first_air_date '${firstAirDate}'`);
  return { placeholderId: source.tmdbId, slug: source.slug, name, firstAirYear, type: source.type };
}

function comparableTitle(value: string): string {
  return normalize(value)
    .replace(/\b(nederlandse|dutch)\s+dub\b/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/\bde\b/g, '')
    .trim();
}

function titleSimilarity(left: string, right: string): number {
  const a = comparableTitle(left);
  const b = comparableTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  let shared = 0;
  for (const token of aTokens) if (bTokens.has(token)) shared += 1;
  return (2 * shared) / (aTokens.size + bTokens.size);
}

function resultSimilarity(identity: Identity, result: TmdbSeriesSearchResult): number {
  return Math.max(
    titleSimilarity(identity.name, result.name),
    titleSimilarity(identity.name, result.original_name),
  );
}

function selectCandidate(
  identity: Identity,
  results: TmdbSeriesSearchResult[],
): Candidate | null {
  const ranked = results.map((result, index) => ({
    result,
    index,
    similarity: resultSimilarity(identity, result),
    yearDistance: Math.abs((yearOf(result.first_air_date) ?? identity.firstAirYear + 100) - identity.firstAirYear),
  }));
  const compatible = ranked.filter(
    (candidate) => identity.type !== 'Animation' || candidate.result.genre_ids.includes(16),
  );

  // An exact title may have several reboots. Air year selects the intended
  // one; a large difference is still allowed when only one exact result exists
  // because catalogue years sometimes record a Dutch premiere.
  const exact = compatible
    .filter((candidate) => candidate.similarity === 1)
    .sort((a, b) => a.yearDistance - b.yearDistance || a.index - b.index);
  const exactBest = exact[0];
  if (exactBest && exactBest.yearDistance <= 1) {
    return {
      result: exactBest.result,
      reason: `exact title; catalogue ${identity.firstAirYear}, TMDB ${yearOf(exactBest.result.first_air_date) ?? '?'}`,
    };
  }

  // Translated titles can share no words at all. TMDB search has already
  // established relevance, but only trust its first result when the air year
  // independently agrees. A close title can occur a little lower in results.
  const closeYear = compatible
    .filter((candidate) => candidate.yearDistance <= 1)
    .sort((a, b) => b.similarity - a.similarity || a.index - b.index);
  const closeBest = closeYear[0];
  if (closeBest && (closeBest.similarity >= 0.45 || closeBest.index === 0)) {
    return {
      result: closeBest.result,
      reason: `air year match; title similarity ${closeBest.similarity.toFixed(2)}`,
    };
  }

  const similar = compatible
    .filter((candidate) => candidate.similarity >= 0.75 && candidate.yearDistance <= 5)
    .sort((a, b) => b.similarity - a.similarity || a.yearDistance - b.yearDistance || a.index - b.index)[0];
  if (similar) {
    return {
      result: similar.result,
      reason: `close title (${similar.similarity.toFixed(2)}) and year (${similar.yearDistance} apart)`,
    };
  }

  return null;
}

function bestImage(images: TmdbImage[]): string | null {
  return [...images]
    .sort((a, b) => {
      const languageScore = Number(b.iso_639_1 === null) - Number(a.iso_639_1 === null);
      return languageScore || b.vote_average - a.vote_average || b.width * b.height - a.width * a.height;
    })[0]?.file_path ?? null;
}

async function fetchMetadata(tmdbId: number): Promise<TmdbSeriesMetadata> {
  const [localized, english, images] = await Promise.all([
    getSeriesDetail(tmdbId, 'nl-NL'),
    getSeriesDetail(tmdbId, 'en-US'),
    getImages(tmdbId),
  ]);

  return {
    tmdbId,
    name: localized.name || english.name,
    originalName: localized.original_name || english.original_name || english.name,
    overview: localized.overview || english.overview,
    firstAirDate: localized.first_air_date || english.first_air_date || null,
    lastAirDate: localized.last_air_date || english.last_air_date || null,
    backdrop: bestImage(images.backdrops) || localized.backdrop_path || english.backdrop_path,
    poster: localized.poster_path || english.poster_path || bestImage(images.posters),
    genres: (localized.genres?.length ? localized.genres : english.genres)?.map((genre) => genre.name) ?? [],
  };
}

async function discover(identity: Identity): Promise<{ candidate: Candidate | null; preview: string }> {
  const query = identity.name.replace(/\s*\((?:Nederlandse|Dutch)\s+dub\)\s*$/i, '');
  const localized = await searchSeries(query, 'nl-NL');
  let candidate = selectCandidate(identity, localized);
  let results = localized;
  if (!candidate) {
    const english = await searchSeries(query, 'en-US');
    candidate = selectCandidate(identity, english);
    if (english.length > results.length) results = english;
  }

  const preview = results
    .slice(0, 3)
    .map((result) => `${result.id} ${result.name} (${yearOf(result.first_air_date) ?? '?'})`)
    .join(' · ');
  return { candidate, preview };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const sources = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const historical = readValidated(
    contentPath('historical-series.json'),
    historicalSeriesSeedsFileSchema,
  );
  const historicalById = new Map(historical.map((seed) => [seed.tmdbId, seed]));
  const knownSlugs = new Set(sources.map((source) => source.slug));

  for (const slug of args.only ?? []) {
    if (!knownSlugs.has(slug)) throw new Error(`--series names unknown slug '${slug}'`);
  }
  for (const slug of args.explicitMatches.keys()) {
    if (!knownSlugs.has(slug)) throw new Error(`--match names unknown slug '${slug}'`);
  }
  for (const slug of args.removals) {
    if (!knownSlugs.has(slug)) throw new Error(`--remove names unknown slug '${slug}'`);
  }

  const current = readMetadata();
  const matches = { ...current.matches };
  for (const source of sources) {
    if (args.removals.has(source.slug)) delete matches[String(source.tmdbId)];
  }
  const targeted = args.explicitMatches.size > 0 || args.removals.size > 0;
  const selected = sources.filter(
    (source) =>
      source.tmdbId < 0 &&
      (!args.only || args.only.has(source.slug)) &&
      (!targeted || args.explicitMatches.has(source.slug)),
  );
  const identities = selected.map((source) => readIdentity(source, historicalById));
  let matched = 0;
  let unmatched = 0;

  // Small batches keep the refresh quick without creating an API burst.
  for (let index = 0; index < identities.length; index += 5) {
    const batch = identities.slice(index, index + 5);
    const results = await Promise.all(
      batch.map(async (identity) => {
        const existing = matches[String(identity.placeholderId)];
        const explicitId = args.explicitMatches.get(identity.slug);
        if (explicitId || existing) {
          const tmdbId = explicitId ?? existing!.tmdbId;
          return {
            identity,
            candidate: { result: { id: tmdbId } as TmdbSeriesSearchResult, reason: explicitId ? 'explicit match' : 'refresh' },
            preview: '',
          };
        }
        const discovery = await discover(identity);
        return { identity, ...discovery };
      }),
    );

    for (const { identity, candidate, preview } of results) {
      if (!candidate) {
        unmatched += 1;
        console.warn(`  ? ${identity.slug}: no safe match${preview ? ` — ${preview}` : ''}`);
        continue;
      }

      const metadata = await fetchMetadata(candidate.result.id);
      matches[String(identity.placeholderId)] = metadata;
      matched += 1;
      console.log(`  ✓ ${identity.slug} → ${metadata.name} (${metadata.tmdbId}; ${candidate.reason})`);
    }
  }

  const output: TmdbMetadataFile = {
    fetchedAt: new Date().toISOString(),
    matches,
  };
  tmdbMetadataFileSchema.parse(output);
  if (!args.dryRun) writeJson(METADATA_PATH, output);

  console.log(
    `${args.dryRun ? 'dry run: ' : ''}${matched} matched/refreshed, ${unmatched} left unchanged; ` +
      `${Object.keys(matches).length} total metadata records`,
  );
}

await main();
