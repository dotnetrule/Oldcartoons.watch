<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useContentStore } from '../stores/content';
import { useUiStore } from '../stores/ui';
import {
  broadcastProgress,
  broadcastsForChannelDay,
  channelDateKey,
  formatChannelTime,
  formatGuideDate,
  nowAndNext,
  shiftDateKey,
} from '../broadcast/engine';
import {
  broadcastTypeLabel,
  countryLabel,
  episodeCountLabel,
  guideCoverageLabel,
  languageLabel,
  pad2,
  weekRangeLabel,
  yearRangeLabel,
} from '../data/helpers';
import SeriesStatusDot from '../components/SeriesStatusDot.vue';
import { seriesArchiveStatus, seriesArchiveStatusLabel } from '../data/series-status';
import type { BroadcastChannel, SeriesStub } from '../types';

const route = useRoute();
const router = useRouter();
const content = useContentStore();
const ui = useUiStore();
const C = computed(() => ui.C);
const nowMs = ref(Date.now());
/** The channel map only. A replayed archive week is reachable from its
 * broadcaster page and by deep link, but it is not one of the ten channels. */
const prioritizedChannels = computed(() =>
  [...content.mapChannels].sort((a, b) => {
    const languageOrder = Number(b.language === 'nl') - Number(a.language === 'nl');
    const countryOrder = Number(b.country === 'NL') - Number(a.country === 'NL');
    const aNumber = content.network(a.networkSlug)?.channelNumber ?? 999;
    const bNumber = content.network(b.networkSlug)?.channelNumber ?? 999;
    return languageOrder || countryOrder || aNumber - bNumber;
  }),
);

const channelCards = computed(() =>
  prioritizedChannels.value.map((item) => {
    const itemNetwork = content.network(item.networkSlug)!;
    const itemSchedule = content.scheduleForChannel(item.id);
    const lineUp = itemSchedule ? nowAndNext(itemSchedule, nowMs.value, 2) : [];
    return {
      channel: item,
      network: itemNetwork,
      current: lineUp[0] ?? null,
      next: lineUp[1] ?? null,
      accent: ui.netColour(itemNetwork),
      // Nothing on air has two different causes, and the card says which:
      // an archive still filling up, or a channel that carried no children's
      // programming at all.
      titleCount: content.seriesForNetwork(item.networkSlug).length,
    };
  }),
);
const dutchChannelCards = computed(() => channelCards.value.filter((item) => item.channel.language === 'nl'));
const otherChannelCards = computed(() => channelCards.value.filter((item) => item.channel.language !== 'nl'));

/** A deep link may name any channel, including an archived week the map does
 * not show — that link is a deliberate act, unlike the default landing. */
const linkedChannelId = (queryChannel: unknown): string | null =>
  typeof queryChannel === 'string' && content.channels.some((item) => item.id === queryChannel)
    ? queryChannel
    : null;

const initialChannelId =
  linkedChannelId(route.query.channel) ??
  prioritizedChannels.value.find((channel) => channel.scheduleId !== null)?.id ??
  null;

const selectedChannelId = ref<string | null>(initialChannelId);
const channel = computed(() => content.channel(selectedChannelId.value));
const schedule = computed(() => content.scheduleForChannel(selectedChannelId.value));
const network = computed(() => content.network(channel.value?.networkSlug));
const networkSeries = computed<SeriesStub[]>(() =>
  content.seriesForNetwork(network.value?.slug),
);
const todayKey = computed(() =>
  channel.value ? channelDateKey(nowMs.value, channel.value.timezone) : '',
);
const guideDate = ref(todayKey.value);

const guide = computed(() =>
  channel.value && schedule.value && guideDate.value
    ? broadcastsForChannelDay(schedule.value, guideDate.value, channel.value.timezone)
    : [],
);
const liveItems = computed(() => (schedule.value ? nowAndNext(schedule.value, nowMs.value, 2) : []));
const nowPlaying = computed(() => liveItems.value[0] ?? null);
const nextPlaying = computed(() => liveItems.value[1] ?? null);
const accent = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));
const dateLabel = computed(() =>
  channel.value && guideDate.value
    ? formatGuideDate(guideDate.value, channel.value.timezone)
    : '',
);

let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1_000);
});
onBeforeUnmount(() => clearInterval(clockTimer));

