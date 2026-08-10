/**
 * Keyless read of a public YouTube playlist.
 *
 * The Data API is still the primary path — it is paginated, documented and
 * stable, and `scripts/lib/youtube.ts` uses it whenever YOUTUBE_API_KEY is
 * set. This module exists because the common case for adding a playlist is
 * someone pasting a link, and demanding a Google Cloud project before that
 * link can produce a single episode row is friction the archive does not need.
 *
 * It reads the playlist's own public page and parses the `ytInitialData`
 * blob the page ships to its own JavaScript. Two rules keep that honest:
 *
 *   • It walks the tree looking for renderers by name rather than following a
 *     fixed path, so a layout reshuffle does not break it.
 *   • It refuses to return a partial playlist. The first page carries about a
 *     hundred items and the rest sit behind a continuation the public page
 *     does not serve; hitting that limit throws and names YOUTUBE_API_KEY,
 *     because a playlist silently truncated at 100 is a wrong episode list
 *     rather than a smaller one.
 */
import type { YoutubeVideo } from './youtube';

const PAGE_HEADERS: Record<string, string> = {
  // hl/en keeps the parsed strings out of whatever locale the build host
  // happens to negotiate.
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/** Titles YouTube substitutes for entries that are no longer readable. They
 * carry no video anyone can play, so they are dropped at ingest exactly as
 * the API path drops items with an unusable id. */
const UNPLAYABLE_TITLES = new Set(['[private video]', '[deleted video]', '[unavailable video]']);

export const isUnplayableTitle = (title: string): boolean =>
  UNPLAYABLE_TITLES.has(title.trim().toLowerCase());

async function getPlaylistPage(playlistId: string): Promise<{ html: string; data: unknown }> {
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`;

  let res: Response;
  try {
    res = await fetch(url, { headers: PAGE_HEADERS });
  } catch (cause) {
    throw new Error(
      `could not reach youtube.com to read playlist ${playlistId} without an API key.\n` +
        `If this machine has no direct network access to YouTube, run the ingest somewhere that does.`,
      { cause },
    );
  }

  if (res.status === 404) {
    throw new Error(`playlist ${playlistId} was not found — is it public?`);
  }
  if (!res.ok) {
    throw new Error(`youtube.com returned ${res.status} ${res.statusText} for playlist ${playlistId}`);
  }

  const html = await res.text();
  const data = extractInitialData(html);
  if (data === null) {
    throw new Error(
      `could not find ytInitialData on the page for playlist ${playlistId}.\n` +
        `YouTube may have changed its page shape — set YOUTUBE_API_KEY to ingest through the Data API instead.`,
    );
  }
  return { html, data };
}

/**
 * Pull the `ytInitialData` object out of the page.
 *
 * Scanned with a brace counter rather than a regex: the blob is a megabyte of
 * nested JSON containing braces inside strings, and a regex that stops at the
 * first plausible `}` truncates it into something that parses as the wrong
 * thing.
 */
function extractInitialData(html: string): unknown {
  const marker = html.indexOf('ytInitialData');
  if (marker === -1) return null;

  const start = html.indexOf('{', marker);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const char = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every value stored under `key`, in document order. */
function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
    return out;
  }
  if (!isObject(node)) return out;

  for (const [name, value] of Object.entries(node)) {
    if (name === key) out.push(value);
    collect(value, key, out);
  }
  return out;
}

/** The first value stored under `key`, or null. */
function findFirst(node: unknown, key: string): unknown {
  return collect(node, key)[0] ?? null;
}

/** YouTube writes text as either `{ simpleText }` or `{ runs: [{ text }] }`. */
function readText(node: unknown): string | null {
  if (!isObject(node)) return null;

  if (typeof node['simpleText'] === 'string') return node['simpleText'];

  const runs = node['runs'];
  if (Array.isArray(runs)) {
    const text = runs
      .map((run) => (isObject(run) && typeof run['text'] === 'string' ? run['text'] : ''))
      .join('');
    if (text) return text;
  }
  return null;
}

/** Read a public playlist's items without an API key. */
export async function listPublicPlaylistVideos(playlistId: string): Promise<YoutubeVideo[]> {
  const { data } = await getPlaylistPage(playlistId);

  const videos: YoutubeVideo[] = [];
  const seen = new Set<string>();

  for (const entry of collect(data, 'playlistVideoRenderer')) {
    if (!isObject(entry)) continue;

    const videoId = entry['videoId'];
    if (typeof videoId !== 'string' || videoId.length !== 11) continue;

    const title = readText(entry['title']);
    if (title === null || isUnplayableTitle(title)) continue;

    // A playlist may list the same video twice. Position defines episode
    // numbering downstream, so a duplicate would shift every row after it.
    if (seen.has(videoId)) continue;
    seen.add(videoId);

    videos.push({
      youtubeId: videoId,
      title,
      // The playlist page carries neither the full description nor the upload
      // date. Nothing downstream needs them, and inventing either would put a
      // guess where the API path puts a fact.
      description: '',
      publishedAt: '',
    });
  }

  if (videos.length === 0) {
    throw new Error(
      `playlist ${playlistId} yielded no readable videos.\n` +
        `It may be private, empty, or region-blocked from this machine.`,
    );
  }

  // The public page stops at roughly one hundred items and hands the rest to
  // a continuation request it will not serve unauthenticated. Returning what
  // arrived would produce a confidently wrong episode list.
  if (findFirst(data, 'continuationItemRenderer') !== null) {
    throw new Error(
      `playlist ${playlistId} has more items than its public page serves in one` +
        ` response (read ${videos.length}).\n` +
        `Set YOUTUBE_API_KEY and re-run so the whole playlist is ingested — a` +
        ` truncated playlist is a wrong episode list, not a shorter one.`,
    );
  }

  return videos;
}

/** Read a public playlist's title and owner without an API key. */
export async function getPublicPlaylistInfo(
  playlistId: string,
): Promise<{ name: string; curator: string }> {
  const { html, data } = await getPlaylistPage(playlistId);

  const name =
    readText(findFirst(data, 'title')) ??
    /<meta\s+property="og:title"\s+content="([^"]*)"/.exec(html)?.[1] ??
    null;

  const curator =
    readText(findFirst(data, 'ownerText')) ?? readText(findFirst(data, 'videoOwnerText')) ?? null;

  if (!name || !curator) {
    throw new Error(
      `could not read the title and owner of playlist ${playlistId} from its public page.\n` +
        `Pass --name "…" --curator "…" yourself, or set YOUTUBE_API_KEY.`,
    );
  }
  return { name, curator };
}
