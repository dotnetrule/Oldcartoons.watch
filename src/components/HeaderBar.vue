<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { COPY, THEME_OPTS, VIEW_OPTS } from '../data/themes';
import { AGE_COPY, AGE_OPTS } from '../data/age';

defineProps<{ pageCode?: string }>();

const router = useRouter();
const ui = useUiStore();
const C = computed(() => ui.C);

function goSchedule(): void {
  ui.triggerFlicker();
  void router.push('/');
}

function chipStyle(active: boolean) {
  return {
    background: active ? C.value.ink : 'transparent',
    color: active ? C.value.chipFg : C.value.dim,
    borderColor: C.value.border2,
  };
}
</script>

<template>
  <header class="ntv-header" :style="{ background: C.bg, borderColor: C.border }">
    <button class="ntv-logo" :style="{ color: C.ink }" @click="goSchedule">
      <span>TV</span><span :style="{ color: C.dim }">VAN</span><span>TOEN</span>
    </button>
    <div class="ntv-header-right">
      <div class="ntv-chipgroup">
        <button
          v-for="opt in THEME_OPTS"
          :key="opt.id"
          class="ntv-chip"
          :style="chipStyle(opt.id === ui.theme)"
          :aria-pressed="opt.id === ui.theme"
          @click="ui.setTheme(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="ntv-chipgroup">
        <button
          v-for="opt in VIEW_OPTS"
          :key="opt.id"
          class="ntv-chip"
          :style="chipStyle(opt.id === ui.viewMode)"
          :aria-pressed="opt.id === ui.viewMode"
          @click="ui.setViewMode(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="ntv-chipgroup" role="group" :aria-label="AGE_COPY.chipGroup">
        <span class="ntv-chiplabel" :style="{ color: C.dim }">LEEFTIJD</span>
        <button
          v-for="opt in AGE_OPTS"
          :key="opt.id"
          class="ntv-chip"
          :style="chipStyle(opt.id === ui.ageFilter)"
          :aria-pressed="opt.id === ui.ageFilter"
          @click="ui.setAgeFilter(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="ntv-pagecode" :style="{ color: C.dim }">{{ COPY.page }} {{ pageCode }}</div>
    </div>
  </header>
</template>

<style scoped>
.ntv-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 20px;
  min-height: 36px;
  border-bottom: 1px solid;
  flex: none;
  transition: background 180ms ease, border-color 180ms ease;
}

.ntv-logo {
  display: flex;
  align-items: center;
  gap: 0.55em;
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: 0;
  white-space: nowrap;
}

.ntv-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.ntv-chipgroup {
  display: flex;
  align-items: center;
  gap: 3px;
}

.ntv-chiplabel {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  margin-right: 3px;
  white-space: nowrap;
}

.ntv-chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 9px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.ntv-chip:active {
  transform: scale(0.94);
}

.ntv-pagecode {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
</style>
