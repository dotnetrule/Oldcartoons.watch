<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppState } from '../composables/useAppState.js';
import CoverImage from '../components/CoverImage.vue';

const router = useRouter();
const { state, T, C, nets, allSeries, decades, netColor, setTypeFilter, setAgeFilter, setPreview, triggerFlicker } =
  useAppState();

const viewportW = ref(window.innerWidth);
function onResize() {
  viewportW.value = window.innerWidth;
}
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => window.removeEventListener('resize', onResize));
const isMobile = computed(() => viewportW.value < 760);

const typeKeys = ['All', 'Animation', 'Live-action'];
const ageKeys = ['All', 'Preschool', 'Kids', 'Tween', 'Adult'];

function matchesFilter(s) {
  return (state.typeFilter === 'All' || s.type === state.typeFilter) && (state.ageFilter === 'All' || s.age === state.ageFilter);
}

function yearsLabel(s) {
  return s.yearStart + '–' + s.yearEnd;
}
function epLabel(s) {
  return typeof s.episodeCount === 'number' ? s.episodeCount + ' EP' : '— EP';
}

function goSeries(id) {
  triggerFlicker();
  router.push('/series/' + id);
}

function chipStyle(active) {
  return {
    background: active ? C.value.ink : 'transparent',
    color: active ? C.value.chipFg : C.value.dim,
    borderColor: C.value.border2,
  };
}

const scheduleRows = computed(() =>
  nets.value.map((net, rowIdx) => {
    const netSeries = allSeries.value.filter((s) => s.network === net.id);
    let colCounter = 0;
    const cells = decades.value.map((dec) => {
      const entries = netSeries
        .filter((s) => s.decade === dec && matchesFilter(s))
        .map((s) => ({ series: s, colIdx: colCounter++ }));
      return { decade: dec, entries, empty: entries.length === 0 };
    });
    return { network: net, rowIdx, cells };
  }),
);

const mobileGroups = computed(() =>
  nets.value
    .map((net) => ({
      network: net,
      items: allSeries.value.filter((s) => s.network === net.id && matchesFilter(s)).sort((a, b) => a.yearStart - b.yearStart),
    }))
    .filter((g) => g.items.length > 0),
);

const previewSeries = computed(() => allSeries.value.find((s) => s.id === state.previewId) || null);
const previewNet = computed(() => (previewSeries.value ? nets.value.find((n) => n.id === previewSeries.value.network) : null));

function handleGridKeyDown(e, row, col) {
  const key = e.key;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) return;
  e.preventDefault();
  if (key === 'Enter' || key === ' ') {
    e.currentTarget.click();
    return;
  }
  const root = e.currentTarget.closest('[data-grid-root]');
  if (!root) return;
  let r = row;
  let c = col;
  if (key === 'ArrowRight') c++;
  else if (key === 'ArrowLeft') c--;
  else if (key === 'ArrowDown') r++;
  else if (key === 'ArrowUp') r--;
  let target = null;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    target = root.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  } else {
    for (let cc = c; cc >= 0 && !target; cc--) target = root.querySelector(`[data-row="${r}"][data-col="${cc}"]`);
    if (!target) target = root.querySelector(`[data-row="${r}"]`);
  }
  if (target) target.focus();
}
</script>

