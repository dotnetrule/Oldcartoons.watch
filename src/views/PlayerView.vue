<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import { formatAirDate, pad2 } from '../data/helpers';
import { AVAILABILITY_LABELS } from '../data/themes';
import { NOCOOKIE_HOST, loadYoutubeApi, type YtPlayer } from '../player/youtubeApi';
import type { PublicEpisode } from '../types';

const props = defineProps<{ slug: string; season: string; episode: string }>();

const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);

// Route params are the real season and episode numbers, not array indices.
const seasonNumber = computed(() => Number(props.season));
const episodeNumber = computed(() => Number(props.episode));

const series = computed(() => content.series(props.slug));
const network = computed(() => content.network(series.value?.networkSlug));
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));

const season = computed(() => series.value?.seasons.find((s) => s.season === seasonNumber.value) ?? null);
const episode = computed<PublicEpisode | null>(
  () => season.value?.episodes.find((e) => e.episode === episodeNumber.value) ?? null,
);

/**
 * The next playable episode in *this* season. When the season ends, playback
 * stops — it does not roll into the next season. A season boundary is a
 * deliberate stopping point, not an obstacle to route around.
 */
const nextEpisode = computed<PublicEpisode | null>(() => {
  if (!season.value) return null;
  return (
    season.value.episodes.find((e) => e.episode > episodeNumber.value && e.status !== 'missing') ?? null
  );
});

function playEpisode(target: PublicEpisode): void {
  if (target.status === 'missing') return;
  void router.push(`/series/${props.slug}/${target.season}/${target.episode}`);
}

function playNext(): void {
  if (nextEpisode.value) playEpisode(nextEpisode.value);
}

function backToSeries(): void {
  void router.push(`/series/${props.slug}`);
}

/* ---------------------------------------------------------------- */
/* Playback                                                          */
/* ---------------------------------------------------------------- */

const mount = ref<HTMLDivElement | null>(null);
let player: YtPlayer | null = null;
let playerVideoId: string | null = null;

function destroyPlayer(): void {
  player?.destroy();
  player = null;
  playerVideoId = null;
}

async function syncPlayer(videoId: string | null): Promise<void> {
  if (!videoId) {
    destroyPlayer();
    return;
  }
  if (playerVideoId === videoId) return;

  // Moving between episodes swaps the video in the existing player rather than
  // tearing down the iframe, which keeps the rail from flashing.
  if (player) {
    playerVideoId = videoId;
    player.loadVideoById(videoId);
    return;
  }

  const YT = await loadYoutubeApi();
  const element = mount.value;
  // The route may have moved on while the API was loading.
  if (!element || episode.value?.youtubeId !== videoId) return;

  playerVideoId = videoId;
  player = new YT.Player(element, {
    host: NOCOOKIE_HOST,
    videoId,
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.ENDED) playNext();
      },
    },
  });
}

watch(
  () => episode.value?.youtubeId ?? null,
  (videoId) => {
    void syncPlayer(videoId);
  },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(destroyPlayer);
</script>

<template>
  <div v-if="series && season && episode" class="player">
    <div class="player-main">
      <div class="video" :style="{ background: C.videoBg, borderColor: C.border2 }">
        <!-- youtube-nocookie embed. No video is hosted or proxied here; the
             player is the only playback path. -->
        <div v-if="episode.youtubeId" ref="mount" class="video-frame"></div>
        <div v-else class="video-gap" :style="{ color: C.dim }">
          {{ AVAILABILITY_LABELS.missing }}
        </div>
      </div>
      <div class="player-info">
        <div class="mono" :style="{ color: colour }">
          {{ network?.name }} · S{{ pad2(episode.season) }}E{{ pad2(episode.episode) }}
          <span v-if="episode.status === 'region-locked'" :style="{ color: C.dim }">
            · {{ AVAILABILITY_LABELS['region-locked'] }}
          </span>
        </div>
        <h1 :style="{ color: C.ink }">{{ series.name }} — {{ episode.title }}</h1>
        <div class="mono dim" :style="{ color: C.dim }">
          {{ formatAirDate(episode.airDate) }}{{ episode.runtime ? ` · ${episode.runtime} min` : '' }}
        </div>
        <button class="back-btn" :style="{ borderColor: C.border2, color: C.dim2 }" @click="backToSeries">
          ← Back to series
        </button>
      </div>
    </div>
    <div class="rail" :style="{ borderColor: C.border }">
      <div class="mono rail-label" :style="{ color: C.dim }">UP NEXT</div>
      <div v-if="nextEpisode" class="rail-next" :style="{ background: C.railBg }" @click="playNext">
        <span class="rail-next-title" :style="{ color: C.ink }">{{ nextEpisode.title }}</span>
        <span class="mono" :style="{ color: C.dim }">{{ nextEpisode.runtime ? `${nextEpisode.runtime} min` : '—' }}</span>
      </div>
      <div v-else class="mono rail-end" :style="{ color: C.dim }">End of {{ season.name }}.</div>

      <div class="mono rail-label" :style="{ color: C.dim }">THIS SEASON</div>
      <div
        v-for="ep in season.episodes"
        :key="ep.episode"
        class="rail-ep"
        :style="{
          background: ep.episode === episodeNumber ? C.railBg : 'transparent',
          cursor: ep.status === 'missing' ? 'default' : 'pointer',
          opacity: ep.status === 'missing' ? 0.55 : 1,
        }"
        @click="playEpisode(ep)"
      >
        <span class="mono rail-ep-num" :style="{ color: C.dim }">{{ ep.episode }}</span>
        <span class="rail-ep-title" :style="{ color: C.ink }">{{ ep.title }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  align-items: flex-start;
}

.player-main {
  flex: 1;
  min-width: 0;
  padding: 20px 24px;
}

.video {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-frame {
  width: 100%;
  height: 100%;
}

.video-frame :deep(iframe) {
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
}

.video-gap {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
}

.player-info {
  padding: 16px 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.player-info .mono {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}

.player-info h1 {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-size: 28px;
  text-transform: uppercase;
}

.back-btn {
  align-self: flex-start;
  margin-top: 8px;
  background: none;
  border: 1px solid;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease;
}

.rail {
  width: 320px;
  flex: none;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  border-left: 1px solid;
  padding: 16px;
}

.rail-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  margin: 16px 0 8px;
}

.rail-label:first-child {
  margin-top: 0;
  margin-bottom: 10px;
}

.rail-next {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 16px;
}

.rail-next-title {
  font-family: 'Oswald', sans-serif;
  font-size: 15px;
}

.rail-next .mono {
  font-size: 11px;
}

.rail-end {
  font-size: 11px;
  margin-bottom: 16px;
  opacity: 0.8;
}

.rail-ep {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 9px 6px;
  border-radius: 2px;
  transition: background 120ms ease;
}

.rail-ep-num {
  font-size: 12px;
  width: 18px;
  flex: none;
}

.rail-ep-title {
  font-family: 'Oswald', sans-serif;
  font-size: 14px;
  flex: 1;
}
</style>
