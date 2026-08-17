/**
 * The archive's era, in one place.
 *
 * Two separate limits, because they answer two different questions and a single
 * year could not do both honestly:
 *
 *   • Which shows belong here at all — asked of a series, once, at fetch time.
 *   • Which of a show's episodes are in period — asked of every episode, at
 *     build time.
 *
 * A series that began in 2001 and ran to 2012 is in the archive; the seasons it
 * broadcast after the episode ceiling are not. Neither limit deletes anything
 * from `content/` — the series cutoff decides where network calls are spent,
 * and the episode cutoff decides what `public/data/` says.
 */

/** A series is in scope when it first aired in or before this year. */
export const SERIES_MAX_FIRST_AIR_YEAR = 2005;

/** An episode is shown when it aired in or before this year. */
export const EPISODE_MAX_AIR_YEAR = 2008;

/** The year an ISO date falls in, or null when there is no usable date. */
export function yearOfDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(String(date).slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

/**
 * Whether a series is recent enough to spend a fetch on.
 *
 * A series with no known first air year is kept. The catalogue cannot produce
 * one — `build-data.ts` throws before that can happen — so this arm exists to
 * be safe rather than to be used, and erring towards inclusion matches the
 * episode rule below.
 */
export function isSeriesInScope(firstAirYear: number | null): boolean {
  if (firstAirYear === null) return true;
  return firstAirYear <= SERIES_MAX_FIRST_AIR_YEAR;
}

/**
 * Whether an episode aired inside the archive's period.
 *
 * No air date counts as in scope. That is a deliberate reading of an absence:
 * TMDB leaves the date off plenty of pre-1990 animation, and every episode a
 * playlist authored has none at all, so treating "unknown" as "too recent"
 * would empty the archive rather than trim it. An episode is only cut when a
 * date exists and puts it past the ceiling.
 */
export function isEpisodeInScope(airDate: string | null | undefined): boolean {
  const year = yearOfDate(airDate);
  if (year === null) return true;
  return year <= EPISODE_MAX_AIR_YEAR;
}
