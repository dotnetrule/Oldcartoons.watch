<script setup>
import { ref, computed, watch } from 'vue';
import { hasTmdbKey, enrichSeriesArtwork } from '../services/tmdb.js';
import { initialsFor } from '../data/helpers.js';

const props = defineProps({
  series: { type: Object, required: true },
  kind: { type: String, default: 'poster' }, // 'poster' | 'backdrop'
  accentColor: { type: String, default: '#8A93A6' },
  placeholder: { type: String, default: '' },
});

const artwork = ref(null);

async function load() {
  artwork.value = null;
  if (!hasTmdbKey) return;
  const result = await enrichSeriesArtwork(props.series);
  // Guard against a stale response landing after the series prop moved on.
  if (result && props.series) artwork.value = result;
}

watch(() => props.series?.id, load, { immediate: true });

const src = computed(() => {
  if (!artwork.value) return null;
  return props.kind === 'backdrop' ? artwork.value.backdropUrl : artwork.value.posterUrl;
});

const initials = computed(() => initialsFor(props.series.title));
</script>

<template>
  <div class="ntv-cover">
    <img v-if="src" :src="src" :alt="series.title" loading="lazy" />
    <div v-else class="ntv-cover-empty" :style="{ color: accentColor }" :title="placeholder || series.title">
      <span>{{ initials }}</span>
    </div>
  </div>
</template>

<style scoped>
.ntv-cover {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.1);
  flex: none;
}

.ntv-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ntv-cover-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.02em;
  opacity: 0.7;
  border: 1px solid currentColor;
}
</style>
