import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { THEME, type TypeFilter, type ViewMode } from '../data/themes';
import { AGE_CEILINGS, type AgeCeiling } from '../data/age';
import { LANGUAGE_MODES, type ChannelLanguageMode } from '../data/language';

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
  const viewMode = ref<ViewMode>(readStored('ntv-view', 'listings', ['listings', 'covers']));
  const typeFilter = ref<TypeFilter>('All');
  // Unlike the type filter, this one survives a reload. A household that sets
  // a ceiling means it to hold — a lock that lifts itself the next time the
  // page is opened is not a lock.
  const ageFilter = ref<AgeCeiling>(readStored('ntv-age', 'All', AGE_CEILINGS));
  // Survives a reload for the same reason the ceiling does: a viewer who has
  // opened up the line-up is describing the archive they want, not making a
  // choice about this one visit. Defaults to the station as it broadcast.
  const languageMode = ref<ChannelLanguageMode>(
    readStored('ntv-language', 'dutch', LANGUAGE_MODES),
  );
  const previewSlug = ref<string | null>(null);
  const flicker = ref(false);
  const menuOpen = ref(false);

  /** Active theme tokens. Every component reads colours through this. There is
   * only one theme, so this is a computed purely so every existing `ui.C.x`
   * read stays a reactive ref access rather than a plain object property. */
  const C = computed(() => THEME);

  let flickerTimer: ReturnType<typeof setTimeout> | undefined;

  function triggerFlicker(): void {
    if (prefersReducedMotion()) return;
    flicker.value = true;
    clearTimeout(flickerTimer);
    flickerTimer = setTimeout(() => {
      flicker.value = false;
    }, 220);
  }

  function setViewMode(id: ViewMode): void {
    viewMode.value = id;
    persist('ntv-view', id);
  }

  function setTypeFilter(value: TypeFilter): void {
    typeFilter.value = value;
  }

  function setAgeFilter(value: AgeCeiling): void {
    ageFilter.value = value;
    persist('ntv-age', value);
  }

  function setLanguageMode(value: ChannelLanguageMode): void {
    languageMode.value = value;
    persist('ntv-language', value);
  }

  function setPreview(slug: string | null): void {
    previewSlug.value = slug;
  }

  function closeMenu(): void {
    menuOpen.value = false;
  }

  function toggleMenu(): void {
    menuOpen.value = !menuOpen.value;
  }

  /** Network accent colour. Used to be a switch between a network's dark- and
   * light-theme variants; with one theme it is just the network's colour. */
  function netColour(network: { colour: string }): string {
    return network.colour;
  }

  return {
    viewMode,
    typeFilter,
    ageFilter,
    languageMode,
    previewSlug,
    flicker,
    menuOpen,
    C,
    triggerFlicker,
    setViewMode,
    setTypeFilter,
    setAgeFilter,
    setLanguageMode,
    setPreview,
    netColour,
    closeMenu,
    toggleMenu,
  };
});
