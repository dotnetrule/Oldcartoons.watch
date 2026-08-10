<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppState } from '../composables/useAppState.js';
import { genSeasons } from '../data/helpers.js';
import CoverImage from '../components/CoverImage.vue';

const props = defineProps({ id: { type: String, required: true } });

const router = useRouter();
const { state, T, C, nets, allSeries, netColor, reportMissing, triggerFlicker } = useAppState();

const series = computed(() => allSeries.value.find((s) => s.id === props.id) || null);
const network = computed(() => (series.value ? nets.value.find((n) => n.id === series.value.network) : null));
const color = computed(() => (network.value ? netColor(network.value) : C.value.dim));
const seasons = computed(() => (series.value ? genSeasons(series.value) : []));

const activeSeasonIdx = ref(0);
watch(
  () => props.id,
  () => {
    activeSeasonIdx.value = 0;
  },
);

const yearsLabel = computed(() => (series.value ? series.value.yearStart + '–' + series.value.yearEnd : ''));
const epLabel = computed(() =>
  series.value ? (typeof series.value.episodeCount === 'number' ? series.value.episodeCount + ' EP' : '— EP') : '',
);

const episodes = computed(() => seasons.value[activeSeasonIdx.value]?.episodes || []);

const tagMap = computed(() => ({
  available: [T.value.avail.available, C.value.dim],
  'region-locked': [T.value.avail.regionLocked, C.value.dim],
  missing: [T.value.avail.missing, C.value.missing],
}));

function episodeMeta(ep) {
  const playable = ep.availability !== 'missing';
  const key = series.value.id + '-' + activeSeasonIdx.value + '-' + ep.number;
  const reported = state.reportedKeys.has(key);
  const tag = tagMap.value[ep.availability] || tagMap.value.available;
  return {
    playable,
    key,
    reported,
    tagLabel: tag[0],
    tagColor: tag[1],
  };
}

function goEpisode(ep) {
  if (ep.availability === 'missing') return;
  triggerFlicker();
  router.push(`/watch/${series.value.id}/${activeSeasonIdx.value}/${ep.number - 1}`);
}

function report(e, ep) {
  e.preventDefault();
  const meta = episodeMeta(ep);
  reportMissing(meta.key);
}
</script>

<template>
  <div v-if="series" class="series">
    <div class="hero">
      <CoverImage :series="series" kind="backdrop" :accent-color="color" class="hero-img" />
      <div class="hero-fade" :style="{ background: `linear-gradient(180deg, rgba(11,15,22,.1) 0%, rgba(11,15,22,.6) 60%, ${C.heroFade} 100%)` }"></div>
      <div class="hero-text">
        <div class="mono" :style="{ color }">{{ network?.ch }} {{ network?.name }}</div>
        <h1>{{ series.title }}</h1>
        <div class="mono hero-meta">{{ yearsLabel }} · {{ epLabel }}</div>
      </div>
    </div>

    <div class="synopsis" :style="{ color: C.dim2 }">{{ series.synopsis }}</div>

    <div v-if="seasons.length > 1" class="season-tabs">
      <button
        v-for="(sea, idx) in seasons"
        :key="sea.n"
        class="chip"
        :style="{
          background: idx === activeSeasonIdx ? C.ink : 'transparent',
          color: idx === activeSeasonIdx ? C.chipFg : C.dim,
          borderColor: C.border2,
        }"
        @click="activeSeasonIdx = idx"
      >
        Season {{ sea.n }}
      </button>
    </div>

    <div class="episodes">
      <div v-for="ep in episodes" :key="ep.number" class="ep-block">
        <div class="ep-row" :style="{ borderColor: C.border, opacity: episodeMeta(ep).playable ? 1 : 0.55 }">
          <span class="mono ep-num" :style="{ color: C.dim }">{{ ep.number }}</span>
          <span
            class="ep-title"
            :style="{ color: C.ink, cursor: episodeMeta(ep).playable ? 'pointer' : 'default' }"
            @click="goEpisode(ep)"
            >{{ ep.title }}</span
          >
          <span class="mono ep-meta" :style="{ color: C.dim }">{{ ep.runtime }} min · {{ ep.airDate }}</span>
          <span class="mono ep-tag" :style="{ color: episodeMeta(ep).tagColor }">{{ episodeMeta(ep).tagLabel }}</span>
        </div>
        <div v-if="!episodeMeta(ep).playable" class="ep-report" :style="{ color: C.dim }">
          {{ T.avail.missingNote }}
          <a href="#" @click="report($event, ep)">{{ episodeMeta(ep).reported ? T.avail.reportedThanks : T.avail.reportLink }}</a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  width: 100%;
  height: 320px;
  overflow: hidden;
}

.hero-img {
  width: 100%;
  height: 100%;
}

.hero-fade {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hero-text {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.hero-text .mono {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
}

.hero-text h1 {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 44px;
  line-height: 1.02;
  text-transform: uppercase;
  color: #f3ecdd;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.hero-meta {
  color: #d8dce4;
  font-size: 13px;
}

.synopsis {
  max-width: 760px;
  padding: 20px 24px 8px;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.5;
}

.season-tabs {
  display: flex;
  gap: 6px;
  padding: 16px 24px 0;
}

.chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
  padding: 6px 12px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease;
}

.episodes {
  padding: 20px 24px 40px;
  max-width: 900px;
}

.ep-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 12px 8px;
  border-bottom: 1px solid;
  transition: background 120ms ease;
}

.mono {
  font-family: 'IBM Plex Mono', monospace;
}

.ep-num {
  font-size: 13px;
  width: 22px;
  flex: none;
}

.ep-title {
  font-family: 'Oswald', sans-serif;
  font-size: 17px;
  flex: 1;
}

.ep-meta {
  font-size: 12px;
  white-space: nowrap;
}

.ep-tag {
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  width: 130px;
  text-align: right;
}

.ep-report {
  padding: 0 8px 12px 36px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
}
</style>
