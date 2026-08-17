<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import { formatAirDate, pad2 } from '../data/helpers';
import { AVAILABILITY_LABELS } from '../data/themes';
import { AGE_COPY, isBlockedByAge } from '../data/age';
import { useFullscreen } from '../player/fullscreen';
import {
  NOCOOKIE_HOST,
  allowIframeFullscreen,
  loadYoutubeApi,
  preferAudioLanguage,
  preferSubtitleLanguage,
  type AudioPreference,
  type SubtitlePreference,
  type YtPlayer,
} from '../player/youtubeApi';
import AudioTrackNotice from '../components/AudioTrackNotice.vue';
import TrackControls from '../components/TrackControls.vue';
import SourcePicker from '../components/SourcePicker.vue';
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
const isLocked = computed(() => isBlockedByAge(series.value?.age, ui.ageFilter));

/** Identifies the episode on screen. The source picker remembers a choice
 * against this, so a switch belongs to one episode and not to the series. */
const episodeKey = computed(() => `${props.slug}:${seasonNumber.value}:${episodeNumber.value}`);

/**
 * A viewer's choice of upload, when they have made one for *this* episode.
 *
 * Carrying the episode key rather than being reset by a watcher is what keeps
 * this honest across navigation: the override simply stops applying the moment
 * the key moves on, with no ordering to get wrong between this and the picker.
 * It is re-checked against the episode's sources too, so a choice cannot
 * outlive the upload it named.
 */
const sourceOverride = ref<{ key: string; youtubeId: string } | null>(null);

/** The upload actually on screen: the viewer's pick if it still stands, and the
 * archive's default otherwise. */
const activeVideoId = computed<string | null>(() => {
  const current = episode.value;
  if (!current) return null;
  const override = sourceOverride.value;
  if (
    override?.key === episodeKey.value &&
    current.sources.some((source) => source.youtubeId === override.youtubeId)
  ) {
    return override.youtubeId;
  }
  return current.youtubeId;
});

/** The metadata belonging to the upload actually on screen, not necessarily
 * the episode's default upload after the source picker has been used. */
const activeSource = computed(() =>
  episode.value?.sources.find((source) => source.youtubeId === activeVideoId.value),
);

/** An English/unknown-default upload needs a hands-free fallback when the
 * iframe refuses audio-track control. Native Dutch audio does not. */
const needsDutchFallback = computed(() => activeSource.value?.defaultAudioLanguage !== 'nl');

function selectSource(youtubeId: string): void {
  sourceOverride.value = { key: episodeKey.value, youtubeId };
}

/**
 * Dutch when this video carries a Nederlands audiospoor that is not the one it
 * starts with, otherwise null.
 *
 * The archive is Dutch-first, so on demand there is only ever one language
 * worth switching to. The live player asks a sharper version of this question,
 * because there the station decides which language the broadcast is *for*.
 *
 * Read only for the notice, and only as a second opinion: `audioLanguages` is
 * what `npm run scan-audio` measured, which is a scan that has to be run and
 * committed and on most rows has not been. The switch below does not consult
 * it — it asks the player, which knows about the video in front of it.
 */
const dubbedAudio = computed(() => {
  const current = activeSource.value;
  if (!current || current.defaultAudioLanguage === 'nl') return null;
  return current.audioLanguages.includes('nl') ? ('nl' as const) : null;
});

/**
 * What became of the attempt to start this video in Dutch.
 *
 * Null while the answer is still being worked out, which is also why the
 * notice keys off `unsupported` alone: a notice that appeared on every video
 * and then vanished on the ones that switched would be worse than the switch.
 */
const audioPreference = ref<AudioPreference | null>(null);
const subtitlePreference = ref<SubtitlePreference | null>(null);
const automaticSubtitlesOn = computed(
  () =>
    subtitlePreference.value === 'switched' ||
    subtitlePreference.value === 'already' ||
    subtitlePreference.value === 'translated',
);

/**
 * Whether to tell the viewer where the audio menu is.
 *
 * Only when the player refused to say anything about its tracks *and* the scan
 * recorded a Nederlands track on this video — those two together are the case
 * the notice was written for. When the player did answer, it is the better
 * witness: `unavailable` means there is no Dutch on this upload and pointing at
 * a menu that cannot deliver it would be a lie.
 */
