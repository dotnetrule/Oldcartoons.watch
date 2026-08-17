/**
 * Weekly link rot check. Run by .github/workflows/health-check.yml.
 *
 * Costs 1 quota unit per 50 episodes, so the whole archive is a rounding error
 * against the 10,000/day allowance.
 *
 * Two signals flip a video:
 *   • the id is absent from the response — the video is gone
 *   • status.embeddable is false — the player will refuse to load it
 *
 * Both become `missing`. The dead row is kept rather than deleted: it records
 * that this upload was tried and does not work, which is what stops `match.ts`
 * from cheerfully finding it again next run. Its audio-track reading is
 * dropped, because that was a claim about a file nobody can open.
 *
 * An episode with alternates survives losing one of them — the next working
 * upload becomes the default and the viewer notices nothing. Only an episode
 * whose every upload has died reads as a gap.
 *
 * Region-locking is read here at ingest, never at render, and does not remove
 * a video — region-locked videos stay playable and get labelled.
 */
import { appendFileSync } from 'node:fs';
import type { Episode, EpisodeStatus } from '../src/types';
import { episodesFileSchema } from '../src/schemas';
import { episodeStatus } from './lib/episodes';
import { contentPath, readValidated, writeJson } from './lib/paths';
import { getVideoStatuses, isRegionLocked } from './lib/youtube';

type Change = {
  episode: Episode;
  youtubeId: string;
  from: EpisodeStatus;
  to: EpisodeStatus;
  reason: string;
  /** Whether the episode itself changed state, or an alternate absorbed it. */
  episodeWentDark: boolean;
};

async function main(): Promise<void> {
  const episodes = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const ids = [...new Set(episodes.flatMap((ep) => ep.videos.map((video) => video.youtubeId)))];

  if (ids.length === 0) {
    console.log('no episodes carry a video id yet — nothing to check');
    return;
  }

  const statuses = await getVideoStatuses(ids);
  const today = new Date().toISOString().slice(0, 10);
  const changes: Change[] = [];

  const updated = episodes.map<Episode>((ep) => {
    if (ep.videos.length === 0) return ep;

    const before = episodeStatus(ep);
    const videos = ep.videos.map((video) => {
      const live = statuses.get(video.youtubeId);
      const checked = { ...video, checkedAt: today };

      const dead = (reason: string) => {
        if (video.status !== 'missing') {
          changes.push({
            episode: ep,
            youtubeId: video.youtubeId,
            from: video.status,
            to: 'missing',
            reason,
            episodeWentDark: false,
          });
        }
        return { ...checked, status: 'missing' as const, audioLanguages: null };
      };

      if (!live) return dead('video is gone');
      if (!live.embeddable) return dead('embedding disabled');

      const status: EpisodeStatus = isRegionLocked(live) ? 'region-locked' : 'available';
      if (status !== video.status) {
        changes.push({
          episode: ep,
          youtubeId: video.youtubeId,
          from: video.status,
          to: status,
          reason:
            status === 'region-locked' ? 'region restriction added' : 'region restriction lifted',
          episodeWentDark: false,
        });
      }
      return { ...checked, status };
    });

    const after = { ...ep, videos };
    // Whether the episode as a whole lost its last playable upload is a
    // different fact from any one video dying, and it is the one worth
    // reviewing — that is the row that turns into a gap on the site.
    if (before !== 'missing' && episodeStatus(after) === 'missing') {
      for (const change of changes) {
        if (change.episode === ep) change.episodeWentDark = true;
      }
    }
    return after;
  });

  writeJson(contentPath('episodes.json'), episodesFileSchema.parse(updated));

  const summary = changes.length
    ? changes
        .map(
          (c) =>
            `- \`${c.episode.seriesId}\` S${c.episode.season}E${c.episode.episode} ` +
            `(\`${c.youtubeId}\`): **${c.from} → ${c.to}** (${c.reason})` +
            (c.episodeWentDark
              ? ' — **no working upload left, this episode is now a gap**'
              : c.to === 'missing'
                ? ' — an alternate upload took over'
                : ''),
        )
        .join('\n')
    : '_No changes — every checked video is still embeddable._';

  console.log(`checked ${ids.length} videos in ${Math.ceil(ids.length / 50)} calls`);
  console.log(summary);

  // Surfaced on the workflow run and reused as the pull request body.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Health check\n\nChecked ${ids.length} videos.\n\n${summary}\n`,
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changes.length > 0 ? 'true' : 'false'}\n`);
  }
}

await main();
