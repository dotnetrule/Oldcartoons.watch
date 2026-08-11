<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useContentStore } from '../stores/content';
import { useUiStore } from '../stores/ui';
import {
  broadcastAt,
  broadcastProgress,
  formatChannelTime,
  nextBroadcast,
} from '../broadcast/engine';
import { broadcastTypeLabel, countryLabel } from '../data/helpers';
import { NOCOOKIE_HOST, loadYoutubeApi, type YtPlayer } from '../player/youtubeApi';

const props = defineProps<{ channelId: string }>();

const router = useRouter();
const content = useContentStore();
const ui = useUiStore();
const C = computed(() => ui.C);
const shell = ref<HTMLElement | null>(null);
const mount = ref<HTMLDivElement | null>(null);
const nowMs = ref(Date.now());
const failedBroadcastId = ref<string | null>(null);
const playerReady = ref(false);
const isPlaying = ref(false);
const isMuted = ref(true);

const channel = computed(() => content.channel(props.channelId));
const network = computed(() => content.network(channel.value?.networkSlug));
const schedule = computed(() => content.scheduleForChannel(props.channelId));
const current = computed(() => (schedule.value ? broadcastAt(schedule.value, nowMs.value) : null));
const next = computed(() =>
  schedule.value && current.value ? nextBroadcast(schedule.value, current.value) : null,
);
const progress = computed(() => (current.value ? broadcastProgress(current.value, nowMs.value) : 0));
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));
const playerKey = computed(() =>
  current.value ? `${current.value.id}@${current.value.startsAt}` : null,
);
const hasMediaError = computed(() => failedBroadcastId.value === playerKey.value);

const titleFor = (item: typeof current.value): string =>
  item?.show?.title ?? (item?.type ? broadcastTypeLabel(item.type) : 'Geen uitzending');
const subtitleFor = (item: typeof current.value): string => item?.episode?.title ?? '';
const timeFor = (iso: string): string =>
  channel.value ? formatChannelTime(iso, channel.value.timezone) : '';

let player: YtPlayer | null = null;
let loadedKey: string | null = null;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let driftTick = 0;

function expectedOffset(): number {
  if (!current.value) return 0;
  return Math.max(0, (Date.now() - new Date(current.value.startsAt).getTime()) / 1_000);
}

function destroyPlayer(): void {
  player?.destroy();
  player = null;
  loadedKey = null;
  playerReady.value = false;
  isPlaying.value = false;
}

function keepPlayerLive(): void {
  if (!player || !current.value || hasMediaError.value) return;
  const expected = expectedOffset();
  const actual = player.getCurrentTime();
  if (Number.isFinite(actual) && Math.abs(actual - expected) > 3) {
    player.seekTo(expected, true);
  }
}

async function syncPlayer(): Promise<void> {
  const item = current.value;
  const key = playerKey.value;
  if (!item || !key) {
    destroyPlayer();
    return;
  }
  if (loadedKey === key || failedBroadcastId.value === key) return;

  const videoId = item.mediaAsset.source.id;
  const offset = expectedOffset();
  if (player) {
    loadedKey = key;
    playerReady.value = false;
    player.loadVideoById({ videoId, startSeconds: offset });
    return;
  }

  await nextTick();
  const element = mount.value;
  if (!element) return;
  const YT = await loadYoutubeApi();
  if (!mount.value || playerKey.value !== key) return;

  loadedKey = key;
  player = new YT.Player(element, {
    host: NOCOOKIE_HOST,
    videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      start: Math.floor(offset),
    },
    events: {
      onReady: (event) => {
        playerReady.value = true;
        // Browsers reject autoplay with sound after an asynchronous route
        // transition. Muted autoplay is permitted; the explicit sound button
        // below restores audio from a real user gesture.
        event.target.mute();
        isMuted.value = true;
        event.target.seekTo(expectedOffset(), true);
        event.target.playVideo();
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          playerReady.value = true;
          isPlaying.value = true;
          keepPlayerLive();
        }
        if (event.data === YT.PlayerState.PAUSED) isPlaying.value = false;
        if (event.data === YT.PlayerState.ENDED) nowMs.value = Date.now();
      },
      onError: () => {
        playerReady.value = false;
        isPlaying.value = false;
        failedBroadcastId.value = key;
      },
    },
  });
}

function goNetwork(): void {
  if (network.value) void router.push(`/zender/${network.value.slug}`);
}

function goGuide(): void {
  void router.push({ name: 'gids', query: { channel: props.channelId } });
}

function goLive(): void {
  nowMs.value = Date.now();
  if (!player) {
    void syncPlayer();
    return;
  }
  player.seekTo(expectedOffset(), true);
  // This runs directly inside the button click, so it is also the recovery
  // path when a browser or power-saving mode paused autoplay.
  player.playVideo();
}

function toggleSound(): void {
  if (!player) return;
  if (player.isMuted()) {
    player.unMute();
    isMuted.value = false;
    // Keep the user gesture and playback request in the same call stack.
    player.playVideo();
  } else {
    player.mute();
    isMuted.value = true;
  }
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await shell.value?.requestFullscreen();
}

watch(
  playerKey,
  (key, oldKey) => {
    if (key !== oldKey) {
      failedBroadcastId.value = null;
      playerReady.value = false;
    }
    void syncPlayer();
  },
  { immediate: true, flush: 'post' },
);

onMounted(() => {
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
    driftTick += 1;
    if (driftTick % 10 === 0) keepPlayerLive();
  }, 1_000);
});

onBeforeUnmount(() => {
  clearInterval(clockTimer);
  destroyPlayer();
});
</script>

