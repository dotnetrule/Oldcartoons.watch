<script setup lang="ts">
/**
 * Which upload of this episode to play, when there is more than one.
 *
 * The same episode often exists on YouTube several times over — a curator's
 * copy, a rights-holder upload, an English original beside a Dutch dub. They
 * are not interchangeable in practice: one may be a worse rip, one may refuse
 * to embed from here, one may be the only one carrying Dutch audio. The archive
 * picks a default and this is how a viewer overrules it.
 *
 * Nothing is drawn for the ordinary single-upload episode. A picker offering
 * one choice is furniture.
 *
 * The choice is remembered per episode rather than per series or per session.
 * A viewer who switches because one upload is unwatchable means it about that
 * episode, and would not thank us for re-deciding it on their behalf next time.
 */
import { computed, ref, watch } from 'vue';
import { useUiStore } from '../stores/ui';
import { languageLabel } from '../data/helpers';
import type { PublicEpisodeSource } from '../types';

const props = defineProps<{
  sources: PublicEpisodeSource[];
  /** Identifies the episode, so a remembered choice belongs to it alone. */
  storageKey: string;
}>();

const emit = defineEmits<{ (event: 'select', youtubeId: string): void }>();

const ui = useUiStore();
const C = computed(() => ui.C);

const open = ref(false);
const selected = ref<string | null>(null);

const STORAGE_PREFIX = 'ntv-source:';

/**
 * The remembered choice for this episode, if it still exists.
 *
 * Checked against the current list rather than trusted: an upload a viewer
 * chose weeks ago may have been taken down since, and the health check will
 * have dropped it. Falling back to the default is the right answer then.
 */
function rememberedFor(key: string, sources: PublicEpisodeSource[]): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    return stored && sources.some((source) => source.youtubeId === stored) ? stored : null;
  } catch {
    // Private browsing, or storage disabled. Not remembering is a fine outcome.
    return null;
  }
}

// A new episode is a new question. The picker closes, and any remembered choice
// for *that* episode is applied before the player settles on its default.
watch(
  () => props.storageKey,
  (key) => {
    open.value = false;
    const remembered = rememberedFor(key, props.sources);
    selected.value = remembered ?? props.sources[0]?.youtubeId ?? null;
    if (remembered && remembered !== props.sources[0]?.youtubeId) emit('select', remembered);
  },
  { immediate: true },
);

const current = computed(
  () => props.sources.find((source) => source.youtubeId === selected.value) ?? props.sources[0],
);

function choose(source: PublicEpisodeSource): void {
  open.value = false;
  if (source.youtubeId === selected.value) return;
  selected.value = source.youtubeId;
  try {
    localStorage.setItem(STORAGE_PREFIX + props.storageKey, source.youtubeId);
  } catch {
    // The switch still happens; only the memory of it is lost.
  }
  emit('select', source.youtubeId);
}

/** What each choice is called, with its spoken language when known — that is
 * usually the reason somebody is looking at this list. */
function describe(source: PublicEpisodeSource): string {
  const languages = source.audioLanguages.map(languageLabel).join(', ');
  return languages ? `${source.label} · ${languages}` : source.label;
}
</script>

<template>
  <div v-if="sources.length > 1" class="source-picker">
    <button
      type="button"
      class="source-btn"
      :style="{ color: C.dim, borderColor: C.border2 }"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      BRON {{ sources.indexOf(current!) + 1 }}/{{ sources.length }} ▾
    </button>

    <ul
      v-if="open"
      class="source-list"
      role="listbox"
      :style="{ background: C.bg2, borderColor: C.border2 }"
    >
      <li v-for="source in sources" :key="source.youtubeId" role="none">
        <button
          type="button"
          role="option"
          class="source-option"
          :aria-selected="source.youtubeId === selected"
          :style="{
            color: source.youtubeId === selected ? C.ink : C.dim2,
            background: source.youtubeId === selected ? C.railBg : 'transparent',
          }"
          @click="choose(source)"
        >
          <span class="source-label">{{ describe(source) }}</span>
          <span v-if="source.status === 'region-locked'" class="source-note" :style="{ color: C.dim }">
            regioblokkade
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.source-picker {
  position: relative;
  flex: none;
}

.source-btn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 9px;
  border: 1px solid;
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: color 120ms ease;
}

.source-btn:not(:disabled):active {
  transform: scale(0.94);
}

/* Opens upward: this sits in the bar directly under the video, so a list
   dropping down would fall off the bottom of a phone screen. */
.source-list {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 5;
  min-width: 220px;
  max-width: min(340px, 80vw);
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid;
  border-radius: 2px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.source-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  text-align: left;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  line-height: 1.35;
  cursor: pointer;
}

.source-label {
  overflow-wrap: anywhere;
}

.source-note {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
}
</style>
