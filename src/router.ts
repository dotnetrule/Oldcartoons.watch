import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import ScheduleView from './views/ScheduleView.vue';
import NetworkView from './views/NetworkView.vue';
import SeriesView from './views/SeriesView.vue';
import PlayerView from './views/PlayerView.vue';
import { useContentStore } from './stores/content';

/** Series and episode routes load their series file before the view renders,
 * so a view never has to draw a loading state over data it was promised. A
 * rejected load propagates: there is no fallback route. */
async function loadSeriesData(slug: string): Promise<void> {
  const content = useContentStore();
  await Promise.all([content.loadIndex(), content.loadBroadcastData(), content.loadSeries(slug)]);
}

async function loadBroadcastData(): Promise<void> {
  const content = useContentStore();
  await Promise.all([content.loadIndex(), content.loadBroadcastData()]);
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'schedule',
    component: ScheduleView,
    beforeEnter: loadBroadcastData,
  },
  {
    path: '/network/:slug',
    name: 'network',
    component: NetworkView,
    props: true,
    beforeEnter: loadBroadcastData,
  },
  {
    path: '/watch/:channelId',
    name: 'live',
    component: () => import('./views/LivePlayerView.vue'),
    props: true,
    beforeEnter: loadBroadcastData,
  },
  {
    path: '/series/:slug',
    name: 'series',
    component: SeriesView,
    props: true,
    beforeEnter: (to) => loadSeriesData(String(to.params.slug)),
  },
  {
    // Real season and episode numbers, not array indices — the URL is the
    // episode's identity and has to survive TMDB reordering a season.
    path: '/series/:slug/:season/:episode',
    name: 'player',
    component: PlayerView,
    props: true,
    beforeEnter: (to) => loadSeriesData(String(to.params.slug)),
  },
];

if (import.meta.env.DEV) {
  // Dev-only, and statically eliminated from a production build: the branch
  // condition folds to `false`, so the admin chunk is never emitted.
  routes.push({
    path: '/admin',
    name: 'admin',
    component: () => import('./admin/AdminView.vue'),
  });
}

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
