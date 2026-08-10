<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import CoverImage from '../components/CoverImage.vue';
import { episodeCountLabel, pad2, yearRangeLabel } from '../data/helpers';
import type { SeriesStub } from '../types';

const props = defineProps<{ slug: string }>();

const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);

const network = computed(() => content.network(props.slug));
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));

const yearsLabel = computed(() =>
  network.value ? yearRangeLabel(network.value.activeYears[0], network.value.activeYears[1]) : '',
);

/** One broadcaster, chronological. */
const series = computed<SeriesStub[]>(() =>
  network.value
    ? content.stubs
        .filter((s) => s.networkSlug === network.value?.slug)
        .sort((a, b) => a.firstAirYear - b.firstAirYear)
    : [],
);

const seriesYearsLabel = (s: SeriesStub): string => yearRangeLabel(s.firstAirYear, s.lastAirYear);
const epLabel = (s: SeriesStub): string => episodeCountLabel(s.episodeCount);

function goSeries(slug: string): void {
  ui.triggerFlicker();
  void router.push(`/series/${slug}`);
}
</script>

<template>
  <div v-if="network" class="bcast">
    <div class="bcast-head" :style="{ borderColor: colour }">
      <div class="mono dim" :style="{ color: C.dim }">
        CH {{ pad2(network.channelNumber) }} · {{ yearsLabel }}
      </div>
      <h1 :style="{ color: C.ink }">{{ network.name }}</h1>
      <div class="note" :style="{ color: C.dim2 }">{{ network.note }}</div>
    </div>

    <div v-if="ui.viewMode === 'listings'" class="bcast-list">
      <div
        v-for="s in series"
        :key="s.slug"
        class="bcast-row"
        role="button"
        tabindex="0"
        :style="{ borderColor: C.border }"
        @click="goSeries(s.slug)"
        @keydown.enter="goSeries(s.slug)"
      >
        <span class="title" :style="{ color: C.ink }">{{ s.name }}</span>
        <span class="mono dim" :style="{ color: C.dim }">{{ seriesYearsLabel(s) }} · {{ epLabel(s) }}</span>
      </div>
    </div>

    <div v-else class="bcast-covers">
      <div
        v-for="s in series"
        :key="s.slug"
        class="cover-card"
        role="button"
        tabindex="0"
        @click="goSeries(s.slug)"
        @keydown.enter="goSeries(s.slug)"
      >
        <CoverImage
          :title="s.name"
          :file-path="s.poster"
          size="w342"
          :accent-color="colour"
          class="cover-card-img"
        />
        <div class="cover-card-title" :style="{ color: C.ink }">{{ s.name }}</div>
        <div class="mono dim" :style="{ color: C.dim }">{{ seriesYearsLabel(s) }} · {{ epLabel(s) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bcast {
  padding: 28px 20px 40px;
  max-width: 960px;
}

.bcast-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 4px solid;
  padding-left: 18px;
  margin-bottom: 28px;
}

.bcast-head .mono {
  font-size: 12px;
  letter-spacing: 0.06em;
}

.bcast-head h1 {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 42px;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

.note {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  max-width: 560px;
}

.bcast-list {
  display: flex;
  flex-direction: column;
}

.bcast-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
  padding: 14px 6px;
  border-bottom: 1px solid;
  cursor: pointer;
  transition: background 120ms ease;
}

.bcast-row .title {
  font-family: 'Oswald', sans-serif;
  font-size: 19px;
}

.bcast-row .mono {
  font-size: 12px;
  white-space: nowrap;
}

.bcast-covers {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}

.cover-card {
  width: 200px;
  cursor: pointer;
  transition: transform 120ms ease;
}

.cover-card:hover {
  transform: translateY(-2px);
}

.cover-card-img {
  width: 200px;
  height: 112px;
  border-radius: 2px;
}

.cover-card-title {
  font-family: 'Oswald', sans-serif;
  font-size: 16px;
  margin-top: 8px;
}

.cover-card .mono {
  font-size: 11px;
}

.mono {
  font-family: 'IBM Plex Mono', monospace;
}
</style>
