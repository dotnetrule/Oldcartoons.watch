<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import { formatAirDate, pad2 } from '../data/helpers';
import { AVAILABILITY_LABELS } from '../data/themes';
import { useFullscreen } from '../player/fullscreen';
import {
  NOCOOKIE_HOST,
  allowIframeFullscreen,
  loadYoutubeApi,
  type YtPlayer,
} from '../player/youtubeApi';
import AudioTrackNotice from '../components/AudioTrackNotice.vue';
import type { PublicEpisode } from '../types';

const props = defineProps<{ slug: string; season: string; episode: string }>();

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);

// Route params are the real season and episode numbers, not array indices.
const seasonNumber = computed(() => Number(props.season));
const episodeNumber = computed(() => Number(props.episode));

const series = computed(() => content.series(props.slug));
const network = computed(() => {
  if (!series.value) return null;
  const requested = typeof route.query.zender === 'string' ? route.query.zender : null;
  if (requested && series.value.networkSlugs.includes(requested)) return content.network(requested);
  const listedSlug = series.value.networkSlugs.find((slug) => content.network(slug)?.listed);
  return content.network(listedSlug ?? series.value.networkSlug);
});
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));

const season = computed(() => series.value?.seasons.find((s) => s.season === seasonNumber.value) ?? null);
const episode = computed<PublicEpisode | null>(
  () => season.value?.episodes.find((e) => e.episode === episodeNumber.value) ?? null,
);

/**
 * Dutch when this video carries a Nederlands audiospoor that is not the one it
 * starts with, otherwise null.
 *
 * The archive is Dutch-first, so on demand there is only ever one language
 * worth switching to. The live player asks a sharper version of this question,
 * because there the station decides which language the broadcast is *for*.
 */
const dubbedAudio = computed(() => {
  const current = episode.value;
  if (!current || current.defaultAudioLanguage === 'nl') return null;
  return current.audioLanguages.includes('nl') ? ('nl' as const) : null;
});

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
  void router.push({
    path: `/programma/${props.slug}/${target.season}/${target.episode}`,
    query: route.query,
  });
}

function playNext(): void {
  if (nextEpisode.value) playEpisode(nextEpisode.value);
}

function backToSeries(): void {
  void router.push({ path: `/programma/${props.slug}`, query: route.query });
}

/* ---------------------------------------------------------------- */
/* Playback                                                          */
/* ---------------------------------------------------------------- */