<template>
  <section ref="shell" class="live" :style="{ background: C.videoBg }">
    <template v-if="channel && network && schedule && current && next">
      <div class="screen">
        <div v-show="!hasMediaError" class="video-frame">
          <div ref="mount" class="yt-mount"></div>
        </div>
        <div v-if="!playerReady && !hasMediaError" class="tuning" :style="{ color: C.dim }">
          AFSTEMMEN OP {{ channel.name.toUpperCase() }}…
        </div>
        <div v-if="hasMediaError" class="signal" :style="{ color: C.ink }">
          <img :src="network.logo" alt="" :style="{ filter: 'invert(1)' }" />
          <strong>SIGNAAL ONDERBROKEN</strong>
          <span :style="{ color: C.dim }">De volgende geplande uitzending start automatisch.</span>
        </div>
      </div>

      <div class="live-overlay">
        <div class="station">
          <img :src="network.logo" :alt="network.name" :style="{ filter: 'invert(1)' }" />
          <div>
            <strong>{{ channel.name }}</strong>
            <span>{{ countryLabel(channel.country) }} · {{ channel.timezone }}</span>
          </div>
          <span class="live-pill" :style="{ background: colour }">LIVE</span>
        </div>

        <div class="programme">
          <div class="eyebrow">NU</div>
          <h1>{{ titleFor(current) }}</h1>
          <p>{{ subtitleFor(current) }}</p>
          <div class="timeline">
            <span>{{ timeFor(current.startsAt) }}</span>
            <div class="track"><i :style="{ width: `${progress * 100}%`, background: colour }"></i></div>
            <span>{{ timeFor(current.endsAt) }}</span>
          </div>
        </div>

        <div class="next">
          <span class="eyebrow">HIERNA · {{ timeFor(next.startsAt) }}</span>
          <strong>{{ titleFor(next) }}</strong>
          <span>{{ subtitleFor(next) }}</span>
        </div>

        <div class="actions">
          <button @click="goNetwork">← {{ network.name }}</button>
          <button @click="goGuide">TV-gids</button>
          <button @click="goLive">{{ isPlaying ? 'Naar live' : 'Live afspelen' }}</button>
          <button @click="toggleSound">{{ isMuted ? 'Geluid aan' : 'Dempen' }}</button>
          <button @click="toggleFullscreen">Volledig scherm</button>
        </div>
      </div>
    </template>

    <div v-else class="unavailable" :style="{ color: C.ink }">
      <strong>ZENDER NIET BESCHIKBAAR</strong>
      <button :style="{ color: C.dim2, borderColor: C.border2 }" @click="goGuide">Open de TV-gids</button>
    </div>
  </section>
</template>

<style scoped>
.live {
  position: relative;
  min-height: calc(100vh - 110px);
  overflow: hidden;
  color: #f3ecdd;
}

.screen,
.video-frame,
.yt-mount,
.video-frame :deep(iframe) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.signal,
.tuning,
.unavailable {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-family: 'IBM Plex Mono', monospace;
  letter-spacing: 0.08em;
  background: radial-gradient(circle, #18202d 0%, #05070a 72%);
}

.tuning {
  z-index: 1;
  background: #000;
  font-size: 10px;
}

.signal img {
  width: 88px;
  height: 64px;
  object-fit: contain;
  margin-bottom: 8px;
}

.signal span {
  font-size: 11px;
  letter-spacing: 0.03em;
}

.live-overlay {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(320px, 2fr) minmax(220px, 1fr);
  gap: 24px;
  align-items: end;
  padding: 72px 26px 22px;
  background: linear-gradient(transparent, rgba(3, 5, 8, 0.93));
  pointer-events: none;
}

.station,
.programme,
.next,
.actions {
  pointer-events: auto;
}

.station {
  display: flex;
  align-items: center;
  gap: 11px;
}

.station img {
  width: 48px;
  height: 38px;
  object-fit: contain;
}

.station div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  font-family: 'Oswald', sans-serif;
}

.station strong {
  font-size: 16px;
  text-transform: uppercase;
}

.station span {
  font: 10px 'IBM Plex Mono', monospace;
  color: #aab1bf;
}

.station .live-pill {
  color: #07100a;
  font-weight: 700;
  padding: 4px 6px;
  border-radius: 2px;
}

.eyebrow {
  color: #aab1bf;
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.1em;
}

.programme h1 {
  margin: 3px 0 0;
  font: 600 30px/1.05 'Oswald', sans-serif;
  text-transform: uppercase;
}

.programme p,
.next > span:last-child {
  margin: 3px 0 9px;
  color: #c8ced8;
  font-size: 12px;
}

.timeline {
  display: flex;
  align-items: center;
  gap: 9px;
  font: 10px 'IBM Plex Mono', monospace;
}

.track {
  height: 3px;
  flex: 1;
  background: rgba(255, 255, 255, 0.24);
}

.track i {
  display: block;
  height: 100%;
}

.next {
  display: flex;
  flex-direction: column;
}

.next strong {
  margin-top: 5px;
  font: 18px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}

.actions button,
.unavailable button {
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(0, 0, 0, 0.45);
  color: #f3ecdd;
  padding: 7px 11px;
  font: 11px 'IBM Plex Mono', monospace;
  cursor: pointer;
}

.unavailable button {
  margin-top: 8px;
}

.live:fullscreen {
  min-height: 100vh;
}

@media (max-width: 800px) {
  .live {
    min-height: 72vh;
  }

  .live-overlay {
    grid-template-columns: 1fr;
    gap: 13px;
    padding: 80px 14px 14px;
  }

  .next {
    display: none;
  }

  .programme h1 {
    font-size: 23px;
  }

  .actions {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