watch(
  () => route.query.channel,
  (queryChannel) => {
    const linked = linkedChannelId(queryChannel);
    if (linked) selectedChannelId.value = linked;
  },
);

watch(channel, (next, previous) => {
  if (next && next.id !== previous?.id) guideDate.value = channelDateKey(Date.now(), next.timezone);
});

/** Selecting a channel with no schedule is meaningful: the guide stays empty,
 * but the broadcaster's title list below it does not. */
function selectChannel(target: BroadcastChannel): void {
  selectedChannelId.value = target.id;
  ui.selectChannel(target.networkSlug, target.id);
  void router.replace({ query: { ...route.query, channel: target.id } });
}

function shiftDay(days: number): void {
  if (guideDate.value) guideDate.value = shiftDateKey(guideDate.value, days);
}

function goToday(): void {
  guideDate.value = todayKey.value;
}

function goLive(): void {
  if (channel.value) void router.push(`/kijken/${channel.value.id}`);
}

function goSeries(slug: string | undefined): void {
  if (slug) {
    void router.push({
      path: `/programma/${slug}`,
      query: channel.value ? { zender: channel.value.networkSlug } : {},
    });
  }
}

function goNetwork(): void {
  if (network.value) void router.push(`/zender/${network.value.slug}`);
}

const seriesYearsLabel = (item: SeriesStub): string =>
  yearRangeLabel(item.firstAirYear, item.lastAirYear);
const epLabel = (item: SeriesStub): string => episodeCountLabel(item.episodeCount);

function cardTime(iso: string, target: BroadcastChannel): string {
  return formatChannelTime(iso, target.timezone);
}

function time(iso: string): string {
  return channel.value ? formatChannelTime(iso, channel.value.timezone) : '';
}

function isCurrent(startsAt: string, endsAt: string): boolean {
  return new Date(startsAt).getTime() <= nowMs.value && new Date(endsAt).getTime() > nowMs.value;
}
</script>

