<script setup lang="ts">
import { computed, watch } from 'vue';
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

/** The live route is the one page meant to fill the screen like a TV set
 * rather than a document that scrolls. See the `.ntv-app--live` rule below. */
const isLive = computed(() => route.name === 'live');

/**
 * `.ntv-app`'s own background only paints its box, so anything the box does
 * not cover — most visibly a browser's rubber-band overscroll past the top or
 * bottom of the page — falls through to `html`/`body`, which the static
 * stylesheet cannot theme because the choice lives in `localStorage` and is
 * read at runtime. Mirroring the active theme onto them here is what keeps
 * that fallback dark-or-light instead of the browser's default white.
 */
watch(
  () => C.value.bg,
  (bg) => {
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  },
  { immediate: true },
);

const activeNetworkSlug = computed<string | null>(() => {
  if (route.name === 'zender') return String(route.params.slug);
  if (route.name === 'live') return content.channel(String(route.params.channelId))?.networkSlug ?? null;
  if (route.name === 'programma' || route.name === 'aflevering') {
    const stub = content.stub(String(route.params.slug));
    if (!stub) return null;
    const requested = typeof route.query.zender === 'string' ? route.query.zender : null;
    if (requested && stub.networkSlugs.includes(requested) && content.network(requested)?.listed) {
      return requested;
    }
    return stub.networkSlugs.find((slug) => content.network(slug)?.listed) ?? null;
  }
  return null;
});

/** The teletext page number in the header. Cosmetic, but it is the thing that
 * sells the conceit, so it tracks the real route. */
const pageCode = computed(() => {
  if (route.name === 'zender') {
    const network = content.network(String(route.params.slug));
    return network ? `2${pad2(network.channelNumber)}` : '200';
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
  if (route.name === 'niet-gevonden') return '404';
  return '100';
});

const documentTitle = computed(() => {
  const suffix = 'TV van Toen';
  if (route.name === 'zender') {
    return `${content.network(String(route.params.slug))?.name ?? 'Zender'} — ${suffix}`;
  }
  if (route.name === 'live') {
    return `Live · ${content.channel(String(route.params.channelId))?.name ?? 'Zender'} — ${suffix}`;
  }
  if (route.name === 'programma' || route.name === 'aflevering') {
    const slug = String(route.params.slug);
    const name = content.stub(slug)?.name ?? 'Programma';
    if (route.name === 'aflevering') {
      const season = Number(route.params.season);
      const number = Number(route.params.episode);
      const title = content
        .series(slug)
        ?.seasons.find((item) => item.season === season)
        ?.episodes.find((item) => item.episode === number)?.title;
      return `${name}${title ? ` — ${title}` : ''} | ${suffix}`;
    }
    return `${name} — ${suffix}`;
  }
  if (route.name === 'niet-gevonden') return `Niet gevonden — ${suffix}`;
  return `${suffix} — zenders & programmering`;
});

watch(
  documentTitle,
  (title) => {
    document.title = title;
  },
  { immediate: true },
);

const flashStyle = computed(() => ({
  background: C.value.flashColor,
  mixBlendMode: C.value.flashBlend,
  animation: ui.flicker ? 'ntv-flicker 220ms ease-out' : 'none',
}));
</script>

<template>
  <div class="ntv-app" :class="{ 'ntv-app--live': isLive }" :style="{ background: C.bg, color: C.ink }">
    <div class="ntv-flash" :style="flashStyle"></div>
    <div class="ntv-chrome" :style="{ background: C.bg }">
      <HeaderBar :page-code="pageCode" />
      <ChannelTabs :active-slug="activeNetworkSlug" :guide-active="route.name === 'gids'" />
    </div>
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
      <span>
        Zenderposities 1–10 volgens de
        <a
          :style="{ color: C.dim2 }"
          href="https://www.digitalekabeltelevisie.nl/nieuws/archives/pdf/tvhomezenderkaarokt2005.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >TV Home-zenderkaart van september 2005</a>.
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

.ntv-chrome {
  position: sticky;
  top: 0;
  z-index: 50;
  flex: none;
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

/* On a phone the wrapped controls plus the horizontally scrolling channel
 * strip take a substantial part of the viewport. Keep both rows together on
 * desktop, but let that whole block scroll away on compact screens. */
@media (max-width: 640px) {
  .ntv-chrome {
    position: relative;
  }
}

/* The live route simulates a TV set: the picture is meant to fill the screen,
 * not sit above a scrollbar. Below this width `.live` still sizes itself off
 * the viewport directly (see LivePlayerView) and the page scrolls like any
 * other — chrome included, per the rule above. From here up, capping the app
 * to the viewport and letting the main area absorb whatever the sticky chrome
 * actually measures — rather than a height guess that only held while the
 * header stayed on one line — is what stops a page whose only scrollable
 * content was the footer below the fold. */
@media (min-width: 801px) {
  .ntv-app--live {
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .ntv-app--live .ntv-main {
    min-height: 0;
  }

  .ntv-app--live .ntv-footer {
    display: none;
  }
}
</style>