const showAudioNotice = computed(
  () =>
    dubbedAudio.value !== null &&
    audioPreference.value === 'unsupported' &&
    (subtitlePreference.value === 'unsupported' || subtitlePreference.value === 'unavailable'),
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
  if (target.status === 'missing' || isLocked.value) return;
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
/** The same player, for the template — see the note in LivePlayerView. */
const playerRef = ref<YtPlayer | null>(null);
let playerVideoId: string | null = null;
let languageAttempt = 0;
let retriedLanguageVideoId: string | null = null;
const playbackFailed = ref(false);

function destroyPlayer(): void {
  player?.destroy();
  player = null;
  playerRef.value = null;
  playerVideoId = null;
  retriedLanguageVideoId = null;
  audioPreference.value = null;
  subtitlePreference.value = null;
  languageAttempt += 1;
}

/** Cancel track work that belongs to the previous video while the existing
 * iframe loads a new one. Its track methods can keep reporting the old video's
 * list until playback starts, so selection resumes from the PLAYING event. */
function resetAudioPreference(): void {
  audioPreference.value = null;
  subtitlePreference.value = null;
  languageAttempt += 1;
}

/**
 * Put this video on its Nederlands track, if it has one and the embed allows
 * it. Runs per video rather than per player, because the track list belongs to
 * the video and `loadVideoById` replaces it.
 */
function applyAudioPreference(target: YtPlayer, videoId: string): void {
  // A late `onReady` for an episode the viewer has already left must not clear
  // the state of the one they are on — that state is what the notice reads,
  // and nothing would come along to set it again.
  if (playerVideoId !== videoId) return;
  const attempt = ++languageAttempt;
  const allowSubtitleFallback = needsDutchFallback.value;
  audioPreference.value = null;
  subtitlePreference.value = null;
  const isCurrent = () => playerVideoId === videoId && languageAttempt === attempt;
  void (async () => {
    const result = await preferAudioLanguage(target, 'nl', isCurrent);
    // The rail moves fast and the wait above is seconds long; an answer about
    // an episode the viewer has already left is not an answer about this one.
    if (!isCurrent()) return;
    audioPreference.value = result;
    if (!allowSubtitleFallback || (result !== 'unsupported' && result !== 'unavailable')) return;
    const subtitleResult = await preferSubtitleLanguage(target, 'nl', isCurrent);
    if (isCurrent()) subtitlePreference.value = subtitleResult;
  })();
}

async function syncPlayer(videoId: string | null): Promise<void> {
  if (!videoId || isLocked.value) {
    destroyPlayer();
    playbackFailed.value = false;
    return;
  }
  if (playerVideoId === videoId) return;
  playbackFailed.value = false;

  // Moving between episodes swaps the video in the existing player rather than
  // tearing down the iframe, which keeps the rail from flashing.
  if (player) {
    playerVideoId = videoId;
    retriedLanguageVideoId = null;
    playerRef.value = null;
    resetAudioPreference();
    player.loadVideoById(videoId);
    return;
  }

  let YT;
  try {
    YT = await loadYoutubeApi();
  } catch {
    if (activeVideoId.value === videoId && !isLocked.value) playbackFailed.value = true;
    return;
  }
  const element = mount.value;
  // The route may have moved on while the API was loading.
  if (!element || activeVideoId.value !== videoId || isLocked.value) return;

  playerVideoId = videoId;
  player = new YT.Player(element, {
    host: NOCOOKIE_HOST,
    videoId,
    // `hl` sets the player's own interface language, not the audio: YouTube
    // has no player parameter for the track. It still earns its place — it is
    // what makes the settings menu read "Audiotrack" instead of "Audio track",
    // which is the wording AudioTrackNotice points the viewer at on the embeds
    // where the switch below cannot be made for them.
    // `cc_lang_pref` says which subtitles to show if they are turned on. There
    // is deliberately no `cc_load_policy`: only the automatic fallback after
    // a failed audio switch, or the button below, turns them on.
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, hl: 'nl', cc_lang_pref: 'nl' },
    events: {
      onReady: (event) => {
        allowIframeFullscreen(event.target);
        // Only now — before this the object exists but will not answer.
        playerRef.value = event.target;
        applyAudioPreference(event.target, videoId);
      },
      onStateChange: (event) => {
        // The undocumented track methods may appear only once the video's
        // playback modules are active. Run once for every newly loaded video;
        // on the first video this also replaces a possibly-too-early ready-time
        // attempt, and on later videos it avoids reading the previous track list.
        if (
          event.data === YT.PlayerState.PLAYING &&
          retriedLanguageVideoId !== playerVideoId
        ) {
          retriedLanguageVideoId = playerVideoId;
          playerRef.value = event.target;
          applyAudioPreference(event.target, playerVideoId ?? videoId);
        }
        if (event.data === YT.PlayerState.ENDED) playNext();
      },
      onError: (event) => {
        // The player instance outlives episode changes, so report the failure
        // against whatever it is loading now rather than the video that first
        // created the iframe.
        if (player === event.target && playerVideoId) playbackFailed.value = true;
      },
    },
  });
}

watch(
  [activeVideoId, isLocked],
  ([videoId]) => {
    void syncPlayer(videoId);
  },
  { immediate: true, flush: 'post' },
);

