import type { SeriesFile, SeriesStub } from '../types';

export type SeriesArchiveStatus = 'empty' | 'non-dutch' | 'dubbed' | 'incomplete' | 'complete';

type SeriesAvailability = Pick<
  SeriesFile | SeriesStub,
  'availableCount' | 'episodeCount' | 'availableLanguages' | 'dubbedLanguages'
>;

export const SERIES_STATUS_META: Record<
  SeriesArchiveStatus,
  { colour: string; label: string }
> = {
  empty: { colour: '#F2544C', label: 'Geen afleveringen' },
  'non-dutch': { colour: '#4C8DF2', label: 'Niet in het Nederlands' },
  dubbed: { colour: '#4CB8D9', label: 'Nederlands als extra audiospoor' },
  incomplete: { colour: '#F2C94C', label: 'Onvolledig' },
  complete: { colour: '#4CD97A', label: 'Compleet in het Nederlands' },
};

/**
 * Status priority follows the action a curator needs to take: an empty series
 * is always red; a source with no Dutch at all is blue; Dutch that only exists
 * as an extra audio track is a paler blue, because it plays but not by itself;
 * a Dutch source with gaps is yellow; only a complete Dutch run is green.
 *
 * The `dubbed` rung is what keeps the green one honest. A video whose Dutch is
 * a dub the viewer has to select is genuinely watchable in Dutch and genuinely
 * not a Dutch upload, and collapsing the two would have the archive claim a
 * Nederlandse bron it does not hold — the exact claim the "NEDERLANDSE BRON
 * GEZOCHT" call-to-action exists to keep open.
 */
export function seriesArchiveStatus(series: SeriesAvailability): SeriesArchiveStatus {
  if (series.availableCount === 0) return 'empty';
  if (!series.availableLanguages.includes('nl')) return 'non-dutch';
  if (series.dubbedLanguages.includes('nl')) return 'dubbed';
  if (series.availableLanguages.some((language) => language !== 'nl')) return 'non-dutch';
  if (series.availableCount < series.episodeCount) return 'incomplete';
  return 'complete';
}

export function seriesArchiveStatusLabel(series: SeriesAvailability): string {
  const status = seriesArchiveStatus(series);
  if (status === 'incomplete') {
    return `${SERIES_STATUS_META[status].label} · ${series.availableCount} van ${series.episodeCount} afleveringen`;
  }
  return SERIES_STATUS_META[status].label;
}
