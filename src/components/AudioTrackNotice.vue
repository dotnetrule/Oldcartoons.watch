<script setup lang="ts">
/**
 * Tells the viewer that the audio they want is on the video but not on by
 * default, and where the switch is.
 *
 * This exists because YouTube gives an embed no way to choose an audio track.
 * There is no player parameter and no IFrame API call for it; the player picks
 * a track from the viewer's own language signals, and an embedded, logged-out
 * viewer usually gets the upload's original. So the archive can put an English
 * upload carrying a Nederlandse dub on a Dutch station — which is the whole
 * point of measuring the tracks — but it cannot start it in Dutch. Saying so is
 * the honest remainder.
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