const mount = ref<HTMLDivElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const { isFullscreen, cssFullscreen, toggle: toggleFullscreen } = useFullscreen(stage);
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
    // `hl` sets the player's own interface language. It is not an audio-track
    // control — YouTube offers none — but it is what makes the settings menu
    // read "Audiotrack" instead of "Audio track", which is the wording
    // AudioTrackNotice points the viewer at.
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, hl: 'nl' },
    events: {
      onReady: (event) => allowIframeFullscreen(event.target),
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
      <div
        ref="stage"
        class="stage"
        :class="{ 'css-fullscreen': cssFullscreen, 'is-fullscreen': isFullscreen }"
        :style="{ background: C.videoBg, borderColor: C.border2 }"
      >
        <div class="video">
          <!-- youtube-nocookie embed. No video is hosted or proxied here; the
               player is the only playback path. -->
          <div v-if="episode.youtubeId" ref="mount" class="video-frame"></div>
          <div v-else class="video-gap" :style="{ color: C.dim }">
            {{ AVAILABILITY_LABELS.missing }}
          </div>
        </div>
        <AudioTrackNotice v-if="dubbedAudio" :language="dubbedAudio" />
        <!-- The screen's own controls. YouTube's bar sits at the bottom edge of
             the embed, which on a wide window used to be below the fold: the
             viewer had to scroll to find the one button that would have fixed
             that. This one is always in view, and stays reachable in the CSS
             fullscreen mode where there is no browser affordance to leave. -->
        <div class="player-bar" :style="{ borderColor: C.border2 }">
          <span class="mono bar-title">
            S{{ pad2(episode.season) }}E{{ pad2(episode.episode) }} · {{ episode.title }}
          </span>
          <button
            class="bar-btn"
            :style="{ borderColor: C.border2, color: C.dim2 }"
            @click="toggleFullscreen"
          >
            {{ isFullscreen ? 'Verlaat volledig scherm' : 'Volledig scherm' }}
          </button>
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
          ← Terug naar programma
        </button>
      </div>
    </div>
    <div class="rail" :style="{ borderColor: C.border }">
      <div class="mono rail-label" :style="{ color: C.dim }">HIERNA</div>
      <div v-if="nextEpisode" class="rail-next" :style="{ background: C.railBg }" @click="playNext">
        <span class="rail-next-title" :style="{ color: C.ink }">{{ nextEpisode.title }}</span>
        <span class="mono" :style="{ color: C.dim }">{{ nextEpisode.runtime ? `${nextEpisode.runtime} min` : '—' }}</span>
      </div>
      <div v-else class="mono rail-end" :style="{ color: C.dim }">Einde van {{ season.name }}.</div>

      <div class="mono rail-label" :style="{ color: C.dim }">DIT SEIZOEN</div>
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

/* The screen runs edge to edge; the gutters live on the text below it. */
.player-main {
  flex: 1;
  min-width: 0;
}

.stage {
  display: flex;
  flex-direction: column;
  border-top: 1px solid;
  border-bottom: 1px solid;
}

/**
 * Everything above the screen (header, channel strip) plus the bar under it,
 * with enough left over that the title below stays visible — so the page reads
 * as having more to it without being scrolled.
 */
.stage {
  --player-chrome: 200px;
}

/**
 * A 16/9 box fills the width it is given, so on a wide window it used to be
 * taller than the screen and its controls fell below the fold. Capping the
 * width by the height that is actually available keeps the whole screen — and
 * the bar under it — in view, and only bites once the window is too short to
 * show it in full.
 */
.video {
  position: relative;
  width: 100%;
  max-width: calc((100vh - var(--player-chrome)) * 16 / 9);
  max-width: calc((100dvh - var(--player-chrome)) * 16 / 9);
  aspect-ratio: 16 / 9;
  margin-inline: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.player-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 14px;
  border-top: 1px solid;
}

.bar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #aab1bf;
}

.bar-btn {
  flex: none;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  padding: 6px 11px;
  border-radius: 2px;
  cursor: pointer;
  white-space: nowrap;
}

/* On the whole screen the height budget no longer applies: the picture takes
   whatever the bar leaves, and YouTube letterboxes inside it. */
.stage.is-fullscreen {
  border: 0;
}

.stage.is-fullscreen .video {
  max-width: none;
  aspect-ratio: auto;
  flex: 1;
  min-height: 0;
}

/* Fallback for browsers with no element fullscreen at all — iOS Safari most of
   all. It cannot escape the browser chrome, but it does fill the viewport. */
.stage.css-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9998;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
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
  padding: 16px 24px 4px;
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

/* Mobile. The rail cannot shrink, so on a phone it has to stop being a column
   and stack under the video — otherwise the 16/9 embed is squeezed into
   whatever slice of width the 320px rail leaves behind. Kept to CSS on
   purpose: a v-if variant would unmount the player's mount node on resize. */
@media (max-width: 759px) {
  /* Stretch, not flex-start: in a column the cross axis is the width, and
     flex-start sizes each child to its own content instead of the screen. A
     single line of text that will not wrap would otherwise widen the whole
     page and take the channel strip with it. */
  .player {
    flex-direction: column;
    align-items: stretch;
  }

  /* Less chrome above the screen on a phone, so more height is available. */
  .stage {
    --player-chrome: 150px;
  }

  .player-info {
    padding: 14px 14px 4px;
  }

  .player-info h1 {
    font-size: 20px;
    overflow-wrap: break-word;
  }

  /* No inner scroller inside page scroll on touch, and the max-height it
     replaces was a desktop header/footer measurement anyway. */
  .rail {
    width: 100%;
    max-height: none;
    overflow-y: visible;
    border-left: none;
    border-top: 1px solid;
    padding: 16px 14px 28px;
  }
}
</style>
