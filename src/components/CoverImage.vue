<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { initialsFor, tmdbImage } from '../data/helpers';

/**
 * Artwork, built from a TMDB `file_path` at render time.
 *
 * The runtime TMDB lookup this replaces is gone: `file_path` arrives in the
 * generated JSON, and the URL is pure string construction. The initials tile
 * is not a data fallback — it is how the design draws a series TMDB has no
 * artwork for, which is a real and permanent state for a lot of this archive.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    /** TMDB file_path, or null when there is no artwork. */
    filePath?: string | null;
    size?: string;
    fit?: 'cover' | 'contain';
    accentColor?: string;
    loading?: 'eager' | 'lazy';
    fetchPriority?: 'high' | 'low' | 'auto';
  }>(),
  {
    filePath: null,
    size: 'w500',
    fit: 'cover',
    accentColor: '#8A93A6',
    loading: 'lazy',
    fetchPriority: 'auto',
  },
);

const src = computed(() => (props.filePath ? tmdbImage(props.filePath, props.size) : null));
const initials = computed(() => initialsFor(props.title));
const imageFailed = ref(false);

watch(src, () => {
  imageFailed.value = false;
});
</script>

<template>
  <div class="ntv-cover">
    <img
      v-if="src && !imageFailed"
      :src="src"
      :alt="title"
      :loading="loading"
      :fetchpriority="fetchPriority"
      :style="{ objectFit: fit }"
      @error="imageFailed = true"
    />
    <div v-else class="ntv-cover-empty" :style="{ color: accentColor }" :title="title">
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
