<script setup>
import { useRouter } from 'vue-router';
import { useAppState } from '../composables/useAppState.js';

defineProps({ pageCode: { type: String, default: '' } });

const router = useRouter();
const { state, T, C, THEME_OPTS, VIEW_OPTS, REGIONS, LANGS, setTheme, setViewMode, setRegion, setLang, triggerFlicker } =
  useAppState();

function goSchedule() {
  triggerFlicker();
  router.push('/');
}

function chipStyle(active) {
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
      OLDCARTOONS<span :style="{ color: C.dim }">.</span>WATCH
    </button>
    <div class="ntv-header-right">
      <div class="ntv-chipgroup">
        <button
          v-for="opt in THEME_OPTS"
          :key="opt.id"
          class="ntv-chip"
          :style="chipStyle(opt.id === state.theme)"
          @click="setTheme(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="ntv-chipgroup">
        <button
          v-for="opt in VIEW_OPTS"
          :key="opt.id"
          class="ntv-chip"
          :style="chipStyle(opt.id === state.viewMode)"
          @click="setViewMode(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="ntv-chipgroup">
        <button
          v-for="r in REGIONS"
          :key="r.id"
          class="ntv-chip"
          :style="chipStyle(r.id === state.region)"
          @click="setRegion(r.id)"
        >
          {{ r.label }}
        </button>
      </div>
      <div class="ntv-chipgroup">
        <button
          v-for="l in LANGS"
          :key="l.id"
          class="ntv-chip"
          :style="chipStyle(l.id === state.lang)"
          @click="setLang(l.id)"
        >
          {{ l.label }}
        </button>
      </div>
      <div class="ntv-pagecode" :style="{ color: C.dim }">{{ T.page }} {{ pageCode }}</div>
    </div>
  </header>
</template>

<style scoped>
.ntv-header {
  position: sticky;
  top: 0;
  z-index: 50;
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
  gap: 3px;
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
