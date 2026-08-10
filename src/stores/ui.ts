import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  THEMES,
  type AgeFilter,
  type ThemeId,
  type TypeFilter,
  type ViewMode,
} from '../data/themes';

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing, storage full — the preference just does not survive */
  }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Chrome state: theme, view mode, filters, the hover preview, and the CRT
 * flicker. Ported from the design port's `useAppState` singleton composable,
 * minus the region and language axes the spec drops. */
export const useUiStore = defineStore('ui', () => {
  const theme = ref<ThemeId>(readStored('ntv-theme', 'dark', ['dark', 'light']));
  const viewMode = ref<ViewMode>(readStored('ntv-view', 'listings', ['listings', 'covers']));
  const typeFilter = ref<TypeFilter>('All');
  const ageFilter = ref<AgeFilter>('All');
  const previewSlug = ref<string | null>(null);
  const reportedKeys = ref(new Set<string>());
  const flicker = ref(false);

  /** Active theme tokens. Every component reads colours through this. */
  const C = computed(() => THEMES[theme.value]);

  let flickerTimer: ReturnType<typeof setTimeout> | undefined;

  function triggerFlicker(): void {
    if (prefersReducedMotion()) return;
    flicker.value = true;
    clearTimeout(flickerTimer);
    flickerTimer = setTimeout(() => {
      flicker.value = false;
    }, 220);
  }

  function setTheme(id: ThemeId): void {
    if (id === theme.value) return;
    triggerFlicker();
    theme.value = id;
    persist('ntv-theme', id);
  }

  function setViewMode(id: ViewMode): void {
    viewMode.value = id;
    persist('ntv-view', id);
  }

  function setTypeFilter(value: TypeFilter): void {
    typeFilter.value = value;
  }

  function setAgeFilter(value: AgeFilter): void {
    ageFilter.value = value;
  }

  function setPreview(slug: string | null): void {
    previewSlug.value = slug;
  }

  function reportMissing(key: string): void {
    // Replacing the Set rather than mutating it is what makes the dependent
    // `.has()` reads re-evaluate.
    reportedKeys.value = new Set(reportedKeys.value).add(key);
  }

  /** Network accent, swapped for the light theme's darker variant. */
  function netColour(network: { colour: string; colourLight: string }): string {
    return theme.value === 'dark' ? network.colour : network.colourLight;
  }

  return {
    theme,
    viewMode,
    typeFilter,
    ageFilter,
    previewSlug,
    reportedKeys,
    flicker,
    C,
    triggerFlicker,
    setTheme,
    setViewMode,
    setTypeFilter,
    setAgeFilter,
    setPreview,
    reportMissing,
    netColour,
  };
});
