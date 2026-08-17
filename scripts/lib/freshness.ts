/**
 * How old a cached fetch is allowed to be before it is fetched again.
 *
 * The pipeline is triggered by pushes, not by a clock, so a branch that touches
 * `scripts/` three times in an afternoon used to re-read every whitelisted
 * source three times over. Nothing upstream changed in between; the runs cost
 * quota and minutes and produced identical dumps.
 *
 * The freshness marker is the `fetchedAt` each dump already carries. That is
 * what makes this safe: a dump is only skipped when the dump is there to be
 * skipped in favour of, so `match.ts` always has something to read. On a runner
 * that means `data/` must survive between runs — see the `actions/cache` step
 * in `.github/workflows/ingest.yml`. Without it there is never a dump to find,
 * every source looks stale, and this quietly does nothing.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Long enough that a busy afternoon of pushes fetches once, short enough that
 * a playlist gaining episodes shows up the next day without anyone asking. */
export const DEFAULT_MAX_AGE_HOURS = 24;

/** What a cache dump has to carry to be old or new. Both `data/youtube/{id}.json`
 * and the TMDB episode files already do. */
type Dated = { fetchedAt?: unknown };

/**
 * How old the dump at `path` is, in hours, or null when there is nothing usable
 * there.
 *
 * Null covers three cases that all mean the same thing downstream — no file, a
 * file that is not JSON, and a file with no readable `fetchedAt` — because each
 * one leaves us unable to claim the dump is fresh, and the only safe answer to
 * that is to fetch.
 */
export function cacheAgeHours(path: string, now: Date = new Date()): number | null {
  if (!existsSync(path)) return null;

  let parsed: Dated;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Dated;
  } catch {
    return null;
  }

  if (typeof parsed.fetchedAt !== 'string') return null;
  const fetchedAt = new Date(parsed.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return null;

  // A dump stamped in the future is a clock disagreement, not a fresh read.
  // Reporting it as age 0 would pin it fresh until the clocks converge, so it
  // reads as stale and gets fetched — the same answer as an unreadable stamp.
  const ageMs = now.getTime() - fetchedAt.getTime();
  if (ageMs < 0) return null;
  return ageMs / 3_600_000;
}

/**
 * Whether the dump at `path` was written recently enough to reuse.
 *
 * A ceiling of 0 disables the skip entirely, which is what `--force` passes.
 */
export function isFresh(path: string, maxAgeHours: number, now: Date = new Date()): boolean {
  if (maxAgeHours <= 0) return false;
  const age = cacheAgeHours(path, now);
  return age !== null && age < maxAgeHours;
}

/** How a skip reads in the log. Hours to one decimal is the useful precision:
 * enough to see a re-run of the same afternoon, not so much that it is noise. */
export function freshnessLabel(path: string, now: Date = new Date()): string {
  const age = cacheAgeHours(path, now);
  return age === null ? 'unknown age' : `${age.toFixed(1)}h old`;
}
