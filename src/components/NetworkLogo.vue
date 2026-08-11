<script setup lang="ts">
import { computed } from 'vue';
import type { Network } from '../types';

/** A network's on-air mark. The plates carry their own broadcast colours, so
 * — unlike the monogram set they replaced — they must never be inverted for
 * the dark theme: a channel's colour is part of what identifies it. */
const props = withDefaults(
  defineProps<{
    network: Network;
    /** Rendered width in px; the plate keeps its 3:2 ratio. Sizing goes
     * through a custom property so a call site's media query can restate it —
     * an inline width would win over the parent's own rule. */
    size?: number;
    /** Set when an adjacent element already names the network. */
    decorative?: boolean;
  }>(),
  { size: 36, decorative: false },
);

const width = computed(() => `${props.size}px`);
</script>

<template>
  <img
    class="network-logo"
    :src="props.network.logo"
    :alt="props.decorative ? '' : props.network.name"
    :aria-hidden="props.decorative ? 'true' : undefined"
    :style="{ '--network-logo-width': width }"
  />
</template>

<style scoped>
.network-logo {
  flex: none;
  width: var(--network-logo-width);
  height: calc(var(--network-logo-width) * 2 / 3);
  object-fit: contain;
  border-radius: 2px;
}
</style>
