import { reactive, computed } from 'vue';
import { THEMES, REGIONS, LANGS, THEME_OPTS, VIEW_OPTS, DECADES } from '../data/themes.js';
import { NETWORKS } from '../data/networks.js';
import { SERIES } from '../data/series.js';
import { I18N } from '../data/i18n.js';

function readStored(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return v && (!allowed || allowed.includes(v)) ? v : fallback;
  } catch {
    return fallback;
  }
}

// Module-level (singleton) reactive state — every component sharing this
// composable sees the same header/filter/preview state, matching the
// original design's single stateful root component.
const state = reactive({
  region: readStored('ntv-region', 'nlbe', ['nlbe', 'usa']),
  lang: readStored('ntv-lang', 'nl', ['nl', 'fr', 'en']),
  theme: readStored('ntv-theme', 'dark', ['dark', 'light']),
  viewMode: readStored('ntv-view', 'listings', ['listings', 'covers']),
  typeFilter: 'All',
  ageFilter: 'All',
  previewId: null,
  reportedKeys: new Set(),
  isPlaying: false,
  flicker: false,
});

let flickerTimer = null;
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function triggerFlicker() {
  if (reducedMotion) return;
  state.flicker = true;
  clearTimeout(flickerTimer);
  flickerTimer = setTimeout(() => {
    state.flicker = false;
  }, 220);
}

export function useAppState() {
  const T = computed(() => I18N[state.lang]);
  const C = computed(() => THEMES[state.theme]);
  const nets = computed(() => NETWORKS[state.region]);
  const allSeries = computed(() => SERIES[state.region]);
  const decades = computed(() => DECADES[state.region]);

  function netColor(net) {
    return state.theme === 'dark' ? net.color : net.colorLight;
  }

  function setRegion(id) {
    if (id === state.region) return;
    triggerFlicker();
    state.region = id;
    state.previewId = null;
    state.typeFilter = 'All';
    state.ageFilter = 'All';
    try {
      localStorage.setItem('ntv-region', id);
    } catch {
      /* ignore (private browsing, storage full, …) */
    }
  }

  function setLang(id) {
    state.lang = id;
    try {
      localStorage.setItem('ntv-lang', id);
    } catch {
      /* ignore */
    }
  }

  function setTheme(id) {
    if (id === state.theme) return;
    triggerFlicker();
    state.theme = id;
    try {
      localStorage.setItem('ntv-theme', id);
    } catch {
      /* ignore */
    }
  }

  function setViewMode(id) {
    state.viewMode = id;
    try {
      localStorage.setItem('ntv-view', id);
    } catch {
      /* ignore */
    }
  }

  function setTypeFilter(v) {
    state.typeFilter = v;
  }
  function setAgeFilter(v) {
    state.ageFilter = v;
  }
  function setPreview(id) {
    state.previewId = id;
  }
  function togglePlay() {
    state.isPlaying = !state.isPlaying;
  }
  function reportMissing(key) {
    state.reportedKeys.add(key);
    // Set mutation isn't reactive on its own — force the dependent computed
    // reads (rendered via .has()) to re-evaluate.
    state.reportedKeys = new Set(state.reportedKeys);
  }

  return {
    state,
    T,
    C,
    nets,
    allSeries,
    decades,
    netColor,
    REGIONS,
    LANGS,
    THEME_OPTS,
    VIEW_OPTS,
    setRegion,
    setLang,
    setTheme,
    setViewMode,
    setTypeFilter,
    setAgeFilter,
    setPreview,
    togglePlay,
    reportMissing,
    triggerFlicker,
  };
}
