/**
 * Read the audio tracks of every matched video and record them per episode.
 *
 *   npm run scan-audio            # only rows nobody has read yet
 *   npm run scan-audio -- --all   # read every row again
 *   npm run scan-audio -- --limit 50
 *
 * Why this is a separate pass rather than part of `fetch`:
 *
 * A YouTube upload can carry a dub alongside its original audio, and the Data
 * API will not admit it — `snippet.defaultAudioLanguage` names the track that
 * plays by default and stops there. The list only exists in the watch page, one
 * page fetch per video, which is a different cost shape from every other call
 * the pipeline makes (`videos.list` answers fifty ids for one quota unit). So
 * it runs on its own, keeps its own record of what it has already read, and is
 * safe to interrupt: whatever it wrote stays written.
 *
 * That record is `Episode.audioLanguages`, in three states — null for not
 * looked up, `[]` for looked up and single-track, a list for the languages on
 * offer. Only the first is re-read by default, so a second run over an archive
 * that is already scanned costs nothing.
 *
 * What it never does is change an episode's status. A watch page that will not
 * talk is not evidence a video is gone; that judgement belongs to
 * `health-check.ts`, which asks the API and gets a straight answer.
 */
import { appendFileSync } from 'node:fs';
import type { ContentLanguage, Episode } from '../src/types';
import { contentLanguageSchema, episodesFileSchema } from '../src/schemas';
import { contentPath, readValidated, writeJson } from './lib/paths';
import { readAudioTrackLanguages } from './lib/youtube-public';

/** Between page fetches. The public-page paths in this project are deliberately
 * unhurried — this walks the whole archive one video at a time, and a burst is
 * the one thing that turns a working scrape into a blocked one. */
const DELAY_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The archive curates two languages. Anything else YouTube offers is a real
 * track and simply not one this site can put on a station, so it is dropped
 * here rather than widening `ContentLanguage`. */
function toContentLanguages(tags: string[]): ContentLanguage[] {
  return tags.flatMap((tag) => {
    const parsed = contentLanguageSchema.safeParse(tag);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Two readings of the same video, compared as the file stores them. */
const sameLanguages = (a: ContentLanguage[] | null, b: ContentLanguage[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Tell the workflow whether this run learned anything.
 *
 * The health check rewrites `checkedAt` on every row every week, so "the file
 * differs" is not a usable signal for opening a pull request — it is always
 * true. This is the narrower claim the caller actually needs: at least one
 * episode now records audio it did not record before.
 */
function reportChanged(changed: boolean): void {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
  }
}

type Flags = { all: boolean; limit: number | null };

function parseFlags(argv: string[]): Flags {
  const all = argv.includes('--all');
  const limitIndex = argv.indexOf('--limit');
  const limit = limitIndex === -1 ? null : Number(argv[limitIndex + 1]);

  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('--limit takes a positive whole number of videos');
  }
  return { all, limit };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const episodes = readValidated(contentPath('episodes.json'), episodesFileSchema);

  // One reading per video, not per episode: the same upload can be numbered
  // into more than one series, and the page says the same thing both times.
  const pending = [
    ...new Set(
      episodes
        .filter((ep) => ep.youtubeId !== null && (flags.all || ep.audioLanguages === null))
        .map((ep) => ep.youtubeId as string),
    ),
  ];
  const ids = flags.limit === null ? pending : pending.slice(0, flags.limit);

  if (ids.length === 0) {
    console.log('every matched video has been read — nothing to scan');
    reportChanged(false);
    return;
  }

  console.log(`reading ${ids.length} watch pages…`);

  const readById = new Map<string, ContentLanguage[]>();
  const unreadable: string[] = [];

  for (const [index, youtubeId] of ids.entries()) {
    const tags = await readAudioTrackLanguages(youtubeId);

    if (tags === null) {
      unreadable.push(youtubeId);
    } else {
      const languages = toContentLanguages(tags);
      readById.set(youtubeId, languages);
      if (languages.length > 1) {
        console.log(`  ${youtubeId}  ${languages.join(', ')}`);
      }
    }

    if (index < ids.length - 1) await sleep(DELAY_MS);
  }

  let changedEpisodes = 0;
  const updated = episodes.map<Episode>((ep) => {
    if (ep.youtubeId === null) return ep;
    const languages = readById.get(ep.youtubeId);
    // `undefined` means this run did not read that video — either it was not
    // in scope or the page stayed quiet. Neither is a reason to overwrite what
    // an earlier run established.
    if (languages === undefined) return ep;
    if (!sameLanguages(ep.audioLanguages, languages)) changedEpisodes += 1;
    return { ...ep, audioLanguages: languages };
  });

  writeJson(contentPath('episodes.json'), episodesFileSchema.parse(updated));
  reportChanged(changedEpisodes > 0);

  // Counted over videos rather than episodes: this is a report about what was
  // read, and one upload read once is one fact.
  const dubbed = [...readById.values()].filter((languages) => languages.length > 1).length;
  const summary =
    `Read ${readById.size} of ${ids.length} videos; ${changedEpisodes} episode records changed. ` +
    `${dubbed} videos carry more than one curated audio track.` +
    (unreadable.length
      ? `\n\nThe watch page said nothing about these — blocked, age-gated, or served as a shell. ` +
        `They keep \`audioLanguages: null\` and are picked up by the next run:\n` +
        unreadable.map((id) => `- \`${id}\``).join('\n')
      : '');

  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Audio tracks\n\n${summary}\n`);
  }
}

await main();