<template>
  <div class="guide">
    <header class="guide-head" :style="{ borderColor: C.border2 }">
      <div>
        <span class="kicker" :style="{ color: accent }">NEDERLANDSE ZENDERKAART · SEPTEMBER 2005</span>
        <h1 :style="{ color: C.ink }">ZENDERS &amp; PROGRAMMERING</h1>
        <p :style="{ color: C.dim2 }">Kies een zender, zie wat er nu speelt en blader door de volledige dag.</p>
      </div>
      <button v-if="channel?.scheduleId" class="live-button" :style="{ background: accent, color: C.chipFg }" @click="goLive">
        KIJK LIVE →
      </button>
    </header>

    <!-- Only reachable by deep link: an archived week is not one of the ten
         channels, so the guide says which week it is showing. -->
    <p v-if="channel?.historicalWeek" class="week-note" :style="{ borderColor: accent, color: C.dim2 }">
      <strong :style="{ color: C.ink }">Bewaarde uitzendweek</strong>
      {{ weekRangeLabel(channel.historicalWeek.requestedFrom, channel.historicalWeek.requestedTo) }} ·
      {{ guideCoverageLabel(channel.historicalWeek.coverage) }} ·
      <button type="button" :style="{ color: accent }" @click="goNetwork">terug naar {{ network?.name }}</button>
    </p>

    <section class="stations" aria-labelledby="nl-zenders">
      <div class="section-head">
        <h2 id="nl-zenders" :style="{ color: C.ink }">Nederlandse zenders 1–10</h2>
        <span :style="{ color: C.dim }">TV HOME · SEPT. 2005</span>
      </div>
      <div class="station-grid">
        <button
          v-for="item in dutchChannelCards"
          :key="item.channel.id"
          class="station-card"
          :class="{ active: item.channel.id === selectedChannelId, pending: !item.current }"
          :style="{
            borderColor: item.channel.id === selectedChannelId ? item.accent : C.border2,
            background: item.channel.id === selectedChannelId ? C.focusBg : C.bg2,
            color: C.ink,
          }"
          @click="selectChannel(item.channel)"
        >
          <span class="station-top">
            <img :src="item.network.logo" alt="" :style="{ filter: ui.theme === 'dark' ? 'invert(1)' : 'none' }" />
            <span>
              <strong>{{ item.channel.name }}</strong>
              <small :style="{ color: C.dim }">{{ countryLabel(item.channel.country) }} · {{ languageLabel(item.channel.language) }}</small>
            </span>
            <b :style="{ color: item.accent }">{{ pad2(item.network.channelNumber) }}</b>
          </span>
          <template v-if="item.current && item.next">
            <span class="station-now">
              <time :style="{ color: item.accent }">{{ cardTime(item.current.startsAt, item.channel) }}</time>
              <strong>{{ item.current.show?.title ?? broadcastTypeLabel(item.current.type) }}</strong>
            </span>
            <span class="station-next" :style="{ color: C.dim }">
              STRAKS {{ cardTime(item.next.startsAt, item.channel) }} · {{ item.next.show?.title ?? broadcastTypeLabel(item.next.type) }}
            </span>
          </template>
          <span v-else class="station-pending" :style="{ color: C.dim }">
            {{ item.titleCount ? 'PROGRAMMERING VOLGT' : 'GEEN JEUGDPROGRAMMERING' }}
          </span>
        </button>
      </div>
    </section>

    <details v-if="otherChannelCards.length" class="other-stations" :style="{ borderColor: C.border }">
      <summary :style="{ color: C.dim2 }">Andere zenders ({{ otherChannelCards.length }})</summary>
      <div class="channel-picker" aria-label="Andere zenders">
        <button
          v-for="item in otherChannelCards"
          :key="item.channel.id"
          :style="{
            borderColor: item.channel.id === selectedChannelId ? item.accent : C.border2,
            background: item.channel.id === selectedChannelId ? C.focusBg : 'transparent',
            color: C.ink,
          }"
          @click="selectChannel(item.channel)"
        >
          <span :style="{ color: item.accent }">{{ pad2(item.network.channelNumber) }}</span>
          <strong>{{ item.channel.name }}</strong>
          <small :style="{ color: C.dim }">{{ languageLabel(item.channel.language) }}</small>
        </button>
      </div>
    </details>

    <section v-if="channel && schedule && nowPlaying && nextPlaying" class="on-air" :style="{ borderColor: accent, background: C.bg2 }">
      <div class="on-air-label" :style="{ color: accent }">● NU OP {{ channel.name.toUpperCase() }}</div>
      <div class="on-air-main">
        <div>
          <h2 :style="{ color: C.ink }">{{ nowPlaying.show?.title }}</h2>
          <p :style="{ color: C.dim2 }">{{ nowPlaying.episode?.title }}</p>
        </div>
        <div class="on-air-times" :style="{ color: C.dim }">
          {{ time(nowPlaying.startsAt) }}–{{ time(nowPlaying.endsAt) }}
        </div>
      </div>
      <div class="progress" :style="{ background: C.border2 }">
        <i :style="{ width: `${broadcastProgress(nowPlaying, nowMs) * 100}%`, background: accent }"></i>
      </div>
      <div class="up-next" :style="{ color: C.dim }">
        STRAKS {{ time(nextPlaying.startsAt) }} · <strong :style="{ color: C.ink }">{{ nextPlaying.show?.title }}</strong>
        <span>— {{ nextPlaying.episode?.title }}</span>
      </div>
    </section>

    <section v-if="schedule" class="date-nav" :style="{ borderColor: C.border }">
      <button :style="{ color: C.dim2, borderColor: C.border2 }" aria-label="Vorige dag" @click="shiftDay(-1)">←</button>
      <div>
        <strong :style="{ color: C.ink }">{{ dateLabel }}</strong>
        <span v-if="channel" :style="{ color: C.dim }">{{ channel.timezone }}</span>
      </div>
      <input v-model="guideDate" type="date" :style="{ color: C.dim2, borderColor: C.border2, background: C.bg2 }" />
      <button v-if="guideDate !== todayKey" :style="{ color: C.dim2, borderColor: C.border2 }" @click="goToday">VANDAAG</button>
      <button :style="{ color: C.dim2, borderColor: C.border2 }" aria-label="Volgende dag" @click="shiftDay(1)">→</button>
    </section>

    <section v-if="guide.length" class="epg" :style="{ borderColor: C.border }">
      <article
        v-for="item in guide"
        :key="`${item.id}-${item.startsAt}`"
        class="epg-row"
        :class="{ current: isCurrent(item.startsAt, item.endsAt) }"
        :style="{
          borderColor: C.border,
          background: isCurrent(item.startsAt, item.endsAt) ? C.focusBg : 'transparent',
          borderLeftColor: isCurrent(item.startsAt, item.endsAt) ? accent : 'transparent',
        }"
        @click="goSeries(item.show?.slug)"
      >
        <time :style="{ color: isCurrent(item.startsAt, item.endsAt) ? accent : C.dim }">{{ time(item.startsAt) }}</time>
        <div class="epg-copy">
          <strong :style="{ color: C.ink }">{{ item.show?.title ?? broadcastTypeLabel(item.type) }}</strong>
          <span :style="{ color: C.dim }">
            {{ item.episode?.title }}
            <template v-if="item.episode"> · S{{ pad2(item.episode.season) }}E{{ pad2(item.episode.episode) }}</template>
          </span>
        </div>
        <span class="type" :style="{ color: C.dim, borderColor: C.border2 }">{{ broadcastTypeLabel(item.type) }}</span>
        <span v-if="isCurrent(item.startsAt, item.endsAt)" class="now" :style="{ color: accent }">NU</span>
      </article>
    </section>

    <div v-else-if="schedule" class="empty" :style="{ color: C.dim }">
      Voor deze dag staat nog geen programmering klaar.
    </div>

    <div v-else class="empty" :style="{ color: C.dim }">
      Deze zender is in dit archief niet in de lucht.
    </div>

    <section v-if="network" class="line-up" aria-labelledby="zender-series">
      <div class="section-head" :style="{ borderColor: C.border }">
        <h2 id="zender-series" :style="{ color: C.ink }">Series op {{ network.name }}</h2>
        <span :style="{ color: C.dim }">{{ networkSeries.length }} TITELS</span>
      </div>

      <div v-if="networkSeries.length" class="series-grid">
        <button
          v-for="item in networkSeries"
          :key="item.slug"
          class="series-row"
          :style="{ borderColor: C.border, color: C.ink }"
          @click="goSeries(item.slug)"
        >
          <SeriesStatusDot :status="seriesArchiveStatus(item)" :label="seriesArchiveStatusLabel(item)" />
          <strong>{{ item.name }}</strong>
          <small :style="{ color: C.dim }">{{ seriesYearsLabel(item) }} · {{ epLabel(item) }}</small>
        </button>
      </div>

      <p v-else class="empty" :style="{ color: C.dim }">
        Deze zender had geen jeugdprogrammering in het archief.
      </p>

      <button v-if="networkSeries.length" class="line-up-more" :style="{ borderColor: C.border2, color: C.dim2 }" @click="goNetwork">
        HELE ZENDERPAGINA →
      </button>
    </section>
  </div>
