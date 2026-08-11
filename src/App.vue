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
  if (route.name === 'zender') return String(route.params.slug);
  if (route.name === 'live') return content.channel(String(route.params.channelId))?.networkSlug ?? null;
  if (route.name === 'programma' || route.name === 'aflevering') {
    return content.stub(String(route.params.slug))?.networkSlug ?? null;
  }
  return null;
});

/** The teletext page number in the header. Cosmetic, but it is the thing that
 * sells the conceit, so it tracks the real route. */
const pageCode = computed(() => {
  if (route.name === 'zender') {
    const i = content.networks.findIndex((n) => n.slug === route.params.slug);
    return `2${pad2(i + 1)}`;
  }
  if (route.name === 'programma') {
    const i = content.stubs.findIndex((s) => s.slug === route.params.slug);
    return `3${pad2(i + 1)}`;
  }
  if (route.name === 'aflevering') {
    const i = content.stubs.findIndex((s) => s.slug === route.params.slug);
    return `4${pad2(i + 1)}·${pad2(Number(route.params.episode))}`;
  }
  if (route.name === 'live') {
    const i = content.channels.findIndex((channel) => channel.id === route.params.channelId);
    return `5${pad2(i + 1)}`;
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
        We bewaren zelf geen video. Iedere uitzending speelt via een externe
        youtube-nocookie-embed uit een zorgvuldig gekozen bron.
      </span>
      <span>
        Informatie over programma’s en afleveringen komt van
        <a :style="{ color: C.dim2 }" href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>.
        Deze site gebruikt de TMDB-API, maar is niet verbonden aan of goedgekeurd door TMDB.
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
