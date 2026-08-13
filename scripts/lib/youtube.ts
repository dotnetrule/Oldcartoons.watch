/**
 * Build-time YouTube Data API v3 client. Throws on any failure.
 *
 * Quota: the daily allowance is 10,000 units. `playlistItems.list` and
 * `videos.list` cost 1 unit per call regardless of how many ids are packed
 * into them, so a full refetch of thirty channels costs well under a thousand
 * and the weekly health check costs one unit per fifty episodes.
 */

import { getPublicVideoDetails, isUnplayableTitle, listPublicPlaylistVideos } from './youtube-public';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set — cannot fetch YouTube data');
  return key;
}

async function ytGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(API_BASE + path);
  url.searchParams.set('key', apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube ${path} failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`);
  }
  return (await res.json()) as T;
}

export type YoutubeVideo = {
  youtubeId: string;
  title: string;
  description: string;
  publishedAt: string;
  /**
   * How long the upload actually runs, or null when the source could not say.
   *
   * This is the one fact that keeps the live schedule from lying. A slot built
   * on a guessed length puts the player past the end of its own video for the
   * remainder of the slot, which is a black screen and a re-buffering loop
   * rather than a short episode.
   */
  durationSeconds: number | null;
};

type PlaylistItemsResponse = {
  nextPageToken?: string;
  items: {
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      resourceId: { videoId: string };
    };
  }[];
};

type ChannelsResponse = {
  items: { contentDetails: { relatedPlaylists: { uploads: string } } }[];
};

export type VideoStatus = {
  youtubeId: string;
  embeddable: boolean;
  /** Present only when YouTube reports a restriction on the video. */
  blockedRegions: string[] | null;
  allowedRegions: string[] | null;
};

type VideosResponse = {
  items: {
    id: string;
    status: { embeddable: boolean };
    contentDetails: { regionRestriction?: { blocked?: string[]; allowed?: string[] } };
  }[];
};

/**
 * ISO 8601 duration → seconds. YouTube only ever emits the day-free form
 * (`PT1H2M3S`), and a live stream carries `P0D`, which has no length at all
 * and must read as unknown rather than as zero.
 */
export function parseIsoDuration(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

type VideoDurationsResponse = {
  items: { id: string; contentDetails: { duration?: string } }[];
};

/**
 * videos.list → the real length of each id, 1 unit per 50. Ids missing from
 * the response are gone or unreadable; they simply carry no entry, which the
 * caller reads as "length unknown" rather than as zero.
 */
export async function getVideoDurations(ids: string[]): Promise<Map<string, number>> {
  const durations = new Map<string, number>();

  for (let i = 0; i < ids.length; i += 50) {
    const data = await ytGet<VideoDurationsResponse>('/videos', {
      id: ids.slice(i, i + 50).join(','),
      part: 'contentDetails',
    });
    for (const item of data.items) {
      const seconds = parseIsoDuration(item.contentDetails.duration);
      if (seconds !== null) durations.set(item.id, seconds);
    }
  }

  return durations;
}

type VideoDetailsResponse = {
  items: { id: string; snippet: { title: string }; contentDetails: { duration?: string } }[];
};

/**
 * videos.list → the title and length of each id, 1 unit per 50.
 *
 * This is what a hand-picked video set needs and a playlist does not: a
 * playlist page states its items' titles, while a bare id states nothing at
 * all. An id missing from the response is gone, private or region-blocked,
 * and simply carries no entry — the caller reports it rather than numbering an
 * episode nobody can play.
 */
export async function getVideoDetails(ids: string[]): Promise<Map<string, YoutubeVideo>> {
  const found = new Map<string, YoutubeVideo>();

  for (let i = 0; i < ids.length; i += 50) {
    const data = await ytGet<VideoDetailsResponse>('/videos', {
      id: ids.slice(i, i + 50).join(','),
      part: 'snippet,contentDetails',
    });
    for (const item of data.items) {
      if (isUnplayableTitle(item.snippet.title)) continue;
      found.set(item.id, {
        youtubeId: item.id,
        title: item.snippet.title,
        description: '',
        publishedAt: '',
        durationSeconds: parseIsoDuration(item.contentDetails.duration),
      });
    }
  }

  return found;
}

/** channels.list → the channel's uploads playlist id. */
export async function getUploadsPlaylistId(channelId: string): Promise<string> {
  const data = await ytGet<ChannelsResponse>('/channels', {
    id: channelId,
    part: 'contentDetails',
  });
  const uploads = data.items[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error(`channel ${channelId} has no uploads playlist — is the id correct?`);
  return uploads;
}

/**
 * Every video in a playlist.
 *
 * Uses the Data API when a key is available — it is paginated and complete.
 * Without a key it falls back to reading the playlist's own public page, so a
 * pasted link can produce episode rows without a Google Cloud project first.
 * The fallback refuses to return a truncated playlist rather than quietly
 * shortening one; see scripts/lib/youtube-public.ts.
 */
export async function listPlaylistVideos(playlistId: string): Promise<YoutubeVideo[]> {
  if (!process.env.YOUTUBE_API_KEY) return listPublicPlaylistVideos(playlistId);

  const videos: YoutubeVideo[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const data = await ytGet<PlaylistItemsResponse>('/playlistItems', {
      playlistId,
      part: 'snippet',
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of data.items) {
      const videoId = item.snippet.resourceId.videoId;
      // Deleted and private entries survive in playlists with an unusable id,
      // or with a usable one and a substituted title. Neither plays.
      if (!videoId || videoId.length !== 11) continue;
      if (isUnplayableTitle(item.snippet.title)) continue;
      // Playlist position defines episode numbering for a playlist-backed
      // series, so a repeated video would shift every row after it.
      if (seen.has(videoId)) continue;
      seen.add(videoId);

      videos.push({
        youtubeId: videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
        // playlistItems.list does not carry length; videos.list does, and one
        // extra unit per fifty items is cheap against the daily allowance.
        durationSeconds: null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  const durations = await getVideoDurations(videos.map((video) => video.youtubeId));
  for (const video of videos) {
    video.durationSeconds = durations.get(video.youtubeId) ?? null;
  }

  return videos;
}

/**
 * Resolve a hand-picked set of video ids to titles and lengths, in the order
 * they were given.
 *
 * The keyed path asks videos.list once per fifty ids. Without a key each id
 * costs one page fetch, which is the honest price of a set that was never
 * gathered into a playlist — the sets are a handful of videos each, not
 * thousands.
 *
 * An id that resolves to nothing is returned as a null entry rather than being
 * dropped. Its position is an episode number, so silently closing the gap
 * would renumber every episode after it and point them at the wrong videos.
 */
export async function listVideos(ids: string[]): Promise<(YoutubeVideo | null)[]> {
  if (process.env.YOUTUBE_API_KEY) {
    const found = await getVideoDetails(ids);
    return ids.map((id) => found.get(id) ?? null);
  }

  const videos: (YoutubeVideo | null)[] = [];
  for (const id of ids) {
    videos.push(await getPublicVideoDetails(id));
  }
  return videos;
}

/**
 * videos.list for up to 50 ids at a time, 1 unit per call. An id absent from
 * the response means the video is gone — that absence is the signal, so the
 * caller compares against what it asked for.
 */
export async function getVideoStatuses(ids: string[]): Promise<Map<string, VideoStatus>> {
  const found = new Map<string, VideoStatus>();

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await ytGet<VideosResponse>('/videos', {
      id: batch.join(','),
      part: 'status,contentDetails',
    });
    for (const item of data.items) {
      const restriction = item.contentDetails.regionRestriction;
      found.set(item.id, {
        youtubeId: item.id,
        embeddable: item.status.embeddable,
        blockedRegions: restriction?.blocked ?? null,
        allowedRegions: restriction?.allowed ?? null,
      });
    }
  }

  return found;
}

/** Region-locking is decided here, at ingest — never at render. */
export function isRegionLocked(status: VideoStatus): boolean {
  return (status.blockedRegions?.length ?? 0) > 0 || (status.allowedRegions?.length ?? 0) > 0;
}
