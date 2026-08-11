<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import { pad2 } from '../data/helpers';

const props = defineProps<{ activeSlug?: string | null }>();

const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);
const orderedNetworks = computed(() =>
  [...content.networks].sort((a, b) => {
    const aDutch = content.channelsForNetwork(a.slug).some((channel) => channel.language === 'nl');
    const bDutch = content.channelsForNetwork(b.slug).some((channel) => channel.language === 'nl');
    return Number(bDutch) - Number(aDutch) || a.channelNumber - b.channelNumber;
  }),
);

function go(slug: string): void {
  ui.triggerFlicker();
  void router.push(`/zender/${slug}`);
}

function goGuide(): void {
  ui.triggerFlicker();
  void router.push('/');
}
</script>

<template>
  <nav class="ntv-tabs" aria-label="Zenders en programmering" :style="{ background: C.bg2, borderColor: C.border }">
    <button
      class="ntv-tab ntv-tab-guide"
      :style="{
        background: props.activeSlug ? 'transparent' : C.ink,
        color: props.activeSlug ? C.dim2 : C.chipFg,
        borderColor: C.border2,
      }"
      @click="goGuide"
    >
      <span class="ntv-tab-ch">100</span>
      <span class="ntv-tab-name">TV-GIDS</span>
    </button>
    <button
      v-for="net in orderedNetworks"
      :key="net.slug"
      class="ntv-tab"
      :style="{
        background: net.slug === props.activeSlug ? ui.netColour(net) : 'transparent',
        color: net.slug === props.activeSlug ? C.chipFg : net.neutral ? C.dim : ui.netColour(net),
        borderColor: net.neutral ? C.border2 : ui.netColour(net),
      }"
      @click="go(net.slug)"
    >
      <img
        v-if="ui.viewMode === 'covers'"
        class="ntv-tab-logo"
        :src="net.logo"
        :alt="''"
        aria-hidden="true"
      />
      <span class="ntv-tab-ch">{{ pad2(net.channelNumber) }}</span>
      <span class="ntv-tab-name">{{ net.name }}</span>
    </button>
  </nav>
</template>

<style scoped>
.ntv-tabs {
  position: sticky;
  top: 0;
  z-index: 49;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 20px;
  border-bottom: 1px solid;
  flex: none;
  transition: background 180ms ease, border-color 180ms ease;
}

.ntv-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px 6px 6px;
  border: 1px solid;
  border-radius: 2px;
  white-space: nowrap;
  cursor: pointer;
  font-size: 13px;
  flex: none;
  transition: background 150ms ease, color 150ms ease, transform 120ms ease;
}

.ntv-tab:hover {
  transform: translateY(-1px);
}

.ntv-tab-logo {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  /* The mark is a monogram drawn in currentColor, so it inherits the tab's
     active/neutral colour rather than needing a second palette. */
  object-fit: contain;
}

.ntv-tab-ch {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 600;
}

.ntv-tab-name {
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 13px;
}

.ntv-tab-guide {
  padding-left: 10px;
}
</style>
