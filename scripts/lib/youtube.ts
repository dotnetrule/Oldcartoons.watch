/**
 * Build-time YouTube Data API v3 client. Throws on any failure.
 *
 * Quota: the daily allowance is 10,000 units. `playlistItems.list` and
 * `videos.list` cost 1 unit per call regardless of how many ids are packed
 * into them, so a full refetch of thirty channels costs well under a thousand
 * and the weekly health check costs one unit per fifty episodes.
 */

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

/** Every video in a playlist, 50 per page, 1 quota unit per page. */
export async function listPlaylistVideos(playlistId: string): Promise<YoutubeVideo[]> {
  const videos: YoutubeVideo[] = [];
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
      // Deleted and private entries survive in playlists with an unusable id.
      if (!videoId || videoId.length !== 11) continue;
      videos.push({
        youtubeId: videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.snippet.publishedAt,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

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
