import {
  createRouter,
  createWebHistory,
  type RouteLocationRaw,
  type RouteRecordRaw,
} from 'vue-router';
import ScheduleView from './views/ScheduleView.vue';
import NetworkView from './views/NetworkView.vue';
import SeriesView from './views/SeriesView.vue';
import PlayerView from './views/PlayerView.vue';
import { useContentStore } from './stores/content';

/** Series and episode routes load their series file before the view renders,
 * so a view never has to draw a loading state over data it was promised. A
 * rejected load propagates: there is no fallback route. */
const notFound = (): RouteLocationRaw => ({ name: 'niet-gevonden' });

async function loadSeriesData(slug: string): Promise<void | RouteLocationRaw> {
  const content = useContentStore();
  await Promise.all([content.loadIndex(), content.loadBroadcastData()]);
  if (!content.stub(slug)) return notFound();
  await content.loadSeries(slug);
}

async function loadBroadcastData(): Promise<void> {
  const content = useContentStore();
  await Promise.all([content.loadIndex(), content.loadBroadcastData()]);
}

async function loadNetworkData(slug: string): Promise<void | RouteLocationRaw> {
  await loadBroadcastData();
  return useContentStore().network(slug) ? undefined : notFound();
}

async function loadChannelData(channelId: string): Promise<void | RouteLocationRaw> {
  await loadBroadcastData();
  return useContentStore().channel(channelId) ? undefined : notFound();
}

async function loadEpisodeData(
  slug: string,
  seasonNumber: string,
  episodeNumber: string,
): Promise<void | RouteLocationRaw> {
  const missingSeries = await loadSeriesData(slug);
  if (missingSeries) return missingSeries;

  const season = Number(seasonNumber);
  const episode = Number(episodeNumber);
  const valid = useContentStore()
    .series(slug)
    ?.seasons.find((item) => item.season === season)
    ?.episodes.some((item) => item.episode === episode);
  return valid ? undefined : notFound();
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'gids',
    component: ScheduleView,
    beforeEnter: loadBroadcastData,
  },
  {
    path: '/zender/:slug',
    name: 'zender',
    component: NetworkView,
    props: true,
    beforeEnter: (to) => loadNetworkData(String(to.params.slug)),
  },
  {
    path: '/kijken/:channelId',
    name: 'live',
    component: () => import('./views/LivePlayerView.vue'),
    props: true,
    beforeEnter: (to) => loadChannelData(String(to.params.channelId)),
  },
  {
    path: '/programma/:slug',
    name: 'programma',
    component: SeriesView,
    props: true,
    beforeEnter: (to) => loadSeriesData(String(to.params.slug)),
  },
  {
    // Real season and episode numbers, not array indices — the URL is the
    // episode's identity and has to survive TMDB reordering a season.
    path: '/programma/:slug/:season/:episode',
    name: 'aflevering',
    component: PlayerView,
    props: true,
    beforeEnter: (to) =>
      loadEpisodeData(
        String(to.params.slug),
        String(to.params.season),
        String(to.params.episode),
      ),
  },
];

// Oude publieke adressen blijven werken, maar leiden naar de Nederlandse URL's.
routes.push(
  { path: '/network/:slug', redirect: (to) => `/zender/${String(to.params.slug)}` },
  { path: '/watch/:channelId', redirect: (to) => `/kijken/${String(to.params.channelId)}` },
  { path: '/series/:slug', redirect: (to) => `/programma/${String(to.params.slug)}` },
  {
    path: '/series/:slug/:season/:episode',
    redirect: (to) => `/programma/${String(to.params.slug)}/${String(to.params.season)}/${String(to.params.episode)}`,
  },
);

if (import.meta.env.DEV) {
  // Dev-only, and statically eliminated from a production build: the branch
  // condition folds to `false`, so the admin chunk is never emitted.
  routes.push({
    path: '/admin',
    name: 'admin',
    component: () => import('./admin/AdminView.vue'),
  });
}

routes.push({
  path: '/:pathMatch(.*)*',
  name: 'niet-gevonden',
  component: () => import('./views/NotFoundView.vue'),
});

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
