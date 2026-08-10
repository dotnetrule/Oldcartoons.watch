import { createRouter, createWebHistory } from 'vue-router';
import ScheduleView from './views/ScheduleView.vue';
import BroadcasterView from './views/BroadcasterView.vue';
import SeriesView from './views/SeriesView.vue';
import PlayerView from './views/PlayerView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'schedule', component: ScheduleView },
    { path: '/broadcaster/:id', name: 'broadcaster', component: BroadcasterView, props: true },
    { path: '/series/:id', name: 'series', component: SeriesView, props: true },
    { path: '/watch/:seriesId/:season/:episode', name: 'player', component: PlayerView, props: true },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
