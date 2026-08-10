/**
 * Weekly link rot check. Run by .github/workflows/health-check.yml.
 *
 * Costs 1 quota unit per 50 episodes, so the whole archive is a rounding error
 * against the 10,000/day allowance.
 *
 * Two signals flip an episode:
 *   • the id is absent from the response — the video is gone
 *   • status.embeddable is false — the player will refuse to load it
 *
 * Both become `missing`, which drops the id: the schema's invariant is that a
 * missing episode has no video, and from the app's side an unembeddable video
 * is exactly as unplayable as a deleted one. `match.ts` will not re-add it,
 * because the episode still carries a decided record.
 *
 * Region-locking is read here at ingest, never at render, and does not remove
 * an episode — region-locked episodes stay playable and get labelled.
 */
import { appendFileSync } from 'node:fs';
import type { Episode } from '../src/types';
import { episodesFileSchema } from '../src/schemas';
import { contentPath, readValidated, writeJson } from './lib/paths';
import { getVideoStatuses, isRegionLocked } from './lib/youtube';

type Change = {
  episode: Episode;
  from: Episode['status'];
  to: Episode['status'];
  reason: string;
};

async function main(): Promise<void> {
  const episodes = readValidated(contentPath('episodes.json'), episodesFileSchema);
  const checkable = episodes.filter((ep) => ep.youtubeId !== null);

  if (checkable.length === 0) {
    console.log('no episodes carry a video id yet — nothing to check');
    return;
  }

  const ids = [...new Set(checkable.map((ep) => ep.youtubeId as string))];
  const statuses = await getVideoStatuses(ids);
  const today = new Date().toISOString().slice(0, 10);
  const changes: Change[] = [];

  const updated = episodes.map<Episode>((ep) => {
    if (ep.youtubeId === null) return ep;

    const live = statuses.get(ep.youtubeId);
    const checked = { ...ep, checkedAt: today };

    if (!live) {
      changes.push({ episode: ep, from: ep.status, to: 'missing', reason: 'video is gone' });
      return { ...checked, status: 'missing', youtubeId: null, source: null };
    }

    if (!live.embeddable) {
      changes.push({ episode: ep, from: ep.status, to: 'missing', reason: 'embedding disabled' });
      return { ...checked, status: 'missing', youtubeId: null, source: null };
    }

    const status: Episode['status'] = isRegionLocked(live) ? 'region-locked' : 'available';
    if (status !== ep.status) {
      changes.push({
        episode: ep,
        from: ep.status,
        to: status,
        reason: status === 'region-locked' ? 'region restriction added' : 'region restriction lifted',
      });
    }
    return { ...checked, status };
  });

  writeJson(contentPath('episodes.json'), episodesFileSchema.parse(updated));

  const summary = changes.length
    ? changes
        .map(
          (c) =>
            `- \`${c.episode.seriesId}\` S${c.episode.season}E${c.episode.episode}: ` +
            `**${c.from} → ${c.to}** (${c.reason})`,
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