function retryPlayback(): void {
  const videoId = activeVideoId.value;
  if (!videoId || isLocked.value) return;
  playbackFailed.value = false;
  if (player) {
    playerVideoId = videoId;
    retriedLanguageVideoId = null;
    playerRef.value = null;
    resetAudioPreference();
    player.loadVideoById(videoId);
    return;
  }
  void syncPlayer(videoId);
}

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
          <div v-if="activeVideoId && !isLocked" ref="mount" class="video-frame"></div>
          <div v-if="isLocked" class="video-gap" :style="{ color: C.dim }">
            <strong :style="{ color: C.ink }">{{ AGE_COPY.locked }}</strong>
            <span>{{ AGE_COPY.seriesNotice }}</span>
          </div>
          <div v-else-if="playbackFailed" class="video-gap" :style="{ color: C.dim }">
            <strong :style="{ color: C.ink }">AFSPELEN MISLUKT</strong>
            <span>De videospeler kon deze aflevering niet laden.</span>
            <button type="button" :style="{ borderColor: C.border2, color: C.dim2 }" @click="retryPlayback">
              Opnieuw proberen
            </button>
          </div>
          <div v-else-if="!activeVideoId" class="video-gap" :style="{ color: C.dim }">
            {{ AVAILABILITY_LABELS.missing }}
          </div>
        </div>
        <AudioTrackNotice v-if="!isLocked && showAudioNotice && dubbedAudio" :language="dubbedAudio" />
        <!-- The screen's own controls. YouTube's bar sits at the bottom edge of
             the embed, which on a wide window used to be below the fold: the
             viewer had to scroll to find the one button that would have fixed
             that. This one is always in view, and stays reachable in the CSS
             fullscreen mode where there is no browser affordance to leave. -->
        <div class="player-bar" :style="{ borderColor: C.border2 }">
          <span class="mono bar-title">
            S{{ pad2(episode.season) }}E{{ pad2(episode.episode) }} · {{ episode.title }}
          </span>
          <!-- Always Dutch here. There is no station on demand, and the archive
               is Dutch-first — see the note on `dubbedAudio` above. -->
          <TrackControls
            v-if="activeVideoId && !isLocked && !playbackFailed"
            :player="playerRef"
            language="nl"
            :video-key="activeVideoId"
            :subtitles-active="automaticSubtitlesOn"
          />
          <!-- Draws nothing unless this episode has a second upload. Next to
               the track buttons because it answers the same kind of question:
               this copy is not working for me, what else is there. -->
          <SourcePicker
            v-if="activeVideoId && !isLocked"
            :sources="episode.sources"
            :storage-key="episodeKey"
            @select="selectSource"
          />
          <button
            v-if="activeVideoId && !isLocked && !playbackFailed"
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
      <button
        v-if="nextEpisode"
        type="button"
        class="rail-next"
        :disabled="isLocked"
        :style="{ background: C.railBg }"
        @click="playNext"
      >
        <span class="rail-next-title" :style="{ color: C.ink }">{{ nextEpisode.title }}</span>
        <span class="mono" :style="{ color: C.dim }">{{ nextEpisode.runtime ? `${nextEpisode.runtime} min` : '—' }}</span>
      </button>
      <div v-else class="mono rail-end" :style="{ color: C.dim }">Einde van {{ season.name }}.</div>

      <div class="mono rail-label" :style="{ color: C.dim }">DIT SEIZOEN</div>
      <button
        v-for="ep in season.episodes"
        :key="ep.episode"
        type="button"
        class="rail-ep"
        :disabled="ep.status === 'missing' || isLocked"
        :aria-current="ep.episode === episodeNumber ? 'true' : undefined"
        :style="{
          background: ep.episode === episodeNumber ? C.railBg : 'transparent',
          cursor: ep.status === 'missing' || isLocked ? 'default' : 'pointer',
          opacity: ep.status === 'missing' || isLocked ? 0.55 : 1,
        }"
        @click="playEpisode(ep)"
      >
        <span class="mono rail-ep-num" :style="{ color: C.dim }">{{ ep.episode }}</span>
        <span class="rail-ep-title" :style="{ color: C.ink }">{{ ep.title }}</span>
      </button>
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
  /* The bar carries the episode title, the two track buttons and their status
     line now. On a narrow window that is more than one row's worth, and
     wrapping it beats squeezing the title down to an ellipsis. */
  flex-wrap: wrap;
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
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  background: #05070a;
  text-align: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
}

.video-gap span {
  max-width: 34rem;
  line-height: 1.5;
  letter-spacing: 0.02em;
}

.video-gap button {
  margin-top: 4px;
  padding: 7px 11px;
  border: 1px solid;
  background: transparent;
  font: inherit;
  cursor: pointer;
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
  width: 100%;
  border: 0;
  color: inherit;
  text-align: left;
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
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
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
