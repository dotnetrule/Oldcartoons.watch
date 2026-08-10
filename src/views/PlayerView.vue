<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppState } from '../composables/useAppState.js';
import { genSeasons } from '../data/helpers.js';

const props = defineProps({
  seriesId: { type: String, required: true },
  season: { type: String, required: true },
  episode: { type: String, required: true },
});

const router = useRouter();
const { T, C, nets, allSeries, netColor, togglePlay: toggle, state } = useAppState();

const seasonIdx = computed(() => Number(props.season));
const episodeIdx = computed(() => Number(props.episode));

const series = computed(() => allSeries.value.find((s) => s.id === props.seriesId) || null);
const network = computed(() => (series.value ? nets.value.find((n) => n.id === series.value.network) : null));
const color = computed(() => (network.value ? netColor(network.value) : C.value.dim));
const seasons = computed(() => (series.value ? genSeasons(series.value) : []));
const season = computed(() => seasons.value[seasonIdx.value] || null);
const episode = computed(() => season.value?.episodes[episodeIdx.value] || null);

function nextPlayable() {
  let si = seasonIdx.value;
  let ei = episodeIdx.value + 1;
  let guard = 0;
  while (seasons.value[si] && guard++ < 200) {
    const s = seasons.value[si];
    if (ei >= s.episodes.length) {
      si++;
      ei = 0;
      continue;
    }
    if (s.episodes[ei].availability === 'missing') {
      ei++;
      continue;
    }
    return { seasonIdx: si, episode: s.episodes[ei] };
  }
  return null;
}

const nextEp = computed(nextPlayable);

function playNext() {
  const n = nextEp.value;
  if (!n) return;
  router.push(`/watch/${series.value.id}/${n.seasonIdx}/${n.episode.number - 1}`);
}

function playEpisode(idx) {
  const ep = season.value.episodes[idx];
  if (!ep || ep.availability === 'missing') return;
  router.push(`/watch/${series.value.id}/${seasonIdx.value}/${idx}`);
}

function backToSeries() {
  router.push('/series/' + props.seriesId);
}
</script>

<template>
  <div v-if="series && episode" class="player">
    <div class="player-main">
      <div class="video" :style="{ background: C.videoBg, borderColor: C.border2 }">
        <button class="play-btn" aria-label="Play" @click="toggle()">
          <div v-if="state.isPlaying" class="pause-icon">
            <span></span><span></span>
          </div>
          <div v-else class="play-icon"></div>
        </button>
        <div class="scrub">
          <div class="scrub-track">
            <div class="scrub-fill"></div>
          </div>
          <span class="mono scrub-time">{{ episode.runtime }}:00</span>
        </div>
      </div>
      <div class="player-info">
        <div class="mono" :style="{ color }">{{ network?.name }} · S{{ season.n }}E{{ episode.number }}</div>
        <h1 :style="{ color: C.ink }">{{ series.title }} — {{ episode.title }}</h1>
        <div class="mono dim" :style="{ color: C.dim }">{{ episode.airDate }} · {{ episode.runtime }} min</div>
        <button class="back-btn" :style="{ borderColor: C.border2, color: C.dim2 }" @click="backToSeries">
          ← Back to series
        </button>
      </div>
    </div>
    <div class="rail" :style="{ borderColor: C.border }">
      <div class="mono rail-label" :style="{ color: C.dim }">UP NEXT</div>
      <div v-if="nextEp" class="rail-next" :style="{ background: C.railBg }" @click="playNext">
        <span class="rail-next-title" :style="{ color: C.ink }">{{ nextEp.episode.title }}</span>
        <span class="mono" :style="{ color: C.dim }">{{ nextEp.episode.runtime }} min</span>
      </div>
      <div class="mono rail-label" :style="{ color: C.dim }">THIS SEASON</div>
      <div
        v-for="(ep, idx) in season.episodes"
        :key="ep.number"
        class="rail-ep"
        :style="{
          background: idx === episodeIdx ? C.railBg : 'transparent',
          cursor: ep.availability === 'missing' ? 'default' : 'pointer',
          opacity: ep.availability === 'missing' ? 0.55 : 1,
        }"
        @click="playEpisode(idx)"
      >
        <span class="mono rail-ep-num" :style="{ color: C.dim }">{{ ep.number }}</span>
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

.play-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 120ms ease;
}

.play-btn:hover {
  transform: scale(1.06);
}

.play-icon {
  width: 0;
  height: 0;
  border-top: 12px solid transparent;
  border-bottom: 12px solid transparent;
  border-left: 20px solid #f3ecdd;
  margin-left: 4px;
}

.pause-icon {
  display: flex;
  gap: 5px;
}

.pause-icon span {
  width: 6px;
  height: 20px;
  background: #f3ecdd;
  display: block;
}

.scrub {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.7), transparent);
}

.scrub-track {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 2px;
  position: relative;
}

.scrub-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 22%;
  background: #f2544c;
  border-radius: 2px;
}

.scrub-time {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
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
