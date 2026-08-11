<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import CoverImage from '../components/CoverImage.vue';
import SeriesStatusDot from '../components/SeriesStatusDot.vue';
import { countryLabel, episodeCountLabel, languageLabel, pad2, yearRangeLabel } from '../data/helpers';
import {
  SERIES_STATUS_META,
  seriesArchiveStatus,
  seriesArchiveStatusLabel,
  type SeriesArchiveStatus,
} from '../data/series-status';
import { broadcastProgress, formatChannelTime, nowAndNext } from '../broadcast/engine';
import type { BroadcastChannel, SeriesStub } from '../types';

const props = defineProps<{ slug: string }>();

const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);
const nowMs = ref(Date.now());

const network = computed(() => content.network(props.slug));
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));
const channels = computed(() => content.channelsForNetwork(props.slug));
const selectedChannelId = computed(() =>
  ui.selectedChannelId(props.slug, channels.value.map((channel) => channel.id)),
);
const channel = computed(() => content.channel(selectedChannelId.value));
const schedule = computed(() => content.scheduleForChannel(selectedChannelId.value));
const lineUp = computed(() => (schedule.value ? nowAndNext(schedule.value, nowMs.value, 5) : []));
const current = computed(() => lineUp.value[0] ?? null);
const upcoming = computed(() => lineUp.value.slice(1));

const yearsLabel = computed(() =>
  network.value ? yearRangeLabel(network.value.activeYears[0], network.value.activeYears[1]) : '',
);

const series = computed<SeriesStub[]>(() =>
  network.value
    ? content.stubs
        .filter((item) => item.networkSlugs.includes(props.slug))
        .sort(
          (a, b) =>
            Number(b.availableLanguages.includes('nl')) - Number(a.availableLanguages.includes('nl')) ||
            a.firstAirYear - b.firstAirYear,
        )
    : [],
);

let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1_000);
});
onBeforeUnmount(() => clearInterval(clockTimer));

const seriesYearsLabel = (item: SeriesStub): string =>
  yearRangeLabel(item.firstAirYear, item.lastAirYear);
const epLabel = (item: SeriesStub): string => episodeCountLabel(item.episodeCount);
const statusFor = (item: SeriesStub): SeriesArchiveStatus => seriesArchiveStatus(item);
const statusLabelFor = (item: SeriesStub): string => seriesArchiveStatusLabel(item);
const statusLegend = (
  Object.entries(SERIES_STATUS_META) as [SeriesArchiveStatus, { label: string }][]
).map(([status, meta]) => ({ status, label: meta.label }));
const time = (iso: string): string =>
  channel.value ? formatChannelTime(iso, channel.value.timezone) : '';

function selectChannel(target: BroadcastChannel): void {
  ui.selectChannel(props.slug, target.id);
}

function goSeries(slug: string): void {
  ui.triggerFlicker();
  void router.push({ path: `/programma/${slug}`, query: { zender: props.slug } });
}

function watchLive(): void {
  if (channel.value?.scheduleId) void router.push(`/kijken/${channel.value.id}`);
}

function goGuide(): void {
  if (channel.value?.scheduleId) {
    void router.push({ name: 'gids', query: { channel: channel.value.id } });
  }
}
</script>

