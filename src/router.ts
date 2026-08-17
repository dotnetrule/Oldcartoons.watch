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
import { useUiStore } from './stores/ui';

/** Series and episode routes load their series file before the view renders,
 * so a view never has to draw a loading state over data it was promised. A
 * rejected load propagates: there is no fallback route. */
const notFound = (): RouteLocationRaw => ({ path: '/niet-gevonden' });

async function loadSeriesData(slug: string): Promise<void | RouteLocationRaw> {
  const content = useContentStore();
  // Via the shared loader: a series page prints the next airing of this show,
  // which is a question about whichever line-up the viewer is watching.
  await loadBroadcastData();
  if (!content.stub(slug)) return notFound();
  await content.loadSeries(slug);
}

async function loadBroadcastData(): Promise<void> {
  const content = useContentStore();
  const ui = useUiStore();
  // The wider line-ups are a second payload, and a viewer who has that setting
  // on should not watch their channel tune to the Dutch feed and then jump. On
  // by default it is never requested at all.
  await Promise.all([
    content.loadIndex(),
    content.loadBroadcastData(),
    ui.languageMode === 'all' ? content.loadOpenSchedules() : Promise.resolve(),
  ]);
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
  },
  {
    path: '/zender/:slug',
    name: 'zender',
    component: NetworkView,
    props: true,
  },
  {
    path: '/kijken/:channelId',
    name: 'live',
    component: () => import('./views/LivePlayerView.vue'),
    props: true,
  },
  {
    path: '/programma/:slug',
    name: 'programma',
    component: SeriesView,
    props: true,
  },
  {
    // Real season and episode numbers, not array indices — the URL is the
    // episode's identity and has to survive TMDB reordering a season.
    path: '/programma/:slug/:season/:episode',
    name: 'aflevering',
    component: PlayerView,
    props: true,
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
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    // Selecting another channel only changes the guide's query string. Keep
    // the viewer at the card they clicked instead of jumping to the masthead.
    if (to.path === from.path) return false;
    return { top: 0 };
  },
});

/**
 * Load route data on every navigation, including a change to a dynamic param.
 *
 * Per-route `beforeEnter` guards do not run when `/programma/a` becomes
 * `/programma/b`, because Vue Router considers that the same route record.
 * A global resolve guard does, so a reused SeriesView can never receive a slug
 * whose generated file was not loaded first.
 */
router.beforeResolve((to) => {
  if (to.name === 'gids') return loadBroadcastData();
  if (to.name === 'zender') return loadNetworkData(String(to.params.slug));
  if (to.name === 'live') return loadChannelData(String(to.params.channelId));
  if (to.name === 'programma') return loadSeriesData(String(to.params.slug));
  if (to.name === 'aflevering') {
    return loadEpisodeData(
      String(to.params.slug),
      String(to.params.season),
      String(to.params.episode),
    );
  }
});

export default router;
