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
  // Without these, a request from an EU-routed host is answered with a consent
  // interstitial that carries no playlist at all. They record a consent
  // decision, which is the same thing a browser sends after the dialog.
  cookie: 'CONSENT=YES+cb; SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
};

/** Titles YouTube substitutes for entries that are no longer readable. They
 * carry no video anyone can play, so they are dropped at ingest exactly as
 * the API path drops items with an unusable id. */
const UNPLAYABLE_TITLES = new Set(['[private video]', '[deleted video]', '[unavailable video]']);

export const isUnplayableTitle = (title: string): boolean =>
  UNPLAYABLE_TITLES.has(title.trim().toLowerCase());

/**
 * What the page actually contained, for when parsing finds nothing.
 *
 * YouTube reshapes these pages, and "no readable videos" on its own cannot
 * tell a private playlist from a layout this parser has fallen behind. A
 * census of the renderer keys present separates the two on the first failure
 * instead of the third.
 */
function describePage(html: string, data: unknown): string {
  const counts = new Map<string, number>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (/(?:Renderer|ViewModel)$/.test(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      walk(value);
    }
  };
  walk(data);

  const census = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, count]) => `${key}×${count}`)
    .join(', ');

  return (
    `page ${html.length} bytes; ` +
    (census ? `renderers seen: ${census}` : 'no renderer keys found in ytInitialData')
  );
}

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
  return extractJsonBlob(html, 'ytInitialData');
}

/**
 * Pull one of the page's inline JSON blobs out by the name it is assigned to.
 *
 * A playlist page carries its rows in `ytInitialData`; a watch page states the
 * video's own title and length in `ytInitialPlayerResponse`. Same brace
 * counting, two different blobs.
 */
