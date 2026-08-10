export const THEMES = {
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

export const REGIONS = [
  { id: 'nlbe', label: 'NL·BE' },
  { id: 'usa', label: 'USA' },
];

export const LANGS = [
  { id: 'nl', label: 'NL' },
  { id: 'fr', label: 'FR' },
  { id: 'en', label: 'EN' },
];

export const THEME_OPTS = [
  { id: 'dark', label: 'DARK' },
  { id: 'light', label: 'LIGHT' },
];

export const VIEW_OPTS = [
  { id: 'listings', label: 'LISTINGS' },
  { id: 'covers', label: 'COVERS' },
];

export const DECADES = {
  nlbe: ['1970s', '1980s', '1990s'],
  usa: ['1970s', '1980s', '1990s', '2000s'],
};
