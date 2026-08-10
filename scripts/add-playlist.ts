/**
 * Whitelist a third-party YouTube playlist as an ingest source.
 *
 *   npm run add-playlist -- "<youtube url or playlist id>" --covers heman,spc
 *
 * This is the one hand-approval step in the playlist path. Everything after it
 * is mechanical: `fetch` pulls the playlist through the same call as a
 * channel's uploads, `match` scopes it to the series named in `--covers`, and
 * every resulting episode records provenance so a source that starts rotting
 * can be found and dropped as a unit.
 */
import type { PlaylistSource } from '../src/types';
import { playlistsFileSchema, seriesSourceFileSchema } from '../src/schemas';
import { contentPath, readValidated, writeJson } from './lib/paths';

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
    const video = url.searchParams.get('v');
    throw new Error(
      `that URL has no 'list=' parameter, so it does not identify a playlist` +
        (video ? ` — '${video}' is a video id` : '') +
        `\n\nOpen the video from inside the playlist (click it in the playlist` +
        `\nsidebar, or use the playlist's own page) and the address bar will` +
        `\nread ...&list=PLxxxxxxxx — that 'list' value is what this needs.`,
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
  name?: string;
  curator?: string;
  note: string;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      if (!key) continue;
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

  const input = positional[0];
  if (!input) {
    throw new Error(
      'usage: npm run add-playlist -- "<youtube url or playlist id>" --covers slug[,slug]',
    );
  }

  const coversRaw = flags.get('covers');
  if (!coversRaw) {
    throw new Error(
      '--covers is required: name the series slugs this playlist is allowed to match.\n' +
        'An unscoped playlist would ingest and then match nothing.',
    );
  }

  const covers = coversRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (covers.length === 0) throw new Error('--covers listed no slugs');

  return {
    input,
    covers,
    ...(flags.has('name') ? { name: flags.get('name') } : {}),
    ...(flags.has('curator') ? { curator: flags.get('curator') } : {}),
    note: flags.get('note') ?? '',
  };
}

type PlaylistsResponse = {
  items: { snippet: { title: string; channelTitle: string } }[];
};

/** playlists.list — 1 quota unit. Used only to fill in the display name and
 * the curator credit; `--name`/`--curator` skip it entirely. */
async function lookup(id: string): Promise<{ name: string; curator: string }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      'YOUTUBE_API_KEY is not set, so the playlist title cannot be looked up.\n' +
        'Either set the key, or pass --name "…" --curator "…" yourself.',
    );
  }

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

  const { name, curator } =
    args.name && args.curator ? { name: args.name, curator: args.curator } : await lookup(id);

  const entry: PlaylistSource = { id, name, curator, covers: args.covers, note: args.note };

  // Written through the same schema the build gate uses, so this cannot
  // produce a file that `npm run build-data` would later reject.
  writeJson(contentPath('playlists.json'), playlistsFileSchema.parse([...playlists, entry]));

  console.log(`whitelisted '${name}' by ${curator}`);
  console.log(`  id      ${id}`);
  console.log(`  covers  ${args.covers.join(', ')}`);
  console.log(`\nNext: npm run fetch -- --series ${args.covers.join(',')} && npm run match`);
}

await main();
