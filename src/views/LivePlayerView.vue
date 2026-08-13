<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import NetworkLogo from '../components/NetworkLogo.vue';
import { useContentStore } from '../stores/content';
import { useUiStore } from '../stores/ui';
import {
  broadcastAt,
  broadcastProgress,
  formatChannelTime,
  nextBroadcast,
} from '../broadcast/engine';
import { broadcastTypeLabel, countryLabel } from '../data/helpers';
import { useFullscreen } from '../player/fullscreen';
import {
  NOCOOKIE_HOST,
  allowIframeFullscreen,
  loadYoutubeApi,
  type YtPlayer,
} from '../player/youtubeApi';

const props = defineProps<{ channelId: string }>();

/** How long the on-screen menu lingers after the last sign of a viewer. */
const OVERLAY_LINGER_MS = 4_000;

/** How far from the end of a video counts as the end of it. Seeking into the
 * last moment of a file is indistinguishable from seeking past it. */
const END_MARGIN_SECONDS = 1;

/** How far the picture may drift from the schedule before it is pulled back. */
const MAX_DRIFT_SECONDS = 3;

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
/** The loaded video's real length, once the player can report it. */
const mediaDuration = ref<number | null>(null);
/** The slot has outlived the video filling it. */
const mediaExhausted = ref(false);
const isMuted = ref(true);
const overlayVisible = ref(true);
const pointerOnOverlay = ref(false);
const keyboardInOverlay = ref(false);
const { isFullscreen, cssFullscreen, toggle: toggleFullscreenMode } = useFullscreen(shell);

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
/** Nothing is on the screen worth watching: the picture gives way to a card. */
const isInterlude = computed(() => hasMediaError.value || mediaExhausted.value);

/**
 * The menu only gets out of the way once there is something to watch. While the
 * channel is still tuning, the signal is down, or playback is paused, it is the
 * only thing on screen worth reading — and while the viewer is pointing at it
 * or tabbing through it, taking it away would be rude.
 */
const overlayHeld = computed(() => pointerOnOverlay.value || keyboardInOverlay.value);
const canHideOverlay = computed(
  () => isPlaying.value && !isInterlude.value && !overlayHeld.value,
);

const titleFor = (item: typeof current.value): string =>
  item?.show?.title ?? (item?.type ? broadcastTypeLabel(item.type) : 'Geen uitzending');
const subtitleFor = (item: typeof current.value): string => item?.episode?.title ?? '';
const timeFor = (iso: string): string =>
  channel.value ? formatChannelTime(iso, channel.value.timezone) : '';

let player: YtPlayer | null = null;
let loadedKey: string | null = null;
let clockTimer: ReturnType<typeof setInterval> | undefined;
let overlayTimer: ReturnType<typeof setTimeout> | undefined;
let driftTick = 0;

/* ---------------------------------------------------------------- */
/* On-screen menu                                                    */
/* ---------------------------------------------------------------- */

function hideOverlay(): void {
  clearTimeout(overlayTimer);
  overlayTimer = undefined;
  // Re-checked rather than trusted: the viewer may have reached the menu, or
  // playback may have stopped, while this timer was counting down.
  if (canHideOverlay.value) overlayVisible.value = false;
}

function showOverlay(): void {
  overlayVisible.value = true;
  clearTimeout(overlayTimer);
  overlayTimer = canHideOverlay.value ? setTimeout(hideOverlay, OVERLAY_LINGER_MS) : undefined;
}

/**
 * A mouse click leaves focus behind on the button it hit, so treating every
 * `focusin` as a viewer at the controls would pin the menu open for the rest
 * of the broadcast the moment anyone pressed "Geluid aan". Only focus the
 * browser itself considers keyboard-driven holds it there.
 */
function onOverlayFocusIn(event: FocusEvent): void {
  const target = event.target as Element | null;
  keyboardInOverlay.value = target?.matches?.(':focus-visible') ?? false;
}

let lastPointerX = Number.NaN;
let lastPointerY = Number.NaN;

/**
 * Only a cursor that actually moved counts. Some engines emit a move event
 * when a new element appears under a stationary cursor, which is precisely
 * what the wake layer does — taking that at face value would hide and restore
 * the menu on a loop for a viewer who never touched anything.
 */
function onWakeMove(event: PointerEvent): void {
  if (event.clientX === lastPointerX && event.clientY === lastPointerY) return;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  showOverlay();
}

function expectedOffset(): number {
  if (!current.value) return 0;
  return Math.max(0, (Date.now() - new Date(current.value.startsAt).getTime()) / 1_000);
}

