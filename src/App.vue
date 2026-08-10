<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import HeaderBar from './components/HeaderBar.vue';
import ChannelTabs from './components/ChannelTabs.vue';
import { useUiStore } from './stores/ui';
import { useContentStore } from './stores/content';
import { pad2 } from './data/helpers';

const route = useRoute();
const ui = useUiStore();
const content = useContentStore();

const C = computed(() => ui.C);

const activeNetworkSlug = computed<string | null>(() => {
  if (route.name === 'network') return String(route.params.slug);
  if (route.name === 'series' || route.name === 'player') {
    return content.stub(String(route.params.slug))?.networkSlug ?? null;
  }
  return null;
});

/** The teletext page number in the header. Cosmetic, but it is the thing that
 * sells the conceit, so it tracks the real route. */
const pageCode = computed(() => {
  if (route.name === 'network') {
    const i = content.networks.findIndex((n) => n.slug === route.params.slug);
    return `2${pad2(i + 1)}`;
  }
  if (route.name === 'series') {
    const i = content.stubs.findIndex((s) => s.slug === route.params.slug);
    return `3${pad2(i + 1)}`;
  }
  if (route.name === 'player') {
    const i = content.stubs.findIndex((s) => s.slug === route.params.slug);
    return `4${pad2(i + 1)}·${pad2(Number(route.params.episode))}`;
  }
  return '100';
});

const flashStyle = computed(() => ({
  background: C.value.flashColor,
  mixBlendMode: C.value.flashBlend,
  animation: ui.flicker ? 'ntv-flicker 220ms ease-out' : 'none',
}));
</script>

<template>
  <div class="ntv-app" :style="{ background: C.bg, color: C.ink }">
    <div class="ntv-flash" :style="flashStyle"></div>
    <HeaderBar :page-code="pageCode" />
    <ChannelTabs :active-slug="activeNetworkSlug" />
    <main class="ntv-main">
      <router-view />
    </main>
    <footer class="ntv-footer" :style="{ borderColor: C.border, color: C.dim }">
      <span>
        No video is hosted here. Every episode plays as an embed from the
        rights-holder's own YouTube channel.
      </span>
      <span>
        Series and episode metadata from
        <a :style="{ color: C.dim2 }" href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>.
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </span>
    </footer>
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

.ntv-footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 20px 24px;
  border-top: 1px solid;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  line-height: 1.6;
  letter-spacing: 0.02em;
}

.ntv-footer a {
  text-decoration: underline;
}
</style>
