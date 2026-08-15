/** Design tokens ported from the design bundle. The region and language
 * option sets that used to live here are gone: the catalog is one region and
 * one language now, per the implementation spec. */

import type { CSSProperties } from 'vue';

export type ViewMode = 'listings' | 'covers';

export type ThemeTokens = {
  bg: string;
  bg2: string;
  ink: string;
  dim: string;
  dim2: string;
  border: string;
  border2: string;
  hoverBg: string;
  focusBg: string;
  railBg: string;
  rowStripe: string;
  missing: string;
  flashColor: string;
  /** Typed as the CSS property rather than `string` so the flash overlay's
   * inline style satisfies Vue's StyleValue. */
  flashBlend: CSSProperties['mixBlendMode'];
  videoBg: string;
  chipFg: string;
  titleRule: string;
  heroFade: string;
};

/** The app has one look, permanently — a toggle used to sit next to
 * `VIEW_OPTS` in the header for a second, lighter palette, but nothing ever
 * set it programmatically and it turned out to be a mis-tap away from a
 * jarring flash to a half-white page. Removed rather than fixed in place. */
export const THEME: ThemeTokens = {
  bg: '#0B0F16', bg2: '#0E121A', ink: '#F3ECDD', dim: '#8A93A6', dim2: '#B7BECB',
  border: 'rgba(255,255,255,.1)', border2: 'rgba(255,255,255,.16)',
  hoverBg: 'rgba(255,255,255,.06)', focusBg: 'rgba(255,255,255,.1)', railBg: 'rgba(255,255,255,.08)',
  rowStripe: 'rgba(255,255,255,.02)', missing: '#F2544C', flashColor: '#F3ECDD', flashBlend: 'overlay',
  videoBg: '#000', chipFg: '#0B0F16', titleRule: '1px solid rgba(255,255,255,.16)', heroFade: 'rgba(11,15,22,.97)',
};

export const VIEW_OPTS: { id: ViewMode; label: string }[] = [
  { id: 'listings', label: 'LIJST' },
  { id: 'covers', label: 'POSTERS' },
];

export const TYPE_FILTERS = ['All', 'Animation', 'Live-action'] as const;

export type TypeFilter = (typeof TYPE_FILTERS)[number];

/** Availability labels. These used to be localized three ways; the spec's
 * single-language model collapses them to the schedule's own voice. */
export const AVAILABILITY_LABELS = {
  available: 'BEKIJKEN',
  'region-locked': 'REGIOBLOKKADE',
  missing: 'ONTBREEKT',
} as const;

export const COPY = {
  schedule: 'PROGRAMMERING',
  page: 'PAG',
  present: 'heden',
  firstAired: 'eerste uitzending',
  hoverHint: 'Selecteer een titel voor de eerste uitzenddatum, zender en het aantal afleveringen.',
  missingNote: 'Voor deze aflevering is nog geen video gevonden.',
} as const;
