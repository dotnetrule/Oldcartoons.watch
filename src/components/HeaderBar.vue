<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { COPY, VIEW_OPTS } from '../data/themes';
import { AGE_COPY, AGE_OPTS } from '../data/age';
import { LANGUAGE_COPY, LANGUAGE_OPTS } from '../data/language';

defineProps<{ pageCode?: string }>();

const router = useRouter();
const ui = useUiStore();
const C = computed(() => ui.C);
const menuBtnRef = ref<HTMLButtonElement | null>(null);

/** The drawer moves focus to itself while open; give it back to the button
 * that opened it once it closes, rather than letting focus fall to <body>. */
watch(
  () => ui.menuOpen,
  (open) => {
    if (!open) menuBtnRef.value?.focus();
  },
);

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
    <!-- The masthead. Deliberately its own row that never wraps: the menu
         button is the one control that has to be findable without looking, and
         while it shared a wrapping row with the filter chips it slid onto a
         second line the moment the window narrowed. -->
    <div class="ntv-topbar">
      <button class="ntv-logo" :style="{ color: C.ink }" @click="goSchedule">
        <span>TV</span><span :style="{ color: C.dim }">VAN</span><span>TOEN</span>
      </button>
      <div class="ntv-topbar-right">
        <div class="ntv-pagecode" :style="{ color: C.dim }">{{ COPY.page }} {{ pageCode }}</div>
        <button
          ref="menuBtnRef"
          class="ntv-menu-btn"
          type="button"
          :aria-label="ui.menuOpen ? 'Sluit menu' : 'Menu'"
          :aria-expanded="ui.menuOpen"
          @click="ui.toggleMenu()"
        >
          <span class="ntv-menu-bar" :style="{ background: C.ink }"></span>
          <span class="ntv-menu-bar" :style="{ background: C.ink }"></span>
          <span class="ntv-menu-bar" :style="{ background: C.ink }"></span>
        </button>
      </div>
    </div>

    <!-- Everything that changes what the page shows. This row may wrap. -->
    <div class="ntv-filters" :style="{ borderColor: C.border }">
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
      <div class="ntv-chipgroup" role="group" :aria-label="LANGUAGE_COPY.chipGroup">
        <span class="ntv-chiplabel" :style="{ color: C.dim }">{{ LANGUAGE_COPY.label }}</span>
        <button
          v-for="opt in LANGUAGE_OPTS"
          :key="opt.id"
          class="ntv-chip"
          :style="chipStyle(opt.id === ui.languageMode)"
          :aria-pressed="opt.id === ui.languageMode"
          @click="ui.setLanguageMode(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.ntv-header {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid;
  flex: none;
  transition: background 180ms ease, border-color 180ms ease;
}

.ntv-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* The point of the row. The masthead and the menu button keep the top line to
   * themselves at every width, so the button is always in the same corner. */
  flex-wrap: nowrap;
  gap: 10px;
  padding: 8px 20px;
  min-height: 36px;
}

.ntv-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.ntv-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 20px 8px;
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

.ntv-menu-btn {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 4px;
  width: 26px;
  height: 26px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  flex: none;
}

.ntv-menu-bar {
  display: block;
  height: 2px;
  border-radius: 1px;
}
</style>
