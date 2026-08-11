<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import CoverImage from '../components/CoverImage.vue';
import SeriesStatusDot from '../components/SeriesStatusDot.vue';
import { episodeCountLabel, formatAirDate, pad2, yearRangeLabel } from '../data/helpers';
import {
  seriesArchiveStatus,
  seriesArchiveStatusLabel,
  type SeriesArchiveStatus,
} from '../data/series-status';
import { AVAILABILITY_LABELS, COPY } from '../data/themes';
import { formatChannelTime, nextAiring } from '../broadcast/engine';
import type { Broadcast, BroadcastChannel, PublicEpisode } from '../types';

const props = defineProps<{ slug: string }>();

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);

// The route's beforeEnter has already awaited this file, so it is present.
const series = computed(() => content.series(props.slug));
const network = computed(() => {
  if (!series.value) return null;
  const requested = typeof route.query.zender === 'string' ? route.query.zender : null;
  const requestedNetwork = requested && series.value.networkSlugs.includes(requested)
    ? content.network(requested)
    : null;
  if (requestedNetwork?.listed) return requestedNetwork;
  const listedSlug = series.value.networkSlugs.find((slug) => content.network(slug)?.listed);
  return content.network(listedSlug ?? series.value.networkSlug);
});
const colour = computed(() => (network.value ? ui.netColour(network.value) : C.value.dim));
const seasons = computed(() => series.value?.seasons ?? []);

const activeSeasonIdx = ref(0);
watch(
  () => props.slug,
  () => {
    activeSeasonIdx.value = 0;
  },
);

const yearsLabel = computed(() =>
  series.value ? yearRangeLabel(series.value.firstAirYear, series.value.lastAirYear) : '',
);
const epLabel = computed(() => (series.value ? episodeCountLabel(series.value.episodeCount) : ''));
const archiveStatus = computed<SeriesArchiveStatus>(() =>
  series.value ? seriesArchiveStatus(series.value) : 'empty',
);
const archiveStatusLabel = computed(() =>
  series.value ? seriesArchiveStatusLabel(series.value) : '',
);
const needsDutchSource = computed(() => archiveStatus.value !== 'complete');

const youtubePlaylistSearch = computed(() => {
  const query = `${series.value?.name ?? ''} NEDERLANDS playlist`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
});
const youtubeEpisodeSearch = computed(() => {
  const query = `${series.value?.name ?? ''} NEDERLANDS volledige afleveringen`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
});

const sourceSearchMessage = computed(() => {
  if (!series.value) return '';
  switch (archiveStatus.value) {
    case 'empty':
      return 'Er is nog geen afspeelbare aflevering gevonden. Zoek op YouTube naar een Nederlandse playlist of losse afleveringen.';
    case 'non-dutch':
      return 'De huidige bron is niet Nederlandstalig. Help een Nederlandse dub of playlist terug te vinden.';
    case 'incomplete':
      return `Er zijn ${series.value.availableCount} van de ${series.value.episodeCount} afleveringen gevonden. Zoek naar de ontbrekende Nederlandse afleveringen.`;
    case 'complete':
      return '';
  }
});

const episodes = computed<PublicEpisode[]>(() => seasons.value[activeSeasonIdx.value]?.episodes ?? []);

const nextBroadcast = computed<{ broadcast: Broadcast; channel: BroadcastChannel } | null>(() => {
  if (!series.value) return null;
  const candidates = content.liveChannels.flatMap((channel) => {
    if (!series.value?.networkSlugs.includes(channel.networkSlug)) return [];
    const schedule = content.scheduleForChannel(channel.id);
    const broadcast = schedule ? nextAiring(schedule, props.slug, Date.now()) : null;
    return broadcast ? [{ broadcast, channel }] : [];
  });
  return candidates.sort(
    (a, b) => new Date(a.broadcast.startsAt).getTime() - new Date(b.broadcast.startsAt).getTime(),
  )[0] ?? null;
});

