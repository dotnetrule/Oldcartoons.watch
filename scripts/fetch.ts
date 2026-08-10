/**
 * Step 1 of 3. Fills the disposable cache under data/ from the two upstream
 * APIs. Writes forward only — nothing here reads or mutates content/.
 *
 * Quota: 10,000 units/day. channels.list and playlistItems.list cost 1 unit
 * per call, so a full refetch of thirty channels lands well under a thousand.
 */
import {
  channelsFileSchema,
  isPlaceholderTmdbId,
  playlistsFileSchema,
  seriesSourceFileSchema,
} from '../src/schemas';
import {
  CONTENT_DIR,
  TMDB_CACHE_DIR,
  YOUTUBE_CACHE_DIR,
  contentPath,
  ensureDirs,
  readValidated,
  writeJson,
  youtubeCachePath,
} from './lib/paths';
import { getImages, getSeason, getSeriesDetail, type TmdbSeriesCache } from './lib/tmdb';
import { getUploadsPlaylistId, listPlaylistVideos, type YoutubeVideo } from './lib/youtube';

/** One cached source dump under data/youtube/{id}.json. */
export type YoutubeSourceCache = {
  fetchedAt: string;
  kind: 'channel' | 'playlist';
  id: string;
  name: string;
  /** Series slugs a playlist is scoped to; empty for channels, which are not
   * scoped because a rights-holder channel only carries its own material. */
  covers: string[];
  videos: YoutubeVideo[];
};

async function fetchYoutube(): Promise<void> {
  const channels = readValidated(contentPath('channels.json'), channelsFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);

  if (channels.length === 0 && playlists.length === 0) {
    console.log('no YouTube sources whitelisted yet — skipping YouTube fetch');
    return;
  }

  for (const channel of channels) {
    const uploads = await getUploadsPlaylistId(channel.id);
    const videos = await listPlaylistVideos(uploads);
    const cache: YoutubeSourceCache = {
      fetchedAt: new Date().toISOString(),
      kind: 'channel',
      id: channel.id,
      name: channel.name,
      covers: [],
      videos,
    };
    writeJson(youtubeCachePath(channel.id), cache);
    console.log(`  channel ${channel.name}: ${videos.length} uploads`);
  }

  // Third-party playlists ingest through the identical path — same endpoint,
  // same per-page cost. Only the recorded provenance differs, and that is what
  // lets a rotting source be identified and dropped as a unit later.
  for (const playlist of playlists) {
    const videos = await listPlaylistVideos(playlist.id);
    const cache: YoutubeSourceCache = {
      fetchedAt: new Date().toISOString(),
      kind: 'playlist',
      id: playlist.id,
      name: playlist.name,
      covers: playlist.covers,
      videos,
    };
    writeJson(youtubeCachePath(playlist.id), cache);
    console.log(`  playlist ${playlist.name} (${playlist.curator}): ${videos.length} videos`);
  }
}

async function fetchTmdb(only: string[] | null): Promise<void> {
  const all = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);

  if (only) {
    const known = new Set(all.map((s) => s.slug));
    const unknown = only.filter((slug) => !known.has(slug));
    if (unknown.length > 0) {
      throw new Error(`--series names slugs not in content/series.json: ${unknown.join(', ')}`);
    }
  }

  const selected = only ? all.filter((s) => only.includes(s.slug)) : all;

  // A series whose episode list comes from a playlist has no TMDB half to
  // fetch — `match` writes its metadata seed from the playlist itself. Asking
  // TMDB for it would fail on the placeholder id and block the one path that
  // does not need TMDB at all.
  const playlistBacked = new Set(
    playlists.map((p) => p.episodesFor).filter((slug): slug is string => slug !== null),
  );
  const series = selected.filter((s) => !playlistBacked.has(s.slug));

  const skipped = selected.length - series.length;
  if (skipped > 0) {
    console.log(`  ${skipped} series take their episodes from a playlist — no TMDB fetch needed`);
  }

  // Scoped to the selected series, so one series can be brought up without
  // first resolving a real TMDB id for every other series in the catalog.
  const unresolved = series.filter((s) => isPlaceholderTmdbId(s.tmdbId));
  if (unresolved.length > 0) {
    throw new Error(
      `${unresolved.length} series still carry placeholder TMDB ids and cannot be fetched:\n` +
        unresolved.map((s) => `  • ${s.slug} (${s.tmdbId})`).join('\n') +
        `\nLook each one up on TMDB and set its real id in content/series.json,` +
        `\nor scope this run with --series <slug,slug>.`,
    );
  }

  for (const entry of series) {
    const detail = await getSeriesDetail(entry.tmdbId);

    // Season 0 is TMDB's specials bucket; it is a real part of the archive and
    // is fetched like any other.
    const seasons = [];
    for (const season of detail.seasons) {
      seasons.push(await getSeason(entry.tmdbId, season.season_number));
    }

    const cache: TmdbSeriesCache = {
      fetchedAt: new Date().toISOString(),
      detail,
      seasons,
      images: await getImages(entry.tmdbId),
    };
    writeJson(`${TMDB_CACHE_DIR}/${entry.tmdbId}.json`, cache);

    const episodeCount = seasons.reduce((total, s) => total + s.episodes.length, 0);
    console.log(`  ${entry.slug}: ${seasons.length} seasons, ${episodeCount} episodes`);
  }
}

/** `--series slug,slug` limits the TMDB half of the run. Absent, every series
 * is fetched, exactly as before. */
function parseSeriesFilter(argv: string[]): string[] | null {
  const index = argv.findIndex((arg) => arg === '--series' || arg.startsWith('--series='));
  if (index === -1) return null;

  const arg = argv[index];
  const inline = arg?.startsWith('--series=') ? arg.slice('--series='.length) : argv[index + 1];
  if (!inline || inline.startsWith('--')) throw new Error('--series needs a value');

  const slugs = inline
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (slugs.length === 0) throw new Error('--series listed no slugs');
  return slugs;
}

async function main(): Promise<void> {
  const only = parseSeriesFilter(process.argv.slice(2));
  ensureDirs(CONTENT_DIR, TMDB_CACHE_DIR, YOUTUBE_CACHE_DIR);

  console.log('fetching YouTube sources…');
  await fetchYoutube();

  console.log(only ? `fetching TMDB metadata for ${only.join(', ')}…` : 'fetching TMDB metadata…');
  await fetchTmdb(only);

  console.log('done — cache written to data/');
}

await main();
