import type { SeriesStub } from '../types';

/**
 * Search, sort and availability for a list of programmes.
 *
 * Kept out of the component so every list that shows programmes — a channel's
 * archive today, the schedule's title list tomorrow — sorts and matches by the
 * same rules rather than each growing its own comparator.
 */

export type ProgrammeSort = 'name' | 'year' | 'episodes';
export type ProgrammeAvailability = 'all' | 'playable' | 'dutch';

export type ProgrammeFilterState = {
  query: string;
  sort: ProgrammeSort;
  availability: ProgrammeAvailability;
};

export const SORT_OPTS: { id: ProgrammeSort; label: string }[] = [
  { id: 'name', label: 'NAAM' },
  { id: 'year', label: 'JAAR' },
  { id: 'episodes', label: 'AFLEVERINGEN' },
];

export const AVAILABILITY_OPTS: { id: ProgrammeAvailability; label: string }[] = [
  { id: 'all', label: 'ALLES' },
  { id: 'playable', label: 'SPEELBAAR' },
  { id: 'dutch', label: 'NEDERLANDS' },
];

export const PROGRAMME_FILTER_COPY = {
  searchLabel: 'Zoek programma',
  searchPlaceholder: 'Zoek een programma…',
  sortGroup: 'Sorteren',
  availabilityGroup: 'Beschikbaarheid',
  sortLabel: 'SORTEER',
  availabilityLabel: 'TOON',
  empty: 'Geen programma’s die aan dit filter voldoen.',
} as const;

/** The state a freshly opened list starts in: everything, sorted by name. */
export function defaultProgrammeFilter(): ProgrammeFilterState {
  return { query: '', sort: 'name', availability: 'all' };
}

/**
 * Fold a title down to what a viewer types. Diacritics go (so "Pokemon" finds
 * "Pokémon") and so does punctuation (so "yugioh" finds "Yu-Gi-Oh!"), because
 * an archive full of hyphens and apostrophes otherwise hides titles behind
 * exact punctuation nobody remembers.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const byName = (a: SeriesStub, b: SeriesStub): number =>
  a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });

const COMPARATORS: Record<ProgrammeSort, (a: SeriesStub, b: SeriesStub) => number> = {
  name: byName,
  // Oldest first, then alphabetical inside a year so the order is total and a
  // re-render never shuffles two titles from the same season past each other.
  year: (a, b) => a.firstAirYear - b.firstAirYear || byName(a, b),
  episodes: (a, b) => b.availableCount - a.availableCount || byName(a, b),
};

const MATCHES: Record<ProgrammeAvailability, (item: SeriesStub) => boolean> = {
  all: () => true,
  playable: (item) => item.availableCount > 0,
  dutch: (item) => item.availableLanguages.includes('nl'),
};

export function filterProgrammes(
  items: readonly SeriesStub[],
  state: ProgrammeFilterState,
): SeriesStub[] {
  const needle = fold(state.query);
  return items
    .filter((item) => MATCHES[state.availability](item))
    .filter((item) => needle === '' || fold(item.name).includes(needle))
    .sort(COMPARATORS[state.sort]);
}

/** Whether the list on screen is a subset, which is what earns the "x van y"
 * count and the empty-state line. */
export function isProgrammeFilterActive(state: ProgrammeFilterState): boolean {
  return state.query.trim() !== '' || state.availability !== 'all';
}
