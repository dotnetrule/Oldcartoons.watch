<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';

const router = useRouter();
const ui = useUiStore();
const C = computed(() => ui.C);
</script>

<template>
  <section class="not-found" :style="{ borderColor: C.border2, background: C.bg2 }">
    <span :style="{ color: C.dim }">PAG 404 · GEEN SIGNAAL</span>
    <h1 :style="{ color: C.ink }">Deze pagina bestaat niet</h1>
    <p :style="{ color: C.dim2 }">
      De zender, het programma of de aflevering op dit adres is niet in het archief gevonden.
    </p>
    <button type="button" :style="{ borderColor: C.border2, color: C.dim2 }" @click="router.push('/')">
      ← Terug naar de TV-gids
    </button>
  </section>
</template>

<style scoped>
.not-found {
  width: min(620px, calc(100% - 28px));
  margin: 72px auto;
  padding: 28px;
  border: 1px solid;
}

.not-found span,
.not-found button {
  font: 11px 'IBM Plex Mono', monospace;
  letter-spacing: 0.07em;
}

.not-found h1 {
  margin: 8px 0;
  font: 600 34px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.not-found p {
  max-width: 32rem;
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
}

.not-found button {
  margin-top: 22px;
  padding: 8px 12px;
  border: 1px solid;
  background: transparent;
  cursor: pointer;
}
</style>
