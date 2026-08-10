/** Design tokens ported from the design bundle. The region and language
 * option sets that used to live here are gone: the catalog is one region and
 * one language now, per the implementation spec. */

import type { CSSProperties } from 'vue';

export type ThemeId = 'dark' | 'light';
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

export const THEMES: Record<ThemeId, ThemeTokens> = {
  dark: {
    bg: '#0B0F16', bg2: '#0E121A', ink: '#F3ECDD', dim: '#8A93A6', dim2: '#B7BECB',
    border: 'rgba(255,255,255,.1)', border2: 'rgba(255,255,255,.16)',
    hoverBg: 'rgba(255,255,255,.06)', focusBg: 'rgba(255,255,255,.1)', railBg: 'rgba(255,255,255,.08)',
    rowStripe: 'rgba(255,255,255,.02)', missing: '#F2544C', flashColor: '#F3ECDD', flashBlend: 'overlay',
    videoBg: '#000', chipFg: '#0B0F16', titleRule: '1px solid rgba(255,255,255,.16)', heroFade: 'rgba(11,15,22,.97)',
  },
  light: {
    bg: '#F1EDE3', bg2: '#E7E1D1', ink: '#1A1B1E', dim: '#6B6A64', dim2: '#4B4A45',
    border: 'rgba(26,27,30,.14)', border2: 'rgba(26,27,30,.22)',
    hoverBg: 'rgba(26,27,30,.05)', focusBg: 'rgba(26,27,30,.08)', railBg: 'rgba(26,27,30,.07)',
    rowStripe: 'rgba(26,27,30,.025)', missing: '#A3372B', flashColor: '#1A1B1E', flashBlend: 'multiply',
    videoBg: '#15140F', chipFg: '#F1EDE3', titleRule: '3px double rgba(26,27,30,.5)', heroFade: 'rgba(241,237,227,.97)',
  },
};

export const THEME_OPTS: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'DARK' },
  { id: 'light', label: 'LIGHT' },
];

export const VIEW_OPTS: { id: ViewMode; label: string }[] = [
  { id: 'listings', label: 'LISTINGS' },
  { id: 'covers', label: 'COVERS' },
];

export const TYPE_FILTERS = ['All', 'Animation', 'Live-action'] as const;
export const AGE_FILTERS = ['All', 'Preschool', 'Kids', 'Tween', 'Adult'] as const;

export type TypeFilter = (typeof TYPE_FILTERS)[number];
export type AgeFilter = (typeof AGE_FILTERS)[number];

/** Availability labels. These used to be localized three ways; the spec's
 * single-language model collapses them to the schedule's own voice. */
export const AVAILABILITY_LABELS = {
  available: 'PLAYS',
  'region-locked': 'REGION-LOCKED',
  missing: 'MISSING',
} as const;

export const COPY = {
  schedule: 'THE SCHEDULE',
  page: 'PAGE',
  present: 'present',
  firstAired: 'first aired',
  hoverHint: 'Hover or focus a title for first-air-date, network, and episode count.',
  missingNote: 'No upload found for this episode.',
  reportLink: 'Report a working link',
  reportedThanks: 'Reported — thank you.',
} as const;
