<script setup lang="ts">
import { computed } from 'vue';
import { SERIES_STATUS_META, type SeriesArchiveStatus } from '../data/series-status';

const props = defineProps<{
  status: SeriesArchiveStatus;
  label?: string;
}>();

const meta = computed(() => SERIES_STATUS_META[props.status]);
const accessibleLabel = computed(() => props.label ?? meta.value.label);
</script>

<template>
  <span
    class="series-status-dot"
    role="img"
    :aria-label="accessibleLabel"
    :title="accessibleLabel"
    :style="{ background: meta.colour }"
  ></span>
</template>

<style scoped>
.series-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.22);
}
</style>
