<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import { pad2 } from '../data/helpers';
import { LANGUAGE_COPY, LANGUAGE_OPTS } from '../data/language';
import NetworkLogo from './NetworkLogo.vue';

const props = defineProps<{ activeSlug?: string | null; guideActive?: boolean }>();

const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);
const orderedNetworks = computed(() => content.listedNetworks);
const panelRef = ref<HTMLElement | null>(null);

function go(slug: string): void {
  ui.triggerFlicker();
  void router.push(`/zender/${slug}`);
  ui.closeMenu();
}

function goGuide(): void {
  ui.triggerFlicker();
  void router.push('/');
  ui.closeMenu();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') ui.closeMenu();
}

/** A modal drawer needs to trap the page behind it and hand focus to itself
 * while open, then give both back on close — otherwise a keyboard or screen
 * reader user can keep tabbing or scrolling into content that is supposed to
 * be inert underneath it. */
watch(
  () => ui.menuOpen,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown);
      document.body.style.overflow = 'hidden';
      void nextTick(() => panelRef.value?.focus());
    } else {
      window.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    }
  },
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Transition name="ntv-drawer-fade">
    <div v-if="ui.menuOpen" class="ntv-drawer-backdrop" @click="ui.closeMenu()">
      <div
        ref="panelRef"
        class="ntv-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Zendermenu"
        tabindex="-1"
        :style="{ background: C.bg2, borderColor: C.border }"
        @click.stop
      >
        <!-- Above the stations because it decides what is on them. A viewer who
             opens the menu looking for something to watch should be able to
             widen the line-up without first learning that the header has a
             chip for it. -->
        <section class="ntv-drawer-setting" :style="{ borderColor: C.border2 }">
          <span class="ntv-drawer-setting-heading" :style="{ color: C.dim2 }">
            {{ LANGUAGE_COPY.drawerHeading }}
          </span>
          <div class="ntv-drawer-chips" role="group" :aria-label="LANGUAGE_COPY.chipGroup">
            <button
              v-for="opt in LANGUAGE_OPTS"
              :key="opt.id"
              type="button"
              class="ntv-drawer-chip"
              :style="{
                background: opt.id === ui.languageMode ? C.ink : 'transparent',
                color: opt.id === ui.languageMode ? C.chipFg : C.dim,
                borderColor: C.border2,
              }"
              :aria-pressed="opt.id === ui.languageMode"
              @click="ui.setLanguageMode(opt.id)"
            >
              {{ opt.label }}
            </button>
          </div>
          <p class="ntv-drawer-setting-hint" :style="{ color: C.dim }">
            {{ LANGUAGE_COPY.drawerHint }}
          </p>
        </section>

        <nav class="ntv-drawer-list" aria-label="Zenders en programmering">
          <button
            class="ntv-drawer-tab ntv-drawer-tab-guide"
            :style="{
              background: props.guideActive ? C.ink : 'transparent',
              color: props.guideActive ? C.chipFg : C.dim2,
              borderColor: C.border2,
            }"
            :aria-current="props.guideActive ? 'page' : undefined"
            @click="goGuide"
          >
            <span class="ntv-drawer-ch">100</span>
            <span class="ntv-drawer-name">TV-GIDS</span>
          </button>
          <button
            v-for="net in orderedNetworks"
            :key="net.slug"
            class="ntv-drawer-tab"
            :style="{
              background: net.slug === props.activeSlug ? ui.netColour(net) : 'transparent',
              color: net.slug === props.activeSlug ? C.chipFg : net.neutral ? C.dim : ui.netColour(net),
              borderColor: net.neutral ? C.border2 : ui.netColour(net),
            }"
            :aria-current="net.slug === props.activeSlug ? 'page' : undefined"
            @click="go(net.slug)"
          >
            <NetworkLogo :network="net" :size="26" decorative />
            <span class="ntv-drawer-ch">{{ pad2(net.channelNumber) }}</span>
            <span class="ntv-drawer-name">{{ net.name }}</span>
          </button>
        </nav>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ntv-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.6);
}

.ntv-drawer {
  width: 360px;
  max-width: 100%;
  height: 100%;
  border-left: 1px solid;
  /* A column so the setting block keeps its height and the station list — the
   * only part that can grow — takes the rest and scrolls inside it. */
  display: flex;
  flex-direction: column;
}

.ntv-drawer-setting {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 16px 14px;
  border-bottom: 1px solid;
}

.ntv-drawer-setting-heading {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.ntv-drawer-chips {
  display: flex;
  gap: 4px;
}

.ntv-drawer-chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 6px 10px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.ntv-drawer-chip:active {
  transform: scale(0.94);
}

.ntv-drawer-setting-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
}

.ntv-drawer-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
}

.ntv-drawer-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid;
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  flex: none;
  transition: background 150ms ease, color 150ms ease, transform 120ms ease;
}

.ntv-drawer-tab:hover {
  transform: translateX(2px);
}

.ntv-drawer-tab-guide {
  margin-bottom: 6px;
}

.ntv-drawer-ch {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 600;
  font-size: 13px;
}

.ntv-drawer-name {
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 14px;
}

.ntv-drawer-fade-enter-active,
.ntv-drawer-fade-leave-active {
  transition: opacity 200ms ease;
}

.ntv-drawer-fade-enter-active .ntv-drawer,
.ntv-drawer-fade-leave-active .ntv-drawer {
  transition: transform 200ms ease;
}

.ntv-drawer-fade-enter-from,
.ntv-drawer-fade-leave-to {
  opacity: 0;
}

.ntv-drawer-fade-enter-from .ntv-drawer,
.ntv-drawer-fade-leave-to .ntv-drawer {
  transform: translateX(100%);
}

@media (max-width: 480px) {
  .ntv-drawer {
    width: 100%;
  }
}
</style>
