<script setup>
import { useRouter } from 'vue-router';
import { useAppState } from '../composables/useAppState.js';

const props = defineProps({ activeId: { type: String, default: null } });

const router = useRouter();
const { nets, netColor, C, state, triggerFlicker } = useAppState();

function go(id) {
  triggerFlicker();
  router.push(`/broadcaster/${id}`);
}
</script>

<template>
  <nav class="ntv-tabs" aria-label="Broadcasters" :style="{ background: C.bg2, borderColor: C.border }">
    <button
      v-for="net in nets"
      :key="net.id"
      class="ntv-tab"
      :style="{
        background: net.id === props.activeId ? netColor(net) : 'transparent',
        color: net.id === props.activeId ? C.chipFg : net.neutral ? C.dim : netColor(net),
        borderColor: net.neutral ? C.border2 : netColor(net),
      }"
      @click="go(net.id)"
    >
      <div v-if="state.viewMode === 'covers'" class="ntv-tab-logo" :style="{ background: netColor(net) }"></div>
      <span class="ntv-tab-ch">{{ net.ch }}</span>
      <span class="ntv-tab-name">{{ net.name }}</span>
    </button>
  </nav>
</template>

<style scoped>
.ntv-tabs {
  position: sticky;
  top: 0;
  z-index: 49;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 20px;
  border-bottom: 1px solid;
  flex: none;
  transition: background 180ms ease, border-color 180ms ease;
}

.ntv-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px 6px 6px;
  border: 1px solid;
  border-radius: 2px;
  white-space: nowrap;
  cursor: pointer;
  font-size: 13px;
  flex: none;
  transition: background 150ms ease, color 150ms ease, transform 120ms ease;
}

.ntv-tab:hover {
  transform: translateY(-1px);
}

.ntv-tab-logo {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
}

.ntv-tab-ch {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 600;
}

.ntv-tab-name {
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 13px;
}
</style>
