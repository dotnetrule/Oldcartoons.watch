/**
 * Whitelist a third-party YouTube playlist as an ingest source.
 *
 *   npm run add-playlist -- "<youtube url or playlist id>" --episodes-for spc --language en
 *   npm run add-playlist -- "<youtube url or playlist id>" --covers heman,spc
 *
 * This is the one hand-approval step in the playlist path. Everything after it
 * is mechanical: `fetch` pulls the playlist through the same call as a
 * channel's uploads, `match` scopes it to the series named in `--covers`, and
 * every resulting episode records provenance so a source that starts rotting
 * can be found and dropped as a unit.
 *
 * The two flags are two different claims about the playlist:
 *
 *   --covers        it holds uploads that may match those series' episodes.
 *                   Requires those series to have real TMDB metadata, because
 *                   TMDB is what supplies the episode list to match against.
 *
 *   --episodes-for  it *is* that series' episode list. Playlist order is
 *                   episode order, video titles are episode titles, no TMDB
 *                   needed. This is the answer for a series the catalog has
 *                   no real TMDB id for, where --covers would ingest happily
 *                   and still leave every row a gap.
 */
import type { ContentLanguage, PlaylistSource } from '../src/types';
import { playlistsFileSchema, seriesSourceFileSchema } from '../src/schemas';
import { contentPath, readValidated, writeJson } from './lib/paths';
import { getPublicPlaylistInfo } from './lib/youtube-public';

/**
 * Pull the playlist id out of whatever the user pasted.
 *
 * The common wrong turn is copying the address bar while watching a video: a
 * `watch?v=…` URL carries a *video* id and identifies no playlist at all. That
 * gets a specific error, because the alternative is a successful-looking
 * import that quietly matches nothing.
 */
function parsePlaylistId(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('no playlist URL or id given');

  // A bare id, pasted directly.
  if (!raw.includes('/') && !raw.includes('?')) return assertUsableId(raw);

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    throw new Error(`'${raw}' is neither a URL nor a playlist id`);
  }

  const list = url.searchParams.get('list');
  if (!list) {
    const video = url.searchParams.get('v') ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1) : null);
    throw new Error(
      `that URL has no 'list=' parameter, so it does not identify a playlist` +
        (video ? ` — '${video}' is a video id` : '') +
        `\n\nOpen the video from inside the playlist (click it in the playlist` +
        `\nsidebar, or use the playlist's own page) and the address bar will` +
        `\nread ...&list=PLxxxxxxxx — that 'list' value is what this needs.` +
        `\n\nIf the videos were never gathered into a playlist at all, they still` +
        `\nhave a home: list their ids under the series in content/videos.json,` +
        `\nin the order they should be numbered. See AGENTS.md.`,
    );
  }
  return assertUsableId(list);
}

function assertUsableId(id: string): string {
  // RD/UL/… mixes are generated per viewer from a seed video. They are not a
  // stable curated list and there is nothing meaningful to whitelist.
  if (/^RD/i.test(id)) {
    throw new Error(
      `'${id}' is an auto-generated YouTube mix, not a curated playlist.\n` +
        `Mixes are built per viewer and change constantly — whitelist a real playlist instead.`,
    );
  }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    throw new Error(`'${id}' does not look like a YouTube playlist id`);
  }
  return id;
}

