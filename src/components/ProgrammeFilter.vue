<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../stores/ui';
import {
  AVAILABILITY_OPTS,
  PROGRAMME_FILTER_COPY,
  SORT_OPTS,
  type ProgrammeAvailability,
  type ProgrammeFilterState,
  type ProgrammeSort,
} from '../data/programme-filter';

/**
 * The control row above a list of programmes: search, sort, availability.
 *
 * State lives in the view that owns the list, not in a store — a channel's
 * archive is browsed one page at a time, and a sort carried over from the
 * previous station is not the "op naam" default this is specified to open in.
 */
const state = defineModel<ProgrammeFilterState>({ required: true });

const ui = useUiStore();
const C = computed(() => ui.C);

function chipStyle(active: boolean) {
  return {
    background: active ? C.value.ink : 'transparent',
    color: active ? C.value.chipFg : C.value.dim,
    borderColor: C.value.border2,
  };
}

function setQuery(value: string): void {
  state.value = { ...state.value, query: value };
}

function setSort(sort: ProgrammeSort): void {
  state.value = { ...state.value, sort };
}

function setAvailability(availability: ProgrammeAvailability): void {
  state.value = { ...state.value, availability };
}
</script>

<template>
  <div class="programme-filter" :style="{ borderColor: C.border }">
    <input
      class="programme-search"
      type="search"
      :value="state.query"
      :aria-label="PROGRAMME_FILTER_COPY.searchLabel"
      :placeholder="PROGRAMME_FILTER_COPY.searchPlaceholder"
      :style="{ background: C.bg2, color: C.ink, borderColor: C.border2 }"
      @input="setQuery(($event.target as HTMLInputElement).value)"
    />

    <div class="chipgroup" role="group" :aria-label="PROGRAMME_FILTER_COPY.sortGroup">
      <span class="chiplabel" :style="{ color: C.dim }">{{ PROGRAMME_FILTER_COPY.sortLabel }}</span>
      <button
        v-for="opt in SORT_OPTS"
        :key="opt.id"
        type="button"
        class="chip"
        :style="chipStyle(opt.id === state.sort)"
        :aria-pressed="opt.id === state.sort"
        @click="setSort(opt.id)"
      >
        {{ opt.label }}
      </button>
    </div>

    <div class="chipgroup" role="group" :aria-label="PROGRAMME_FILTER_COPY.availabilityGroup">
      <span class="chiplabel" :style="{ color: C.dim }">
        {{ PROGRAMME_FILTER_COPY.availabilityLabel }}
      </span>
      <button
        v-for="opt in AVAILABILITY_OPTS"
        :key="opt.id"
        type="button"
        class="chip"
        :style="chipStyle(opt.id === state.availability)"
        :aria-pressed="opt.id === state.availability"
        @click="setAvailability(opt.id)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.programme-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 12px 0;
  border-bottom: 1px solid;
}

.programme-search {
  flex: 1 1 220px;
  min-width: 0;
  max-width: 320px;
  padding: 7px 10px;
  border: 1px solid;
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}

.programme-search::placeholder {
  color: inherit;
  opacity: 0.5;
}

.chipgroup {
  display: flex;
  align-items: center;
  gap: 3px;
}

.chiplabel {
  margin-right: 3px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.chip {
  padding: 5px 9px;
  border: 1px solid;
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.chip:active {
  transform: scale(0.94);
}

@media (max-width: 720px) {
  .programme-search {
    flex-basis: 100%;
    max-width: none;
  }
}
</style>