const nextBroadcastLabel = computed(() => {
  const item = nextBroadcast.value;
  if (!item) return 'Geen komende uitzending gepland';
  const startsAt = new Date(item.broadcast.startsAt);
  if (startsAt.getTime() <= Date.now() && new Date(item.broadcast.endsAt).getTime() > Date.now()) {
    return `Nu op tv · tot ${formatChannelTime(item.broadcast.endsAt, item.channel.timezone)}`;
  }
  const date = new Intl.DateTimeFormat('nl-NL', {
    timeZone: item.channel.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(startsAt);
  return `Volgende uitzending ${date} · ${formatChannelTime(startsAt, item.channel.timezone)}`;
});

/** Availability is on the row before the click, never discovered after one. */
function tagFor(episode: PublicEpisode): { label: string; colour: string } {
  return {
    label: AVAILABILITY_LABELS[episode.status],
    colour: episode.status === 'missing' ? C.value.missing : C.value.dim,
  };
}

const isPlayable = (episode: PublicEpisode): boolean => episode.status !== 'missing';

const reportKey = (episode: PublicEpisode): string =>
  `${props.slug}-${episode.season}-${episode.episode}`;

function goEpisode(episode: PublicEpisode): void {
  if (!isPlayable(episode)) return;
  ui.triggerFlicker();
  void router.push({
    path: `/programma/${props.slug}/${episode.season}/${episode.episode}`,
    query: route.query,
  });
}

function watchOnChannel(): void {
  const target = nextBroadcast.value?.channel;
  if (target) void router.push(`/kijken/${target.id}`);
}

function report(e: Event, episode: PublicEpisode): void {
  e.preventDefault();
  ui.reportMissing(reportKey(episode));
}
</script>

<template>
  <div v-if="series" class="series">
    <div class="hero">
      <CoverImage
        :title="series.name"
        :file-path="series.backdrop"
        size="w1280"
        :accent-color="colour"
        class="hero-img"
      />
      <div
        class="hero-fade"
        :style="{
          background: `linear-gradient(180deg, rgba(11,15,22,.1) 0%, rgba(11,15,22,.6) 60%, ${C.heroFade} 100%)`,
        }"
      ></div>
      <div class="hero-text">
        <div class="mono" :style="{ color: colour }">
          {{ network ? pad2(network.channelNumber) : '' }} {{ network?.name }}
        </div>
        <h1>{{ series.name }}</h1>
        <div class="mono hero-meta">
          <span>{{ yearsLabel }} · {{ epLabel }}</span>
          <span class="hero-status">
            <SeriesStatusDot :status="archiveStatus" :label="archiveStatusLabel" />
            {{ archiveStatusLabel }}
          </span>
        </div>
      </div>
    </div>

    <div class="synopsis" :style="{ color: C.dim2 }">{{ series.overview }}</div>

    <section
      v-if="needsDutchSource"
      class="source-search"
      :style="{ borderColor: C.border, background: C.bg2 }"
    >
      <div class="source-search-copy">
        <span class="mono source-search-label" :style="{ color: C.dim }">NEDERLANDSE BRON GEZOCHT</span>
        <strong :style="{ color: C.ink }">{{ archiveStatusLabel }}</strong>
        <p :style="{ color: C.dim2 }">{{ sourceSearchMessage }}</p>
      </div>
      <div class="source-search-actions">
        <a
          :href="youtubePlaylistSearch"
          target="_blank"
          rel="noopener noreferrer"
          :style="{ background: colour, color: C.chipFg }"
        >
          ZOEK PLAYLIST OP YOUTUBE ↗
        </a>
        <a
          :href="youtubeEpisodeSearch"
          target="_blank"
          rel="noopener noreferrer"
          :style="{ borderColor: C.border2, color: C.dim2 }"
        >
          ZOEK LOSSE AFLEVERINGEN ↗
        </a>
      </div>
    </section>

    <div v-if="network" class="broadcast-cta" :style="{ borderColor: C.border, background: C.bg2 }">
      <div>
        <span class="mono" :style="{ color: colour }">{{ nextBroadcast?.channel.name ?? network.name }}</span>
        <strong :style="{ color: C.ink }">{{ nextBroadcastLabel }}</strong>
        <small v-if="nextBroadcast" :style="{ color: C.dim }">{{ nextBroadcast.broadcast.episode?.title }}</small>
      </div>
      <button
        :disabled="!nextBroadcast"
        :style="{ background: nextBroadcast ? colour : C.border2, color: C.chipFg }"
        @click="watchOnChannel"
      >
        KIJK OP {{ network.name.toUpperCase() }} →
      </button>
    </div>

    <div v-if="seasons.length > 1" class="season-tabs">
      <button
        v-for="(sea, idx) in seasons"
        :key="sea.season"
        class="chip"
        :style="{
          background: idx === activeSeasonIdx ? C.ink : 'transparent',
          color: idx === activeSeasonIdx ? C.chipFg : C.dim,
          borderColor: C.border2,
        }"
        @click="activeSeasonIdx = idx"
      >
        {{ sea.name }}
      </button>
    </div>

    <div class="episodes">
      <div v-for="ep in episodes" :key="`${ep.season}-${ep.episode}`" class="ep-block">
        <div class="ep-row" :style="{ borderColor: C.border, opacity: isPlayable(ep) ? 1 : 0.55 }">
          <span class="mono ep-num" :style="{ color: C.dim }">{{ ep.episode }}</span>
          <span
            class="ep-title"
            :style="{ color: C.ink, cursor: isPlayable(ep) ? 'pointer' : 'default' }"
            @click="goEpisode(ep)"
            >{{ ep.title }}</span
          >
          <span class="mono ep-meta" :style="{ color: C.dim }">
            {{ ep.runtime ? `${ep.runtime} min · ` : '' }}{{ formatAirDate(ep.airDate) }}
          </span>
          <span class="mono ep-tag" :style="{ color: tagFor(ep).colour }">{{ tagFor(ep).label }}</span>
        </div>
        <!-- The gap is information: a missing episode keeps its row, title and
             air date, and says plainly that no upload was found. -->
        <div v-if="!isPlayable(ep)" class="ep-report" :style="{ color: C.dim }">
          {{ COPY.missingNote }}
          <a href="#" @click="report($event, ep)">
            {{ ui.reportedKeys.has(reportKey(ep)) ? COPY.reportedThanks : COPY.reportLink }}
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  width: 100%;
  height: 320px;
  overflow: hidden;
}

