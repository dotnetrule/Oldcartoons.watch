<script setup lang="ts">
/**
 * The two buttons that put an episode into Dutch, next to the play controls of
 * whichever player is showing it.
 *
 * Both players already ask for the right audio track by themselves — the live
 * player on every slot, the episode player on every video. This is what a
 * viewer reaches for when that quietly did not work: YouTube's own switch is
 * three taps into a gear menu that is easy to miss and, in fullscreen, easy to
 * lose. Pressing a button here asks the player the same question the page
 * already asked, and this time says out loud what came back.
 *
 * Audio is a one-shot: there is no "no audio", so the button enforces and
 * reports. Subtitles are a real toggle, because "off" is a state a viewer
 * wants.
 */
import { computed, ref, watch } from 'vue';
import { useUiStore } from '../stores/ui';
import { LANGUAGE_COPY } from '../data/language';
import {
  disableSubtitles,
  preferAudioLanguage,
  preferSubtitleLanguage,
  type YtPlayer,
} from '../player/youtubeApi';
import type { ContentLanguage } from '../types';

const props = defineProps<{
  /** Null until the embed exists; the buttons wait rather than lie. */
  player: YtPlayer | null;
  /** Which language to ask for. The live player broadcasts one per slot. */
  language: ContentLanguage;
  /** Changes whenever a different video is loaded, which is what makes a stale
   * answer stale — see the guards below. */
  videoKey: string | null;
}>();

const ui = useUiStore();
const C = computed(() => ui.C);

const status = ref<string | null>(null);
const audioBusy = ref(false);
const subtitleBusy = ref(false);
const subtitlesOn = ref(false);

const busy = computed(() => audioBusy.value || subtitleBusy.value);
const ready = computed(() => props.player !== null);

// A new video is a new set of tracks. Whatever the last one reported is not
// true of this one, and subtitles do not survive the swap.
watch(
  () => props.videoKey,
  () => {
    status.value = null;
    subtitlesOn.value = false;
    audioBusy.value = false;
    subtitleBusy.value = false;
  },
);

async function forceAudio(): Promise<void> {
  const target = props.player;
  const key = props.videoKey;
  if (!target || audioBusy.value) return;
  audioBusy.value = true;
  status.value = null;
  // Both calls below wait seconds for the player to answer. An answer about a
  // video the viewer has already left is not an answer about this one — the
  // live player hands over on its own schedule and needs this as much as the
  // rail does.
  const result = await preferAudioLanguage(target, props.language, () => props.videoKey === key);
  if (props.videoKey !== key) return;
  audioBusy.value = false;
  status.value = LANGUAGE_COPY.audio[result];
}

async function toggleSubtitles(): Promise<void> {
  const target = props.player;
  const key = props.videoKey;
  if (!target || subtitleBusy.value) return;

  if (subtitlesOn.value) {
    disableSubtitles(target);
    subtitlesOn.value = false;
    status.value = LANGUAGE_COPY.subtitles.off;
    return;
  }

  subtitleBusy.value = true;
  status.value = null;
  const result = await preferSubtitleLanguage(target, props.language, () => props.videoKey === key);
  if (props.videoKey !== key) return;
  subtitleBusy.value = false;
  subtitlesOn.value = result === 'switched' || result === 'already' || result === 'translated';
  status.value = LANGUAGE_COPY.subtitles[result];
}

function buttonStyle(active: boolean) {
  return {
    borderColor: C.value.border2,
    background: active ? C.value.ink : 'transparent',
    color: active ? C.value.chipFg : C.value.dim2,
  };
}
</script>

<template>
  <div class="track-controls">
    <button
      type="button"
      class="track-btn"
      :style="buttonStyle(false)"
      :disabled="!ready || busy"
      @click="forceAudio"
    >
      {{ LANGUAGE_COPY.audioButton }}
    </button>
    <button
      type="button"
      class="track-btn"
      :style="buttonStyle(subtitlesOn)"
      :aria-pressed="subtitlesOn"
      :disabled="!ready || busy"
      @click="toggleSubtitles"
    >
      {{ subtitlesOn ? LANGUAGE_COPY.subtitleButtonOff : LANGUAGE_COPY.subtitleButton }}
    </button>
    <!-- Polite rather than assertive: this reports on something the viewer just
         asked for, so it does not need to interrupt what they are hearing. -->
    <span v-if="status" class="track-status" role="status" :style="{ color: C.dim }">
      {{ status }}
    </span>
  </div>
</template>

<style scoped>
.track-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.track-btn {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 9px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  flex: none;
  transition: background 120ms ease, color 120ms ease;
}

.track-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.track-btn:not(:disabled):active {
  transform: scale(0.94);
}

.track-status {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  line-height: 1.4;
  min-width: 0;
}
</style>
