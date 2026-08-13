<script setup lang="ts">
/**
 * Tells the viewer that the audio they want is on the video but not on by
 * default, and where the switch is.
 *
 * The fallback, not the plan. `preferAudioLanguage` switches the track itself
 * on embeds that expose YouTube's undocumented audio-track methods, and where
 * that works the viewer never sees this. Nothing promises those methods will
 * stay, and YouTube documents no supported alternative — no player parameter,
 * no IFrame API call — so when the player will not say what it is carrying,
 * this is what is left. An embedded, logged-out viewer usually gets the
 * upload's original: the archive can put an English upload carrying a
 * Nederlandse dub on a Dutch station, and then has to admit it started in
 * English and say where the switch is.
 *
 * Dismissible and remembered, because it is an instruction rather than a
 * warning: once a viewer knows where the menu is, repeating it every episode is
 * noise.
 */
import { computed, ref } from 'vue';
import { useUiStore } from '../stores/ui';
import { languageLabel } from '../data/helpers';
import type { ContentLanguage } from '../types';

const props = defineProps<{
  /** The language that is on the video but not playing. */
  language: ContentLanguage;
}>();

const ui = useUiStore();
const C = computed(() => ui.C);

const STORAGE_KEY = 'ntv-audio-notice';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

const dismissed = ref(readDismissed());

function dismiss(): void {
  dismissed.value = true;
  try {
    localStorage.setItem(STORAGE_KEY, 'dismissed');
  } catch {
    /* private browsing, storage full — the viewer sees it again next time */
  }
}
</script>

<template>
  <div
    v-if="!dismissed"
    class="audio-notice mono"
    :style="{ background: C.railBg, borderColor: C.border2, color: C.dim2 }"
  >
    <span class="audio-notice-text">
      Deze aflevering heeft een {{ languageLabel(props.language).toLowerCase() }} audiospoor, maar
      start in de taal van de upload. Kies in de speler het tandwiel → “Audiotrack” →
      {{ languageLabel(props.language) }}.
    </span>
    <button
      class="audio-notice-close"
      type="button"
      aria-label="Melding sluiten"
      :style="{ borderColor: C.border2, color: C.dim2 }"
      @click="dismiss"
    >
      Sluiten
    </button>
  </div>
</template>

<style scoped>
.audio-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid;
  font-size: 11px;
  line-height: 1.5;
}

.audio-notice-text {
  flex: 1;
  min-width: 0;
}

.audio-notice-close {
  flex: none;
  padding: 3px 10px;
  border: 1px solid;
  border-radius: 2px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
</style>
