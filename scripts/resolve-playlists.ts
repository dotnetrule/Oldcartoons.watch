/**
 * Fill in the attribution a whitelisted playlist is still missing.
 *
 *   npm run resolve-playlists
 *
 * A playlist can be whitelisted from its id alone, because the id is the only
 * part anyone actually has — it is sitting in the link they pasted. The title
 * and the curator credit live on YouTube, so whoever adds the playlist may not
 * be able to reach them: no key, or no route to youtube.com at all.
 *
 * Rather than refuse the whitelist or invent a credit, `add-playlist` writes
 * null attribution and this script completes it wherever the network is — a
 * developer machine, or CI. It is the one script that deliberately mutates
 * content/ in place: filling a known gap in a record that already exists is a
 * different act from `fetch` quietly rewriting curated data behind you.
 *
 * Already-attributed playlists are left alone. Nothing here can fail the
 * build: a playlist that cannot be reached keeps its null and is reported.
 */
import type { PlaylistSource } from '../src/types';
import { playlistsFileSchema } from '../src/schemas';
import { contentPath, readValidated, writeJson } from './lib/paths';
import { getPublicPlaylistInfo } from './lib/youtube-public';

type PlaylistsResponse = {
  items: { snippet: { title: string; channelTitle: string } }[];
};

/** playlists.list — 1 quota unit. Mirrors the lookup in add-playlist.ts. */
async function lookupViaApi(id: string): Promise<{ name: string; curator: string }> {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY as string);
  url.searchParams.set('id', id);
  url.searchParams.set('part', 'snippet');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube playlists.list failed: ${response.status} ${response.statusText}`);
  }

  const snippet = ((await response.json()) as PlaylistsResponse).items[0]?.snippet;
  if (!snippet) throw new Error(`playlist ${id} was not found — is it public?`);
  return { name: snippet.title, curator: snippet.channelTitle };
}

const lookup = (id: string): Promise<{ name: string; curator: string }> =>
  process.env.YOUTUBE_API_KEY ? lookupViaApi(id) : getPublicPlaylistInfo(id);

async function main(): Promise<void> {
  const playlists = readValidated(contentPath('playlists.json'), playlistsFileSchema);
  const pending = playlists.filter((p) => p.name === null || p.curator === null);

  if (pending.length === 0) {
    console.log('every whitelisted playlist is already attributed');
    return;
  }

  const resolved = new Map<string, { name: string; curator: string }>();
  const failed: string[] = [];

  for (const playlist of pending) {
    try {
      const info = await lookup(playlist.id);
      resolved.set(playlist.id, info);
      console.log(`  ${playlist.id}: '${info.name}' by ${info.curator}`);
    } catch (error) {
      // One unreachable playlist must not cost the others their attribution.
      failed.push(playlist.id);
      console.warn(`  ${playlist.id}: ${(error as Error).message.split('\n')[0]}`);
    }
  }

  if (resolved.size === 0) {
    console.log(`resolved nothing — ${failed.length} playlist(s) stay unattributed`);
    return;
  }

  const updated: PlaylistSource[] = playlists.map((playlist) => {
    const info = resolved.get(playlist.id);
    return info ? { ...playlist, ...info } : playlist;
  });

  writeJson(contentPath('playlists.json'), playlistsFileSchema.parse(updated));
  console.log(
    `attributed ${resolved.size} playlist(s)` + (failed.length > 0 ? `, ${failed.length} still pending` : ''),
  );
}

await main();