</template>

<style scoped>
.guide {
  width: min(1040px, calc(100% - 40px));
  margin: 0 auto;
  padding: 30px 0 72px;
}

.guide-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid;
}

.kicker,
.on-air-label {
  font: 11px 'IBM Plex Mono', monospace;
  letter-spacing: 0.1em;
}

.guide-head h1 {
  margin: 3px 0 0;
  font: 600 38px 'Oswald', sans-serif;
  letter-spacing: 0.02em;
}

.guide-head p {
  margin: 5px 0 0;
  font-size: 13px;
}

.live-button {
  border: 0;
  border-radius: 2px;
  padding: 10px 14px;
  font: 700 11px 'IBM Plex Mono', monospace;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.week-note {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: 14px 0 0;
  padding: 10px 12px;
  border-left: 3px solid;
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.05em;
}

.week-note strong {
  font: 14px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.week-note button {
  border: 0;
  padding: 0;
  background: none;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.stations {
  padding: 24px 0 20px;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.section-head h2 {
  margin: 0;
  font: 500 21px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.section-head span {
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.08em;
}

.station-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.station-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 11px;
  padding: 14px;
  border: 1px solid;
  border-left-width: 3px;
  text-align: left;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease;
}

.station-card:hover {
  transform: translateY(-1px);
}

.station-card.pending {
  opacity: 0.72;
}

.station-top {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.station-top img {
  width: 36px;
  height: 28px;
  object-fit: contain;
}

.station-top > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.station-top strong {
  overflow: hidden;
  font: 15px 'Oswald', sans-serif;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.station-top small,
.station-top b {
  font: 9px 'IBM Plex Mono', monospace;
}

.station-top b {
  font-size: 12px;
}

.station-now {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: baseline;
  gap: 8px;
}

.station-now time {
  font: 700 12px 'IBM Plex Mono', monospace;
}

.station-now strong {
  overflow: hidden;
  font: 600 18px 'Oswald', sans-serif;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.station-next {
  overflow: hidden;
  font: 9px 'IBM Plex Mono', monospace;
  letter-spacing: 0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.station-pending {
  padding: 12px 0 10px;
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.07em;
}

.other-stations {
  margin: 0 0 18px;
  border-top: 1px solid;
  border-bottom: 1px solid;
}

.other-stations summary {
  padding: 11px 0;
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.channel-picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 0 12px;
}

.channel-picker button {
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 9px 11px;
  border: 1px solid;
  background: none;
  cursor: pointer;
  font-family: 'IBM Plex Mono', monospace;
}

.channel-picker strong {
  font: 14px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.on-air {
  padding: 18px 20px;
  border: 1px solid;
  border-left-width: 4px;
}

.on-air-main {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-top: 8px;
}

.on-air h2 {
  margin: 0;
  font: 600 27px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.on-air p {
  margin: 2px 0 0;
  font-size: 13px;
}

.on-air-times,
.up-next {
  font: 11px 'IBM Plex Mono', monospace;
}

.progress {
  height: 3px;
  margin: 15px 0 10px;
}

.progress i {
  display: block;
  height: 100%;
}

.up-next span {
  margin-left: 4px;
}

.date-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 0 12px;
  border-bottom: 1px solid;
}

.date-nav > div {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.date-nav strong {
  font: 18px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.date-nav span {
  font: 10px 'IBM Plex Mono', monospace;
}

.date-nav button,
.date-nav input {
  min-height: 32px;
  border: 1px solid;
  background: transparent;
  padding: 6px 10px;
  font: 10px 'IBM Plex Mono', monospace;
  cursor: pointer;
}

.epg {
  border-bottom: 1px solid;
}

.epg-row {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto 42px;
  align-items: center;
  min-height: 60px;
  padding: 9px 12px 9px 10px;
  border-top: 1px solid;
  border-left: 3px solid transparent;
  cursor: pointer;
}

.epg-row time {
  font: 700 13px 'IBM Plex Mono', monospace;
}

.epg-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.epg-copy strong {
  font: 17px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.epg-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.type {
  padding: 3px 6px;
  border: 1px solid;
  font: 9px 'IBM Plex Mono', monospace;
  text-transform: uppercase;
}

.now {
  justify-self: end;
  font: 700 10px 'IBM Plex Mono', monospace;
}

.empty {
  padding: 50px 0;
  text-align: center;
  font: 12px 'IBM Plex Mono', monospace;
}

.line-up {
  padding-top: 30px;
}

.line-up .section-head {
  padding-bottom: 10px;
  border-bottom: 1px solid;
}

.series-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 0 18px;
}

.series-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 11px 2px;
  border: 0;
  border-bottom: 1px solid;
  background: none;
  text-align: left;
  cursor: pointer;
}

.series-row strong {
  overflow: hidden;
  font: 16px 'Oswald', sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-row small {
  font: 9px 'IBM Plex Mono', monospace;
  white-space: nowrap;
}

.line-up-more {
  margin-top: 18px;
  border: 1px solid;
  background: transparent;
  padding: 9px 12px;
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.06em;
  cursor: pointer;
}

@media (max-width: 640px) {
  .guide {
    width: min(100% - 28px, 1040px);
    padding-top: 20px;
  }

  .guide-head h1 {
    font-size: 31px;
  }

  .guide-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .guide-head p {
    max-width: 30rem;
  }

  .station-grid {
    grid-template-columns: 1fr;
  }

  .on-air-main,
  .date-nav {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .on-air-times {
    width: 100%;
  }

  .date-nav > div {
    min-width: calc(100% - 88px);
  }

  .epg-row {
    grid-template-columns: 52px minmax(0, 1fr) 36px;
    padding-left: 7px;
  }

  .type {
    display: none;
  }

  .up-next span {
    display: none;
  }
}
</style>