/** The loaded video's length, or null while the player cannot say yet. */
function readDuration(target: YtPlayer | null = player): number | null {
  const duration = target?.getDuration();
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null;
}

/**
 * Where in the video "now" falls — or null once the slot has outlived it.
 *
 * A slot cut from an estimated runtime is routinely longer than the video in
 * it, and a video may simply be shorter than the schedule was told. Seeking to
 * a point past the end is what leaves the screen black and restarts the buffer
 * bar every time the drift correction comes round, so the answer here has to
 * be allowed to be "nowhere".
 */
function livePosition(): number | null {
  const expected = expectedOffset();
  const duration = mediaDuration.value;
  if (duration === null) return expected;
  return expected >= duration - END_MARGIN_SECONDS ? null : expected;
}

/** The video is over but its slot is not. Stop chasing it and say so. */
function markExhausted(): void {
  mediaExhausted.value = true;
  isPlaying.value = false;
  player?.pauseVideo();
}

function destroyPlayer(): void {
  player?.destroy();
  player = null;
  loadedKey = null;
  playerReady.value = false;
  isPlaying.value = false;
}

function keepPlayerLive(): void {
  if (!player || !current.value || isInterlude.value) return;
  // Re-read rather than trusted once: right after a video swap the player can
  // still be answering for the previous file, and a stale length is what would
  // write off a programme that had not started yet. A momentary zero keeps the
  // last known answer instead of erasing it.
  mediaDuration.value = readDuration() ?? mediaDuration.value;

  const position = livePosition();
  if (position === null) {
    markExhausted();
    return;
  }

  const actual = player.getCurrentTime();
  if (Number.isFinite(actual) && Math.abs(actual - position) > MAX_DRIFT_SECONDS) {
    player.seekTo(position, true);
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
    // One player instance outlives many broadcasts: `loadVideoById` above swaps
    // the video without rebuilding it, so these handlers must report against
    // whatever is loaded *now*. Closing over the key this instance was created
    // with would file every later failure under the first broadcast — and a
    // failure filed under the wrong broadcast is one the view never shows,
    // leaving a black screen where the "signal interrupted" card belongs.
    events: {
      onReady: (event) => {
        playerReady.value = true;
        allowIframeFullscreen(event.target);
        // Browsers reject autoplay with sound after an asynchronous route
        // transition. Muted autoplay is permitted; the explicit sound button
        // below restores audio from a real user gesture.
        event.target.mute();
        isMuted.value = true;
        mediaDuration.value = readDuration(event.target);

        const position = livePosition();
        if (position === null) {
          markExhausted();
          return;
        }
        event.target.seekTo(position, true);
        event.target.playVideo();
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          playerReady.value = true;
          isPlaying.value = true;
          keepPlayerLive();
        }
        if (event.data === YT.PlayerState.PAUSED) isPlaying.value = false;
        if (event.data === YT.PlayerState.ENDED) {
          // The schedule may have moved on at the same moment, in which case
          // the watcher below loads the next broadcast and clears this.
          nowMs.value = Date.now();
          if (loadedKey === playerKey.value) markExhausted();
        }
      },
      onError: () => {
        playerReady.value = false;
        isPlaying.value = false;
        failedBroadcastId.value = loadedKey;
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
  // Asked again, answered again: the clock has moved, so a slot written off a
  // minute ago may since have handed over to one that plays.
  mediaExhausted.value = false;
  mediaDuration.value = readDuration();

  const position = livePosition();
  if (position === null) {
    markExhausted();
    return;
  }
  player.seekTo(position, true);
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

/** Reaching for the screen is reaching for the controls, so the menu comes
 * back with it. */
async function toggleFullscreen(): Promise<void> {
  showOverlay();
  await toggleFullscreenMode();
}

function onKeydown(): void {
  // Any key counts as a viewer, including the Tab that is about to move focus
  // into the menu — so it is on screen by the time focus lands.
  showOverlay();
}

watch(
  playerKey,
  (key, oldKey) => {
    if (key !== oldKey) {
      failedBroadcastId.value = null;
      playerReady.value = false;
      // A new broadcast is a new video: nothing learned about the last one
      // holds, least of all how long it was.
      mediaDuration.value = null;
      mediaExhausted.value = false;
    }
    void syncPlayer();
  },
  { immediate: true, flush: 'post' },
);

// Whichever way the answer changed, the menu should be on screen and the timer
// should match the new situation: armed while it may hide, cleared while not.
watch(canHideOverlay, () => showOverlay());

onMounted(() => {
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
    driftTick += 1;
    if (driftTick % 10 === 0) keepPlayerLive();
  }, 1_000);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  clearInterval(clockTimer);
  clearTimeout(overlayTimer);
  window.removeEventListener('keydown', onKeydown);
  destroyPlayer();
});
</script>

<template>
  <section
    ref="shell"
    class="live"
    :class="{ 'css-fullscreen': cssFullscreen }"
    :style="{ background: C.videoBg }"
  >
    <template v-if="channel && network && schedule && current && next">
      <div class="screen">
        <div v-show="!isInterlude" class="video-frame">
          <div ref="mount" class="yt-mount"></div>
        </div>
        <div v-if="!playerReady && !isInterlude" class="tuning" :style="{ color: C.dim }">
          AFSTEMMEN OP {{ channel.name.toUpperCase() }}…
        </div>
        <div v-if="isInterlude" class="signal" :style="{ color: C.ink }">
          <NetworkLogo :network="network" :size="88" decorative />
          <strong>{{ hasMediaError ? 'SIGNAAL ONDERBROKEN' : 'EINDE UITZENDING' }}</strong>
          <span :style="{ color: C.dim }">
            {{ hasMediaError ? 'Deze uitzending komt niet door.' : 'Deze aflevering is afgelopen.' }}
            Om {{ timeFor(next.startsAt) }} begint {{ titleFor(next) }}.
          </span>
        </div>
      </div>

      <!-- The iframe swallows pointer events, so once the menu is gone there is
           nothing left on the page that can notice a viewer. This layer exists
           only while the menu is hidden: it catches the first move or tap,
           brings the menu back, and disappears again — which also hands the
           bottom of the screen, and with it YouTube's own control bar, back to
           the player. -->
      <div
        v-if="!overlayVisible"
        class="wake"
        @pointermove="onWakeMove"
        @pointerdown="showOverlay"
      ></div>

      <div
        class="live-overlay"
        :class="{ 'is-hidden': !overlayVisible }"
        @pointerover="pointerOnOverlay = true"
        @pointerout="pointerOnOverlay = false"
        @focusin="onOverlayFocusIn"
        @focusout="keyboardInOverlay = false"
      >
        <div class="station">
          <NetworkLogo :network="network" :size="48" />
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
          <button @click="toggleFullscreen">
            {{ isFullscreen ? 'Verlaat volledig scherm' : 'Volledig scherm' }}
          </button>
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

.signal .network-logo {
  --network-logo-width: 88px;
  margin-bottom: 8px;
}

.signal span {
  font-size: 11px;
  letter-spacing: 0.03em;
}

.wake {
  position: absolute;
  inset: 0;
  z-index: 2;
  cursor: none;
}

.live-overlay {
  position: absolute;
  inset: auto 0 0;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(320px, 2fr) minmax(220px, 1fr);
  gap: 24px;
  align-items: end;
  padding: 72px 26px 22px;
  background: linear-gradient(transparent, rgba(3, 5, 8, 0.93));
  pointer-events: none;
  transition: opacity 240ms ease, transform 240ms ease;
}

.station,
.programme,
.next,
.actions {
  pointer-events: auto;
}

.live-overlay.is-hidden {
  opacity: 0;
  transform: translateY(14px);
}

/* Not just invisible: nothing in a menu that has stepped aside may keep
   intercepting clicks meant for the player underneath it. */
.live-overlay.is-hidden .station,
.live-overlay.is-hidden .programme,
.live-overlay.is-hidden .next,
.live-overlay.is-hidden .actions {
  pointer-events: none;
}

.station {
  display: flex;
  align-items: center;
  gap: 11px;
}

.station .network-logo {
  --network-logo-width: 48px;
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

/* The row is a horizontal scroller on a phone, so its buttons must keep their
   own width instead of being squeezed until the labels break apart. */
.actions button {
  flex: none;
  white-space: nowrap;
}

.unavailable button {
  margin-top: 8px;
}

/* The UA stylesheet already sizes a fullscreen element to the viewport with
   `!important`, so the old `min-height: 100vh` here never applied. What is
   still needed is releasing the header/footer allowance the page layout adds.
   Split per prefix on purpose: one unknown pseudo-class invalidates a whole
   selector list, taking the working half down with it. */
.live:fullscreen {
  min-height: 0;
}

.live:-webkit-full-screen {
  min-height: 0;
}

.live:-ms-fullscreen {
  min-height: 0;
}

/* Fallback for browsers with no element fullscreen at all — iOS Safari, most
   of all. It cannot escape the browser chrome, but it does fill the viewport.
   `dvh` follows a collapsing address bar where it is supported. */
.live.css-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9998;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
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
