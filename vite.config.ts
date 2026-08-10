import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { adminWriteMiddleware } from './scripts/lib/admin-middleware';

// The admin's write endpoint is a dev-server middleware and never enters the
// production bundle, so there is nothing to authenticate at runtime. The guard
// lives inside the factory rather than at module scope — a top-level throw here
// would take `vite build` down with it.
const adminPlugins = process.env.NODE_ENV === 'production' ? [] : [adminWriteMiddleware()];

export default defineConfig({
  plugins: [vue(), ...adminPlugins],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