function extractJsonBlob(html: string, name: string): unknown {
  const marker = html.indexOf(name);
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

/**
 * Undo the escaping a value picks up from being read out of raw HTML or out of
 * a JSON string literal inside it. Returns null for a missing or empty match,
 * so a failed regex and an empty capture read the same to the caller.
 */
function decodeHtml(value: string | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["\\/])/g, '$1')
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>')
    .trim();
  return text || null;
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

/** `7:12` or `1:02:03` → seconds. Anything else is not a running time. */
function parseClock(value: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

/**
 * How long the row says its video runs.
 *
 * The classic renderer states it outright as `lengthSeconds`. The lockup shape
 * dropped that field and only paints the running time into a thumbnail badge,
 * so the badge text is read back — the clock pattern is specific enough that
 * no other string in a playlist row matches it.
 *
 * Null means the page did not say, never that the video is zero seconds long:
 * the schedule falls back to its editorial slot for exactly that case.
 */
function readDuration(entry: JsonObject): number | null {
  for (const value of collect(entry, 'lengthSeconds')) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  }

  // Deliberately not a search for any clock-shaped string in the row: an
  // episode titled "Rush Hour 2:15" would hand back a running time nobody
  // measured, and a wrong slot length is worse than an admitted guess. Only
  // the length field and the thumbnail's own badge area are consulted.
  const texts = [
    ...collect(entry, 'lengthText'),
    ...collect(entry, 'thumbnailBadgeViewModel'),
    ...collect(entry['contentImage'] ?? {}, 'text'),
  ];
  for (const candidate of texts) {
    const text =
      typeof candidate === 'string'
        ? candidate
        : (readText(candidate) ??
          (isObject(candidate) && typeof candidate['text'] === 'string' ? candidate['text'] : null));
    const seconds = text === null ? null : parseClock(text);
    if (seconds !== null) return seconds;
  }

  return null;
}

/** One playlist row, from whichever of the two shapes the page used. */
function readEntry(
  entry: unknown,
): { youtubeId: string; title: string; durationSeconds: number | null } | null {
  if (!isObject(entry)) return null;

  // The classic shape: `playlistVideoRenderer`, id and title side by side.
  // The newer one: `lockupViewModel`, where the id is `contentId` and the
  // title sits inside a nested metadata view model.
  const videoId = entry['videoId'] ?? entry['contentId'];
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;

  const title =
    readText(entry['title']) ??
    // lockup titles are plain `{ content: "…" }` rather than runs/simpleText,
    // and sit a few levels down under `metadata`.
    (() => {
      for (const candidate of collect(entry['metadata'] ?? entry, 'title')) {
        const text = readText(candidate);
        if (text) return text;
        if (isObject(candidate) && typeof candidate['content'] === 'string') {
          return candidate['content'];
        }
      }
      return null;
    })();

  if (title === null || isUnplayableTitle(title)) return null;
  return { youtubeId: videoId, title, durationSeconds: readDuration(entry) };
}

/** Read a public playlist's items without an API key. */
export async function listPublicPlaylistVideos(playlistId: string): Promise<YoutubeVideo[]> {
  const { html, data } = await getPlaylistPage(playlistId);

  const videos: YoutubeVideo[] = [];
  const seen = new Set<string>();

  const rows = [...collect(data, 'playlistVideoRenderer'), ...collect(data, 'lockupViewModel')];

  for (const row of rows) {
    const entry = readEntry(row);
    if (!entry) continue;

    // A playlist may list the same video twice. Position defines episode
    // numbering downstream, so a duplicate would shift every row after it.
    if (seen.has(entry.youtubeId)) continue;
    seen.add(entry.youtubeId);

    videos.push({
      youtubeId: entry.youtubeId,
      title: entry.title,
      // The playlist page carries neither the full description nor the upload
      // date. Nothing downstream needs them, and inventing either would put a
      // guess where the API path puts a fact.
      description: '',
      publishedAt: '',
      durationSeconds: entry.durationSeconds,
    });
  }

  if (videos.length === 0) {
    throw new Error(
      `playlist ${playlistId} yielded no readable videos.\n` +
        `It may be private, empty, or region-blocked from this machine — or the\n` +
        `page shape may have moved on. ${describePage(html, data)}\n` +
        `Setting YOUTUBE_API_KEY switches to the Data API and sidesteps all of this.`,
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

/**
 * Read one video's own title and length without an API key.
 *
 * A hand-picked set arrives as bare ids, which state nothing: no title to
 * number an episode by, no length to cut a broadcast slot from. Both sit in
 * the watch page's `ytInitialPlayerResponse`, which is the same kind of inline
 * blob the playlist path already reads.
 *
 * Returns null when the page will not say — private, removed, age-gated or
 * region-blocked from this machine. The caller names the id rather than
 * numbering an episode around a video nobody can watch.
 */
export async function getPublicVideoDetails(videoId: string): Promise<YoutubeVideo | null> {
  // Title first, and from oEmbed rather than the watch page. oEmbed is a
  // documented endpoint that answers a plain question with a plain JSON
  // object; the watch page is an app shell that decides how much to tell an
  // unauthenticated stranger, and on a datacentre IP it routinely decides on
  // nothing at all. The playlist path gets away with reading a page because a
  // playlist page still lists its items.
  const title = await readOembedTitle(videoId);

  // Length is best-effort on this path. It only lives in the watch page, so a
  // page that will not talk costs a measured slot and nothing else — the
  // schedule falls back to its editorial slot and marks the broadcast as
  // estimated, which is a smaller lie than a missing episode.
  const durationSeconds = await readWatchPageDuration(videoId);

  if (title === null || isUnplayableTitle(title)) return null;

  return {
    youtubeId: videoId,
    title,
    // As on the playlist path: neither source states a description or an
    // upload date this cares about, and inventing either would put a guess
    // where the API path puts a fact.
    description: '',
    publishedAt: '',
    durationSeconds,
  };
}

/**
 * oEmbed → the video's title, or null when it will not say.
 *
 * Null covers every reason a video is not readable — private, removed,
 * age-gated, region-blocked — because none of them changes what the caller
 * does about it.
 */
async function readOembedTitle(videoId: string): Promise<string | null> {
  const url =
    `https://www.youtube.com/oembed?format=json&url=` +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);

  let res: Response;
  try {
    res = await fetch(url, { headers: PAGE_HEADERS });
  } catch (cause) {
    throw new Error(
      `could not reach youtube.com to read video ${videoId} without an API key.\n` +
        `If this machine has no direct network access to YouTube, run the ingest somewhere that does.`,
      { cause },
    );
  }

  // 401/403/404 here all mean the same thing to a caller: this id yields no
  // video anyone can watch.
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as unknown;
  if (!isObject(body)) return null;
  return typeof body['title'] === 'string' && body['title'].length > 0 ? body['title'] : null;
}

/**
 * The watch page's `lengthSeconds`, or null when the page will not say.
 *
 * Never throws. A missing length is a slot the schedule has to estimate, and
 * that is not worth failing an ingest over — the caller has already got the
 * video's identity from a source that does answer.
 */
async function readWatchPageDuration(videoId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
      { headers: PAGE_HEADERS },
    );
    if (!res.ok) return null;

    const player = extractJsonBlob(await res.text(), 'ytInitialPlayerResponse');
    const details = isObject(player) ? player['videoDetails'] : null;
    if (!isObject(details)) return null;

    // A page that answered about a different id was redirected to something
    // else, and its length describes that other video.
    if (typeof details['videoId'] === 'string' && details['videoId'] !== videoId) return null;

    // A live stream reports zero, which is not a length.
    const seconds = Number(details['lengthSeconds']);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
  } catch {
    return null;
  }
}

/** Read a public playlist's title and owner without an API key. */
export async function getPublicPlaylistInfo(
  playlistId: string,
): Promise<{ name: string; curator: string }> {
  const { html, data } = await getPlaylistPage(playlistId);

  // og:title is the one thing every layout of this page has agreed on, so it
  // leads and the renderer tree is the fallback rather than the other way
  // round.
  const name =
    decodeHtml(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*)"/.exec(html)?.[1]) ??
    readText(findFirst(data, 'title')) ??
    null;

  const curator =
    readText(findFirst(data, 'ownerText')) ??
    readText(findFirst(data, 'videoOwnerText')) ??
    // Newer layouts drop ownerText entirely and carry the channel name as a
    // plain string somewhere in the page payload.
    decodeHtml(/"(?:ownerChannelName|channelName)":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1]) ??
    null;

  if (!name || !curator) {
    throw new Error(
      `could not read the title and owner of playlist ${playlistId} from its public page.\n` +
        `${describePage(html, data)}\n` +
        `Pass --name "…" --curator "…" yourself, or set YOUTUBE_API_KEY.`,
    );
  }
  return { name, curator };
}