type Args = {
  input: string;
  covers: string[];
  episodesFor: string | null;
  maxDurationSeconds: number | null;
  name?: string;
  curator?: string;
  language: ContentLanguage;
  note: string;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const knownFlags = new Set([
    'covers',
    'episodes-for',
    'max-duration',
    'name',
    'curator',
    'language',
    'note',
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      if (!key || !knownFlags.has(key)) throw new Error(`unknown option '${arg}'`);
      if (flags.has(key)) throw new Error(`--${key} was given more than once`);
      if (inline !== undefined) {
        flags.set(key, inline);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          throw new Error(`--${key} needs a value`);
        }
        flags.set(key, next);
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(`unexpected argument '${positional[1]}' — give exactly one playlist URL or id`);
  }

  const input = positional[0];
  if (!input) {
    throw new Error(
      'usage: npm run add-playlist -- "<youtube url or playlist id>" --episodes-for <slug>\n' +
        '   or: npm run add-playlist -- "<youtube url or playlist id>" --covers slug[,slug]\n' +
        'optional: --language nl|en (default: nl)\n' +
        '          --max-duration <seconds>  leave out anything longer, so a\n' +
        '                                    compilation of the episodes does not\n' +
        '                                    become one of them',
    );
  }

  const episodesFor = flags.get('episodes-for')?.trim() || null;

  const coversRaw = flags.get('covers');
  // --episodes-for is the stronger statement of the two: a playlist that *is*
  // a series' episode list is necessarily scoped to it, so it implies --covers
  // and the common single-series case needs one flag rather than two.
  const covers = coversRaw
    ? coversRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : episodesFor
      ? [episodesFor]
      : [];

  if (covers.length === 0) {
    throw new Error(
      'name the series this playlist is for.\n\n' +
        '  --episodes-for <slug>   the playlist IS that series\' episode list:\n' +
        '                          playlist order becomes episode order and video\n' +
        '                          titles become episode titles. Use this when the\n' +
        '                          series has no real TMDB metadata yet.\n\n' +
        '  --covers slug[,slug]    the playlist is a pool of candidate uploads to\n' +
        '                          match against episode lists TMDB already has.\n\n' +
        'An unscoped playlist would ingest and then match nothing.',
    );
  }

  if (episodesFor && !covers.includes(episodesFor)) {
    throw new Error(
      `--episodes-for '${episodesFor}' is not in --covers (${covers.join(', ')}) — ` +
        `a playlist cannot own the episode list of a series it is not scoped to`,
    );
  }

  const language = flags.get('language')?.trim().toLowerCase() ?? 'nl';
  if (language !== 'nl' && language !== 'en') {
    throw new Error(`--language must be 'nl' or 'en', got '${language}'`);
  }

  const maxDurationRaw = flags.get('max-duration')?.trim();
  const maxDurationSeconds = maxDurationRaw === undefined ? null : Number(maxDurationRaw);
  if (
    maxDurationSeconds !== null &&
    (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds <= 0)
  ) {
    throw new Error(`--max-duration must be a whole number of seconds, got '${maxDurationRaw}'`);
  }
  // The ceiling cuts videos out of an episode list. There is no episode list on
  // the candidate-pool path, so the flag would look like it was working and do
  // nothing at all.
  if (maxDurationSeconds !== null && episodesFor === null) {
    throw new Error(
      '--max-duration only applies to a playlist that owns an episode list.\n' +
        'Add --episodes-for <slug>, or drop the ceiling.',
    );
  }

  return {
    input,
    covers,
    episodesFor,
    maxDurationSeconds,
    ...(flags.has('name') ? { name: flags.get('name') } : {}),
    ...(flags.has('curator') ? { curator: flags.get('curator') } : {}),
    language,
    note: flags.get('note') ?? '',
  };
}

type PlaylistsResponse = {
  items: { snippet: { title: string; channelTitle: string } }[];
};

/** playlists.list — 1 quota unit. Used only to fill in the display name and
 * the curator credit; `--name`/`--curator` skip it entirely, and with no key
 * the playlist's own public page answers the same two questions. */
async function lookup(id: string): Promise<{ name: string; curator: string }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return getPublicPlaylistInfo(id);

  const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
  url.searchParams.set('key', key);
  url.searchParams.set('id', id);
  url.searchParams.set('part', 'snippet');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube playlists.list failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as PlaylistsResponse;
  const snippet = data.items[0]?.snippet;
  if (!snippet) {
    throw new Error(`playlist ${id} was not found — is it public?`);
  }
  return { name: snippet.title, curator: snippet.channelTitle };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const id = parsePlaylistId(args.input);

  const series = readValidated(contentPath('series.json'), seriesSourceFileSchema);
  const knownSlugs = new Set(series.map((s) => s.slug));
  const unknown = args.covers.filter((slug) => !knownSlugs.has(slug));
  if (unknown.length > 0) {
    throw new Error(
      `--covers names ${unknown.length} series not in content/series.json: ${unknown.join(', ')}\n` +
        `Add them there first, or correct the slug.`,
    );
  }

  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);
  if (playlists.some((p) => p.id === id)) {
    throw new Error(`playlist ${id} is already whitelisted in content/playlists.json`);
  }

  // Attribution is the one part of a playlist that lives on YouTube rather
  // than in the pasted link. Failing to reach it is not a reason to refuse the
  // whitelist — the id is the fact that matters, and `resolve-playlists` fills
  // the credit in from anywhere with a route to youtube.com.
  let name: string | null = args.name ?? null;
  let curator: string | null = args.curator ?? null;

  if (name === null || curator === null) {
    try {
      ({ name, curator } = await lookup(id));
    } catch (error) {
      console.warn(`could not look up the playlist's title and curator:`);
      console.warn(`  ${(error as Error).message.split('\n')[0]}`);
      console.warn(`whitelisting it unattributed — run 'npm run resolve-playlists' to fill that in.\n`);
    }
  }

  const entry: PlaylistSource = {
    id,
    name,
    curator,
    language: args.language,
    covers: args.covers,
    episodesFor: args.episodesFor,
    maxDurationSeconds: args.maxDurationSeconds,
    note: args.note,
  };

  // Written through the same schema the build gate uses, so this cannot
  // produce a file that `npm run build-data` would later reject.
  writeJson(contentPath('playlists.json'), playlistsFileSchema.parse([...playlists, entry]));

  console.log(name && curator ? `whitelisted '${name}' by ${curator}` : `whitelisted ${id} (unattributed)`);
  console.log(`  id      ${id}`);
  console.log(`  covers  ${args.covers.join(', ')}`);
  console.log(`  language ${args.language}`);
  if (args.maxDurationSeconds !== null) {
    console.log(`  skips anything longer than  ${args.maxDurationSeconds}s`);
  }
  if (args.episodesFor) {
    // Several playlists may make up one series' list, and where this one sits
    // in the file is where its episodes sit in the numbering. Saying so here is
    // the only place a curator finds out without reading the JSON.
    const group = playlists.filter((p) => p.episodesFor === args.episodesFor);
    console.log(
      group.length === 0
        ? `  owns the episode list for  ${args.episodesFor}`
        : `  joins the episode list for ${args.episodesFor} as source ${group.length + 1} of ${group.length + 1} — ` +
            `its videos are numbered after the ${group.length} playlist${group.length === 1 ? '' : 's'} already there`,
    );
  }

  // A playlist-backed series needs no TMDB fetch, so the next step is the
  // whole rest of the pipeline in one line.
  console.log(
    args.episodesFor
      ? `\nNext: npm run fetch && npm run match && npm run build-data`
      : `\nNext: npm run fetch -- --series ${args.covers.join(',')} && npm run match`,
  );
}

await main();