.hero-img {
  width: 100%;
  height: 100%;
}

.hero-fade {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hero-text {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.hero-text .mono {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
}

.hero-text h1 {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 44px;
  line-height: 1.02;
  text-transform: uppercase;
  color: #f3ecdd;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.hero-meta {
  color: #d8dce4;
  font-size: 13px;
}

.hero-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}

.synopsis {
  max-width: 760px;
  padding: 20px 24px 8px;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.5;
}

.source-search {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  max-width: 860px;
  margin: 14px 24px 2px;
  padding: 14px 16px;
  border: 1px solid;
}

.source-search-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-search-label {
  font-size: 10px;
  letter-spacing: 0.08em;
}

.source-search strong {
  font: 17px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.source-search p {
  max-width: 560px;
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.45;
}

.source-search-actions {
  display: flex;
  flex: none;
  gap: 8px;
}

.source-search-actions a {
  padding: 9px 12px;
  border: 1px solid transparent;
  font: 700 10px 'IBM Plex Mono', monospace;
  white-space: nowrap;
}

.source-search-actions a:last-child {
  background: transparent;
}

.broadcast-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  max-width: 860px;
  margin: 14px 24px 2px;
  padding: 14px 16px;
  border: 1px solid;
}

.broadcast-cta > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.broadcast-cta .mono {
  font: 10px 'IBM Plex Mono', monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.broadcast-cta strong {
  font: 17px 'Oswald', sans-serif;
  text-transform: uppercase;
}

.broadcast-cta small {
  font-size: 11px;
}

.broadcast-cta button {
  flex: none;
  border: 0;
  padding: 9px 12px;
  font: 700 10px 'IBM Plex Mono', monospace;
  cursor: pointer;
}

.broadcast-cta button:disabled {
  cursor: default;
  opacity: 0.6;
}

.season-tabs {
  display: flex;
  gap: 6px;
  padding: 16px 24px 0;
}

.chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.05em;
  padding: 6px 12px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease;
}

.episodes {
  padding: 20px 24px 40px;
  max-width: 900px;
}

.ep-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 12px 8px;
  border-bottom: 1px solid;
  transition: background 120ms ease;
}

.mono {
  font-family: 'IBM Plex Mono', monospace;
}

.ep-num {
  font-size: 13px;
  width: 22px;
  flex: none;
}

.ep-title {
  font-family: 'Oswald', sans-serif;
  font-size: 17px;
  flex: 1;
}

.ep-meta {
  font-size: 12px;
  white-space: nowrap;
}

.ep-tag {
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  width: 130px;
  text-align: right;
}

.ep-report {
  padding: 0 8px 12px 36px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
}

/* Mobile. The row's four columns do not fit a phone, so it wraps to two lines:
   number and title, then air date and availability indented under the title.
   32px is the number's 22px plus the 10px column gap. */
@media (max-width: 759px) {
  .hero {
    height: 200px;
  }

  .hero-text {
    padding: 0 14px 14px;
  }

  .hero-text h1 {
    font-size: 28px;
  }

  .synopsis {
    padding: 16px 14px 4px;
  }

  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .hero-status {
    margin-left: 0;
  }

  .source-search {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
    margin: 12px 14px 0;
  }

  .source-search-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .broadcast-cta {
    align-items: stretch;
    flex-direction: column;
    margin: 12px 14px 0;
  }

  .broadcast-cta button {
    align-self: flex-start;
  }

  .season-tabs {
    padding: 14px 14px 0;
    flex-wrap: wrap;
    row-gap: 6px;
  }

  .episodes {
    padding: 14px 14px 32px;
  }

  .ep-row {
    flex-wrap: wrap;
    column-gap: 10px;
    row-gap: 4px;
    padding: 12px 4px;
  }

  .ep-title {
    flex: 1 1 calc(100% - 32px);
    font-size: 16px;
  }

  .ep-meta {
    flex: 1 1 auto;
    margin-left: 32px;
    white-space: normal;
  }

  /* The 130px reservation only earns its keep when the tags column-align. */
  .ep-tag {
    width: auto;
    flex: none;
    text-align: right;
  }

  .ep-report {
    padding-left: 32px;
  }
}
</style>
