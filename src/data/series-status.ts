import type { SeriesFile, SeriesStub } from '../types';

export type SeriesArchiveStatus = 'empty' | 'non-dutch' | 'incomplete' | 'complete';

type SeriesAvailability = Pick<
  SeriesFile | SeriesStub,
  'availableCount' | 'episodeCount' | 'availableLanguages'
>;

export const SERIES_STATUS_META: Record<
  SeriesArchiveStatus,
  { colour: string; label: string }
> = {
  empty: { colour: '#F2544C', label: 'Geen afleveringen' },
  'non-dutch': { colour: '#4C8DF2', label: 'Niet in het Nederlands' },
  incomplete: { colour: '#F2C94C', label: 'Onvolledig' },
  complete: { colour: '#4CD97A', label: 'Compleet in het Nederlands' },
};

/** Status priority follows the action a curator needs to take: an empty
 * series is always red; an existing non-Dutch source is blue; a Dutch source
 * with gaps is yellow; only a complete Dutch run is green. */
export function seriesArchiveStatus(series: SeriesAvailability): SeriesArchiveStatus {
  if (series.availableCount === 0) return 'empty';
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