<template>
  <div v-if="network" class="network-page">
    <header class="network-head" :style="{ borderColor: colour }">
      <img
        :src="network.logo"
        :alt="network.name"
        :style="{ filter: ui.theme === 'dark' ? 'invert(1)' : 'none' }"
      />
      <div class="network-identity">
        <span class="mono" :style="{ color: colour }">ZENDER {{ pad2(network.channelNumber) }} · {{ yearsLabel }}</span>
        <h1 :style="{ color: C.ink }">{{ network.name }}</h1>
        <p :style="{ color: C.dim2 }">{{ network.note }}</p>
      </div>
    </header>

    <section class="channels">
      <span class="section-label" :style="{ color: C.dim }">KIES EEN ZENDERVERSIE</span>
      <div class="channel-buttons">
        <button
          v-for="item in channels"
          :key="item.id"
          :style="{
            borderColor: item.id === selectedChannelId ? colour : C.border2,
            background: item.id === selectedChannelId ? C.focusBg : 'transparent',
            color: C.ink,
          }"
          @click="selectChannel(item)"
        >
          <strong>{{ item.name }}</strong>
          <span :style="{ color: C.dim }">{{ countryLabel(item.country) }} · {{ languageLabel(item.language) }} · {{ item.timezone }}</span>
          <i :style="{ color: item.scheduleId ? colour : C.dim }">{{ item.scheduleId ? 'IN DE LUCHT' : 'ARCHIEF VOLGT' }}</i>
        </button>
      </div>
    </section>

    <section v-if="channel && current" class="live-card" :style="{ borderColor: colour, background: C.bg2 }">
      <div class="live-copy">
        <span class="section-label" :style="{ color: colour }">● NU LIVE · {{ channel.name }}</span>
        <h2 :style="{ color: C.ink }">{{ current.show?.title }}</h2>
        <p :style="{ color: C.dim2 }">{{ current.episode?.title }}</p>
        <div class="live-time" :style="{ color: C.dim }">
          <span>{{ time(current.startsAt) }}</span>
          <div :style="{ background: C.border2 }">
            <i :style="{ width: `${broadcastProgress(current, nowMs) * 100}%`, background: colour }"></i>
          </div>
          <span>{{ time(current.endsAt) }}</span>
        </div>
        <div class="live-actions">
          <button :style="{ background: colour, color: C.chipFg }" @click="watchLive">KIJK LIVE →</button>
          <button :style="{ borderColor: C.border2, color: C.dim2 }" @click="goGuide">HELE PROGRAMMERING</button>
        </div>
      </div>

      <div class="coming-up" :style="{ borderColor: C.border }">
        <span class="section-label" :style="{ color: C.dim }">STRAKS</span>
        <div v-for="item in upcoming" :key="`${item.id}-${item.startsAt}`" :style="{ borderColor: C.border }">
          <time :style="{ color: C.dim }">{{ time(item.startsAt) }}</time>
          <p>
            <strong :style="{ color: C.ink }">{{ item.show?.title }}</strong>
            <span :style="{ color: C.dim }">{{ item.episode?.title }}</span>
          </p>
        </div>
      </div>
    </section>

    <section v-else-if="channel" class="not-live" :style="{ color: C.dim, borderColor: C.border }">
      <strong :style="{ color: C.ink }">Deze zender is nog niet in de lucht.</strong>
      <span>De zender en het programma-archief zijn al beschikbaar, maar er is nog niet genoeg gevalideerd materiaal voor een speelschema.</span>
    </section>

    <section class="archive">
      <div class="archive-head" :style="{ borderColor: C.border }">
        <div class="archive-heading">
          <span class="section-label" :style="{ color: C.dim }">PROGRAMMA-ARCHIEF</span>
          <h2 :style="{ color: C.ink }">PROGRAMMA’S OP {{ network.name }}</h2>
          <div class="status-legend" :style="{ color: C.dim }" aria-label="Seriesstatus legenda">
            <span v-for="entry in statusLegend" :key="entry.status">
              <SeriesStatusDot :status="entry.status" />
              {{ entry.label }}
            </span>
          </div>
        </div>
        <span class="mono" :style="{ color: C.dim }">{{ series.length }} TITELS</span>
      </div>

      <div v-if="ui.viewMode === 'listings'" class="archive-list">
        <div
          v-for="item in series"
          :key="item.slug"
          class="archive-row"
          role="button"
          tabindex="0"
          :style="{ borderColor: C.border }"
          @click="goSeries(item.slug)"
          @keydown.enter="goSeries(item.slug)"
        >
          <span class="title" :style="{ color: C.ink }">
            <SeriesStatusDot :status="statusFor(item)" :label="statusLabelFor(item)" />
            {{ item.name }}
          </span>
          <span class="mono" :style="{ color: C.dim }">
            <template v-if="item.availableLanguages.includes('nl')">NEDERLANDS · </template>{{ seriesYearsLabel(item) }} · {{ epLabel(item) }}
          </span>
        </div>
      </div>

      <div v-else class="archive-covers">
        <div
          v-for="item in series"
          :key="item.slug"
          class="cover-card"
          role="button"
          tabindex="0"
          @click="goSeries(item.slug)"
          @keydown.enter="goSeries(item.slug)"
        >
          <CoverImage
            :title="item.name"
            :file-path="item.poster"
            size="w342"
            :accent-color="colour"
            class="cover-card-img"
          />
          <strong :style="{ color: C.ink }">
            <SeriesStatusDot :status="statusFor(item)" :label="statusLabelFor(item)" />
            {{ item.name }}
          </strong>
          <span class="mono" :style="{ color: C.dim }">
            <template v-if="item.availableLanguages.includes('nl')">NEDERLANDS · </template>{{ seriesYearsLabel(item) }} · {{ epLabel(item) }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.network-page {
  width: min(1080px, calc(100% - 40px));
  margin: 0 auto;
  padding: 30px 0 64px;
}

.network-head {
  display: flex;
  align-items: center;
  gap: 24px;
  border-left: 4px solid;
  padding: 8px 0 8px 20px;
}

.network-head img {
  width: 90px;
  height: 72px;
  object-fit: contain;
}

.network-identity h1 {
  margin: 2px 0;
  font: 600 42px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.network-identity p {
  max-width: 650px;
  margin: 0;
  font-size: 14px;
}

.mono,
.section-label {
  font-family: 'IBM Plex Mono', monospace;
}

.network-identity .mono,
.section-label {
  font-size: 10px;
  letter-spacing: 0.09em;
}

.channels {
  padding: 26px 0 18px;
}

.channel-buttons {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-top: 8px;
}

.channel-buttons button {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: none;
  min-width: 230px;
  padding: 10px 70px 10px 11px;
  border: 1px solid;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.channel-buttons strong {
  font: 15px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.channel-buttons span,
.channel-buttons i {
  font: 9px 'IBM Plex Mono', monospace;
  font-style: normal;
}

.channel-buttons i {
  position: absolute;
  top: 11px;
  right: 9px;
}

.live-card {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  border: 1px solid;
  border-top-width: 3px;
}

.live-copy {
  padding: 24px;
}

.live-copy h2 {
  margin: 6px 0 0;
  font: 600 31px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.live-copy > p {
  margin: 0;
  font-size: 13px;
}

.live-time {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 18px;
  font: 10px 'IBM Plex Mono', monospace;
}

.live-time > div {
  height: 3px;
  flex: 1;
}

.live-time i {
  display: block;
  height: 100%;
}

.live-actions {
  display: flex;
  gap: 8px;
  margin-top: 18px;
}

.live-actions button {
  border: 1px solid transparent;
  padding: 8px 11px;
  font: 700 10px 'IBM Plex Mono', monospace;
  cursor: pointer;
}

.live-actions button:last-child {
  background: transparent;
}

.coming-up {
  padding: 20px;
  border-left: 1px solid;
}

.coming-up > div {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px solid;
}

.coming-up time {
  font: 10px 'IBM Plex Mono', monospace;
}

.coming-up p {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.coming-up strong {
  font: 14px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.coming-up p span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.not-live {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 28px 20px;
  border: 1px solid;
  font-size: 12px;
}

.archive {
  margin-top: 34px;
}

.archive-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid;
}

.archive-head h2 {
  margin: 2px 0 0;
  font: 600 25px 'Oswald', sans-serif;
}

.archive-heading {
  min-width: 0;
}

.status-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 8px;
  font: 9px 'IBM Plex Mono', monospace;
  text-transform: uppercase;
}

.status-legend > span,
.archive-row .title,
.cover-card strong {
  display: flex;
  align-items: center;
  gap: 7px;
}

.archive-head > .mono {
  font-size: 10px;
}

.archive-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 6px;
  border-bottom: 1px solid;
  cursor: pointer;
}

.archive-row .title {
  font: 18px 'Oswald', sans-serif;
}

.archive-row .mono,
.cover-card .mono {
  font-size: 10px;
}

.archive-covers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 18px;
  padding-top: 18px;
}

.cover-card {
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

.cover-card-img {
  width: 100%;
  aspect-ratio: 16 / 9;
}

.cover-card strong {
  margin-top: 7px;
  font: 16px 'Oswald', sans-serif;
}

@media (max-width: 720px) {
  .network-page {
    width: calc(100% - 28px);
    padding-top: 22px;
  }

  .network-head {
    align-items: flex-start;
    gap: 13px;
    padding-left: 13px;
  }

  .network-head img {
    width: 62px;
    height: 50px;
  }

  .network-identity h1 {
    font-size: 30px;
  }

  .live-card {
    grid-template-columns: 1fr;
  }

  .archive-head {
    align-items: flex-start;
  }

  .coming-up {
    border-top: 1px solid;
    border-left: 0;
  }
}
</style>
