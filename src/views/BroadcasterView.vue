<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppState } from '../composables/useAppState.js';
import CoverImage from '../components/CoverImage.vue';

const props = defineProps({ id: { type: String, required: true } });

const router = useRouter();
const { state, C, nets, allSeries, netColor, triggerFlicker } = useAppState();

const network = computed(() => nets.value.find((n) => n.id === props.id) || null);
const color = computed(() => (network.value ? netColor(network.value) : C.value.dim));
const yearsLabel = computed(() => network.value?.years?.[state.lang] || '');
const note = computed(() => network.value?.note?.[state.lang] || '');

const series = computed(() =>
  network.value
    ? allSeries.value.filter((s) => s.network === network.value.id).sort((a, b) => a.yearStart - b.yearStart)
    : [],
);

function seriesYearsLabel(s) {
  return s.yearStart + '–' + s.yearEnd;
}
function epLabel(s) {
  return typeof s.episodeCount === 'number' ? s.episodeCount + ' EP' : '— EP';
}

function goSeries(id) {
  triggerFlicker();
  router.push('/series/' + id);
}
</script>

<template>
  <div v-if="network" class="bcast">
    <div class="bcast-head" :style="{ borderColor: color }">
      <div class="mono dim" :style="{ color: C.dim }">CH {{ network.ch }} · {{ yearsLabel }}</div>
      <h1 :style="{ color: C.ink }">{{ network.name }}</h1>
      <div class="note" :style="{ color: C.dim2 }">{{ note }}</div>
    </div>

    <div v-if="state.viewMode === 'listings'" class="bcast-list">
      <div
        v-for="s in series"
        :key="s.id"
        class="bcast-row"
        role="button"
        tabindex="0"
        :style="{ borderColor: C.border }"
        @click="goSeries(s.id)"
        @keydown.enter="goSeries(s.id)"
      >
        <span class="title" :style="{ color: C.ink }">{{ s.title }}</span>
        <span class="mono dim" :style="{ color: C.dim }">{{ seriesYearsLabel(s) }} · {{ epLabel(s) }}</span>
      </div>
    </div>

    <div v-else class="bcast-covers">
      <div
        v-for="s in series"
        :key="s.id"
        class="cover-card"
        role="button"
        tabindex="0"
        @click="goSeries(s.id)"
        @keydown.enter="goSeries(s.id)"
      >
        <CoverImage :series="s" :accent-color="color" class="cover-card-img" />
        <div class="cover-card-title" :style="{ color: C.ink }">{{ s.title }}</div>
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