<template>
  <div class="sched">
    <div class="sched-head" :style="{ borderBottom: C.titleRule }">
      <h1 class="sched-title" :style="{ color: C.ink }">{{ T.schedule }}</h1>
      <div class="sched-filters">
        <div class="chipgroup">
          <button v-for="t in typeKeys" :key="t" class="chip" :style="chipStyle(t === state.typeFilter)" @click="setTypeFilter(t)">
            {{ T.type[t] }}
          </button>
        </div>
        <div class="chipgroup">
          <button v-for="a in ageKeys" :key="a" class="chip" :style="chipStyle(a === state.ageFilter)" @click="setAgeFilter(a)">
            {{ T.age[a] }}
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile: grouped list -->
    <div v-if="isMobile" class="sched-mobile">
      <div v-for="grp in mobileGroups" :key="grp.network.id" class="mobile-group">
        <div class="mobile-group-head" :style="{ borderColor: netColor(grp.network) }">
          <span class="mono" :style="{ color: netColor(grp.network) }">{{ grp.network.ch }}</span>
          <span class="netname" :style="{ color: C.ink }">{{ grp.network.name }}</span>
        </div>
        <div
          v-for="s in grp.items"
          :key="s.id"
          class="mobile-row"
          :style="{ borderColor: C.border }"
          @click="goSeries(s.id)"
        >
          <CoverImage v-if="state.viewMode === 'covers'" :series="s" :accent-color="netColor(grp.network)" class="mobile-cover" />
          <span class="mobile-title" :style="{ color: C.ink }">{{ s.title }}</span>
          <span class="mono dim" :style="{ color: C.dim }">{{ yearsLabel(s) }} · {{ epLabel(s) }}</span>
        </div>
      </div>
    </div>

    <!-- Desktop: schedule grid -->
    <div v-else class="sched-desktop">
      <div data-grid-root class="grid-root">
        <div class="grid-headrow">
          <div class="grid-corner"></div>
          <div v-for="dec in decades" :key="dec" class="grid-dechead" :style="{ color: C.dim, borderColor: C.border2 }">
            {{ T.decade[dec] }}
          </div>
        </div>
        <div v-for="row in scheduleRows" :key="row.network.id" class="grid-row">
          <div
            class="grid-netcell"
            :style="{ borderTopColor: C.border, borderLeftColor: netColor(row.network), background: C.rowStripe }"
          >
            <span class="mono" :style="{ color: netColor(row.network) }">{{ row.network.ch }}</span>
            <span class="netname" :style="{ color: C.ink }">{{ row.network.name }}</span>
          </div>
          <div v-for="cell in row.cells" :key="cell.decade" class="grid-cell" :style="{ borderColor: C.border }">
            <span v-if="cell.empty" class="grid-empty" :style="{ color: C.dim }">—</span>
            <div
              v-for="entry in cell.entries"
              :key="entry.series.id"
              class="grid-entry"
              role="button"
              tabindex="0"
              :data-row="row.rowIdx"
              :data-col="entry.colIdx"
              @click="goSeries(entry.series.id)"
              @keydown="(e) => handleGridKeyDown(e, row.rowIdx, entry.colIdx)"
              @mouseenter="setPreview(entry.series.id)"
              @focus="setPreview(entry.series.id)"
            >
              <CoverImage
                v-if="state.viewMode === 'covers'"
                :series="entry.series"
                :accent-color="netColor(row.network)"
                class="grid-cover"
              />
              <div class="grid-entry-text">
                <div class="grid-entry-title" :style="{ color: C.ink }">{{ entry.series.title }}</div>
                <div class="mono dim" :style="{ color: C.dim }">{{ yearsLabel(entry.series) }} · {{ epLabel(entry.series) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview dock -->
    <div class="preview-dock" :style="{ background: C.bg2, borderColor: C.border2 }">
      <template v-if="previewSeries">
        <div class="preview-thumb" :style="{ background: C.hoverBg, borderColor: C.border2 }">
          <span class="preview-initials" :style="{ color: netColor(previewNet) }">{{
            previewSeries.title
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()
          }}</span>
        </div>
        <div class="preview-info">
          <div class="preview-title" :style="{ color: C.ink }">{{ previewSeries.title }}</div>
          <div class="mono dim" :style="{ color: C.dim }">
            {{ yearsLabel(previewSeries) }} · {{ previewNet?.name }} · {{ T.firstAired }} {{ previewSeries.firstAirDate }} ·
            {{ epLabel(previewSeries) }}
          </div>
        </div>
      </template>
      <span v-else class="mono dim" :style="{ color: C.dim }">{{ T.hoverHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.sched {
  padding: 20px 20px 124px;
}

.sched-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 16px;
  padding-bottom: 10px;
}

.sched-title {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 34px;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.sched-filters {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}

.chipgroup {
  display: flex;
  gap: 4px;
}

.chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  padding: 5px 10px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.mono {
  font-family: 'IBM Plex Mono', monospace;
}

.dim {
  font-size: 11px;
}

/* Mobile */
.sched-mobile {
  padding: 4px 0 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.mobile-group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 2px solid;
  margin-bottom: 8px;
}

.mobile-group-head .mono {
  font-size: 13px;
}

.netname {
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
  font-size: 16px;
  letter-spacing: 0.03em;
}

.mobile-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 4px;
  border-bottom: 1px solid;
  cursor: pointer;
}

.mobile-cover {
  width: 64px;
  height: 36px;
  flex: none;
}

.mobile-title {
  font-family: 'Oswald', sans-serif;
  font-size: 17px;
  flex: 1;
}

/* Desktop grid */
.sched-desktop {
  overflow-x: auto;
  padding: 8px 0 24px;
}

.grid-root {
  display: flex;
  flex-direction: column;
  min-width: 980px;
}

.grid-headrow {
  display: flex;
}

.grid-corner {
  width: 172px;
  flex: none;
}

.grid-dechead {
  flex: 1;
  min-width: 200px;
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 13px;
  padding: 6px 10px;
  border-bottom: 1px solid;
}

.grid-row {
  display: flex;
}

.grid-netcell {
  width: 172px;
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 12px 10px;
  border-top: 1px solid;
  border-left: 3px solid;
}

.grid-netcell .mono {
  font-size: 14px;
}

.grid-netcell .netname {
  font-size: 15px;
  line-height: 1.15;
}

.grid-cell {
  flex: 1;
  min-width: 200px;
  padding: 8px 10px;
  border-top: 1px solid;
  border-left: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  min-height: 64px;
}

.grid-empty {
  font-family: 'IBM Plex Mono', monospace;
  opacity: 0.6;
  font-size: 13px;
}

.grid-entry {
  cursor: pointer;
  padding: 3px 4px;
  border-radius: 1px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 120ms ease, transform 120ms ease;
}

.grid-entry:hover {
  transform: translateX(1px);
}

.grid-cover {
  width: 64px;
  height: 36px;
  flex: none;
}

.grid-entry-text {
  min-width: 0;
}

.grid-entry-title {
  font-family: 'Oswald', sans-serif;
  font-size: 16px;
  line-height: 1.15;
  letter-spacing: 0.01em;
}

.grid-entry-text .mono {
  font-size: 11px;
  margin-top: 2px;
}

/* Preview dock */
.preview-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 104px;
  border-top: 1px solid;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  z-index: 40;
  transition: background 180ms ease, border-color 180ms ease;
}

.preview-thumb {
  width: 72px;
  height: 72px;
  flex: none;
  border: 1px solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-initials {
  font-family: 'Oswald', sans-serif;
  font-size: 22px;
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.preview-title {
  font-family: 'Oswald', sans-serif;
  font-size: 20px;
  text-transform: uppercase;
  letter-spacing: 0.01em;
}

.preview-info .mono {
  font-size: 12px;
}

.preview-dock > .mono {
  font-size: 12px;
}
</style>
