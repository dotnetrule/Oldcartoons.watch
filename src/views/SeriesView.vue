<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import CoverImage from '../components/CoverImage.vue';
import { episodeCountLabel, formatAirDate, pad2, yearRangeLabel } from '../data/helpers';
import { AVAILABILITY_LABELS, COPY } from '../data/themes';
import type { PublicEpisode } from '../types';

const props = defineProps<{ slug: string }>();

const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);

// The route's beforeEnter has already awaited this file, so it is present.
const series = computed(() => content.series(props.slug));
const network = computed(() => content.network(series.value?.networkSlug));
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));
const seasons = computed(() => series.value?.seasons ?? []);

const activeSeasonIdx = ref(0);
watch(
  () => props.slug,
  () => {
    activeSeasonIdx.value = 0;
  },
);

const yearsLabel = computed(() =>
  series.value ? yearRangeLabel(series.value.firstAirYear, series.value.lastAirYear) : '',
);
const epLabel = computed(() => (series.value ? episodeCountLabel(series.value.episodeCount) : ''));

const episodes = computed<PublicEpisode[]>(() => seasons.value[activeSeasonIdx.value]?.episodes ?? []);

/** Availability is on the row before the click, never discovered after one. */
function tagFor(episode: PublicEpisode): { label: string; colour: string } {
  return {
    label: AVAILABILITY_LABELS[episode.status],
    colour: episode.status === 'missing' ? C.value.missing : C.value.dim,
  };
}

const isPlayable = (episode: PublicEpisode): boolean => episode.status !== 'missing';

const reportKey = (episode: PublicEpisode): string =>
  `${props.slug}-${episode.season}-${episode.episode}`;

function goEpisode(episode: PublicEpisode): void {
  if (!isPlayable(episode)) return;
  ui.triggerFlicker();
  void router.push(`/series/${props.slug}/${episode.season}/${episode.episode}`);
}

function report(e: Event, episode: PublicEpisode): void {
  e.preventDefault();
  ui.reportMissing(reportKey(episode));
}
</script>

<template>
  <div v-if="series" class="series">
    <div class="hero">
      <CoverImage
        :title="series.name"
        :file-path="series.backdrop"
        size="w1280"
        :accent-color="colour"
        class="hero-img"
      />
      <div
        class="hero-fade"
        :style="{
          background: `linear-gradient(180deg, rgba(11,15,22,.1) 0%, rgba(11,15,22,.6) 60%, ${C.heroFade} 100%)`,
        }"
      ></div>
      <div class="hero-text">
        <div class="mono" :style="{ color: colour }">
          {{ network ? pad2(network.channelNumber) : '' }} {{ network?.name }}
        </div>
        <h1>{{ series.name }}</h1>
        <div class="mono hero-meta">{{ yearsLabel }} · {{ epLabel }}</div>
      </div>
    </div>

    <div class="synopsis" :style="{ color: C.dim2 }">{{ series.overview }}</div>

    <div v-if="seasons.length > 1" class="season-tabs">
      <button
        v-for="(sea, idx) in seasons"
        :key="sea.season"
        class="chip"
        :style="{
          background: idx === activeSeasonIdx ? C.ink : 'transparent',
          color: idx === activeSeasonIdx ? C.chipFg : C.dim,
          borderColor: C.border2,
        }"
        @click="activeSeasonIdx = idx"
      >
        {{ sea.name }}
      </button>
    </div>

    <div class="episodes">
      <div v-for="ep in episodes" :key="`${ep.season}-${ep.episode}`" class="ep-block">
        <div class="ep-row" :style="{ borderColor: C.border, opacity: isPlayable(ep) ? 1 : 0.55 }">
          <span class="mono ep-num" :style="{ color: C.dim }">{{ ep.episode }}</span>
          <span
            class="ep-title"
            :style="{ color: C.ink, cursor: isPlayable(ep) ? 'pointer' : 'default' }"
            @click="goEpisode(ep)"
            >{{ ep.title }}</span
          >
          <span class="mono ep-meta" :style="{ color: C.dim }">
            {{ ep.runtime ? `${ep.runtime} min · ` : '' }}{{ formatAirDate(ep.airDate) }}
          </span>
          <span class="mono ep-tag" :style="{ color: tagFor(ep).colour }">{{ tagFor(ep).label }}</span>
        </div>
        <!-- The gap is information: a missing episode keeps its row, title and
             air date, and says plainly that no upload was found. -->
        <div v-if="!isPlayable(ep)" class="ep-report" :style="{ color: C.dim }">
          {{ COPY.missingNote }}
          <a href="#" @click="report($event, ep)">
            {{ ui.reportedKeys.has(reportKey(ep)) ? COPY.reportedThanks : COPY.reportLink }}
          </a>
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
