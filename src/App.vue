<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import HeaderBar from './components/HeaderBar.vue';
import ChannelTabs from './components/ChannelTabs.vue';
import { useAppState } from './composables/useAppState.js';
import { pad2 } from './data/helpers.js';

const route = useRoute();
const { state, C, nets, allSeries } = useAppState();

const activeNetworkId = computed(() => {
  if (route.name === 'broadcaster') return route.params.id;
  if (route.name === 'series') {
    const s = allSeries.value.find((x) => x.id === route.params.id);
    return s ? s.network : null;
  }
  if (route.name === 'player') {
    const s = allSeries.value.find((x) => x.id === route.params.seriesId);
    return s ? s.network : null;
  }
  return null;
});

const pageCode = computed(() => {
  const prefix = state.region === 'usa' ? 'U' : 'N';
  if (route.name === 'broadcaster') {
    const i = nets.value.findIndex((n) => n.id === route.params.id);
    return prefix + '2' + pad2(i + 1);
  }
  if (route.name === 'series') {
    const i = allSeries.value.findIndex((s) => s.id === route.params.id);
    return prefix + '3' + pad2(i + 1);
  }
  if (route.name === 'player') {
    const i = allSeries.value.findIndex((s) => s.id === route.params.seriesId);
    return prefix + '4' + pad2(i + 1) + '·' + pad2(Number(route.params.episode) + 1);
  }
  return prefix + '100';
});

const flashStyle = computed(() => ({
  background: C.value.flashColor,
  mixBlendMode: C.value.flashBlend,
  animation: state.flicker ? 'ntv-flicker 220ms ease-out' : 'none',
}));
</script>

<template>
  <div class="ntv-app" :style="{ background: C.bg, color: C.ink }">
    <div class="ntv-flash" :style="flashStyle"></div>
    <HeaderBar :page-code="pageCode" />
    <ChannelTabs :active-id="activeNetworkId" />
    <main class="ntv-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.ntv-app {
  min-height: 100vh;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  transition: background 180ms ease, color 180ms ease;
}

.ntv-flash {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0;
}

.ntv-main {
  flex: 1;
}
</style>
