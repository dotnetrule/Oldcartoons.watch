import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useContentStore } from './stores/content';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// index.json gates the whole shell — the header, the channel strip and the
// schedule all read it. Mount only once it is in hand.
useContentStore(pinia)
  .loadIndex()
  .then(() => {
    app.mount('#app');
  })
  .catch((error: unknown) => {
    // No fallback data path: a missing or unreadable index means the build
    // gate did not run, and mounting an empty archive would disguise that.
    const message = error instanceof Error ? error.message : String(error);
    console.error('failed to load /data/index.json', error);
    const root = document.getElementById('app');
    if (root) {
      root.textContent = `Archive data failed to load — run "npm run build-data". (${message})`;
      root.setAttribute('style', 'padding:24px;font:14px/1.5 monospace');
    }
  });
