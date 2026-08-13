/**
 * The viewer's age setting, and the one question it answers.
 *
 * `age` has been on every series since the catalogue was written, but nothing
 * ever read it. This module is where it starts to mean something, and it is
 * the single answer to "may this viewer see that programme" — the way
 * `series-status.ts` is the single answer to the status dot. Every list, the
 * guide and the live player ask here, so they cannot disagree about what is
 * locked.
 *
 * The setting is a **ceiling**, not a match. Choosing KINDEREN leaves
 * Preschool and Kids playing and locks Tween and Adult, because a household
 * that sets a limit means "nothing above this", not "only this band".
 */
import type { AgeBand } from '../types';

/** Youngest audience first. The index is the comparison. */
export const AGE_ORDER: readonly AgeBand[] = ['Preschool', 'Kids', 'Tween', 'Adult'];

/** `'All'` is the absence of a ceiling — no lock, everything plays. */
export type AgeCeiling = 'All' | AgeBand;

export const AGE_OPTS: { id: AgeCeiling; label: string }[] = [
  { id: 'All', label: 'ALLES' },
  { id: 'Preschool', label: 'PEUTERS' },
  { id: 'Kids', label: 'KINDEREN' },
  { id: 'Tween', label: 'TIENERS' },
];

export const AGE_CEILINGS: readonly AgeCeiling[] = ['All', ...AGE_ORDER];

/** What a chip says, for the notices that name the current setting. */
export const ageCeilingLabel = (ceiling: AgeCeiling): string =>
  AGE_OPTS.find((opt) => opt.id === ceiling)?.label ?? 'ALLES';

/**
 * Is this series above the viewer's ceiling?
 *
 * An unknown band never locks anything. The archive's stubs all carry one, so
 * this is only reachable through a programme whose series is not in the index
 * — and locking a title on the grounds that we could not look it up would hide
 * material for a reason that has nothing to do with its content.
 */
export function isBlockedByAge(
  age: AgeBand | null | undefined,
  ceiling: AgeCeiling,
): boolean {
  if (ceiling === 'All' || !age) return false;
  return AGE_ORDER.indexOf(age) > AGE_ORDER.indexOf(ceiling);
}

/** The lock's own voice, kept in one place so the grid, the guide and the
 * player all word it the same way. */
export const AGE_COPY = {
  chipGroup: 'Leeftijd',
  locked: 'GEBLOKKEERD',
  lockedHint: 'Valt buiten je leeftijdsinstelling',
  liveHeading: 'GEBLOKKEERD',
  /** Reads after the programme's title: "Shin-chan valt buiten …". */
  liveNotice: 'valt buiten je leeftijdsinstelling.',
  seriesNotice:
    'Deze serie valt buiten je leeftijdsinstelling. Zet de leeftijd in de balk bovenaan hoger om hem te bekijken.',
  wholeCycle: 'Op deze zender valt alles buiten je leeftijdsinstelling.',
} as const;
