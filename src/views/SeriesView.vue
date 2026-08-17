<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useContentStore } from '../stores/content';
import CoverImage from '../components/CoverImage.vue';
import SeriesStatusDot from '../components/SeriesStatusDot.vue';
import {
  episodeCountLabel,
  formatAirDate,
  imdbEpisodeUrl,
  imdbSeriesUrl,
  pad2,
  tmdbSeriesUrl,
  yearRangeLabel,
} from '../data/helpers';
import {
  seriesArchiveStatus,
  seriesArchiveStatusLabel,
  type SeriesArchiveStatus,
} from '../data/series-status';
import { AVAILABILITY_LABELS, COPY } from '../data/themes';
import { AGE_COPY, isBlockedByAge } from '../data/age';
import { formatChannelTime, nextAiring } from '../broadcast/engine';
import type { Broadcast, BroadcastChannel, PublicEpisode } from '../types';

const props = defineProps<{ slug: string }>();

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const content = useContentStore();
const C = computed(() => ui.C);
const nowMs = ref(Date.now());

let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => clearInterval(clockTimer));

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

/**
 * Where this show can be read about elsewhere.
 *
 * Null for a series nobody has matched upstream, which is most of the
 * catalogue: a title lifted from a Dutch TV guide often has no TMDB entry at
 * all. The links are simply absent then rather than pointing at a search.
 */
const tmdbUrl = computed(() => tmdbSeriesUrl(series.value?.tmdbRealId ?? null));
const imdbUrl = computed(() => imdbSeriesUrl(series.value?.imdbId ?? null));

/** The episode's own IMDb page when known, otherwise the show's episode list
 * opened at that season — see `imdbEpisodeUrl`. */
const episodeImdbUrl = (episode: PublicEpisode): string | null =>
  imdbEpisodeUrl(episode.imdbId, series.value?.imdbId ?? null, episode.season);

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
    case 'dubbed':
      // Watchable in Dutch, but only after the viewer opens the player's own
      // audio menu — so the call for a Dutch upload stays open, in softer
      // words than the one above it.
      return 'De bron is Engelstalig en draagt een Nederlands audiospoor; kies dat in de speler onder het tandwiel. Een Nederlandse upload blijft welkom.';
    case 'incomplete':
      return `Er zijn ${series.value.availableCount} van de ${series.value.episodeCount} afleveringen gevonden. Zoek naar de ontbrekende Nederlandse afleveringen.`;
    case 'complete':
      return '';
  }
});

/**
 * Whether to draw a season heading at all.
 *
 * A single-season show has nothing to divide, and a lone "Seizoen 1" above one
 * list is a label rather than a signpost.
 */
const showSeasonHeadings = computed(() => seasons.value.length > 1);

const nextBroadcast = computed<{ broadcast: Broadcast; channel: BroadcastChannel } | null>(() => {
  if (!series.value) return null;
  const candidates = content.liveChannels.flatMap((channel) => {
    if (!series.value?.networkSlugs.includes(channel.networkSlug)) return [];
    const schedule = content.scheduleForChannel(channel.id);
    const broadcast = schedule ? nextAiring(schedule, props.slug, nowMs.value) : null;
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
  if (
    startsAt.getTime() <= nowMs.value &&
    new Date(item.broadcast.endsAt).getTime() > nowMs.value
  ) {
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

/** Reachable by typing the URL, or by following a link made before the ceiling
 * was lowered. The page still renders — the archive should not pretend the
 * series does not exist — but nothing on it plays. */
const isLocked = computed(() => isBlockedByAge(series.value?.age, ui.ageFilter));

/** Availability only. The lock is a separate question, asked at the click:
 * folding it in here would make every row of a locked series claim its video
 * was never found, which is a different and untrue thing to say. */
const isPlayable = (episode: PublicEpisode): boolean => episode.status !== 'missing';

const isOpenable = (episode: PublicEpisode): boolean => isPlayable(episode) && !isLocked.value;

function goEpisode(episode: PublicEpisode): void {
  if (!isOpenable(episode)) return;
  ui.triggerFlicker();
  void router.push({
    path: `/programma/${props.slug}/${episode.season}/${episode.episode}`,
    query: route.query,
  });
}

function watchOnChannel(): void {
  if (isLocked.value) return;
  const target = nextBroadcast.value?.channel;
  if (target) void router.push(`/kijken/${target.id}`);
}

function reportUrl(episode: PublicEpisode): string {
  const title = `Werkende videolink: ${series.value?.name ?? props.slug} S${pad2(episode.season)}E${pad2(episode.episode)}`;
  const body = [
    `Programma: ${series.value?.name ?? props.slug}`,
    `Aflevering: S${pad2(episode.season)}E${pad2(episode.episode)} — ${episode.title}`,
    '',
    'Werkende YouTube-link:',
  ].join('\n');
  return `https://github.com/dotnetrule/Oldcartoons.watch/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
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
        loading="eager"
        fetch-priority="high"
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
          <span v-if="series.genres.length" class="hero-genres">
            {{ series.genres.join(' · ') }}
          </span>
          <span class="hero-status">
            <SeriesStatusDot :status="archiveStatus" :label="archiveStatusLabel" />
            {{ archiveStatusLabel }}
          </span>
          <!-- Absent rather than guessed for a series nobody has matched
               upstream, which is most of the catalogue. -->
          <span v-if="tmdbUrl || imdbUrl" class="hero-links">
            <a
              v-if="tmdbUrl"
              :href="tmdbUrl"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`${series.name} op TMDB`"
            >TMDB ↗</a>
            <a
              v-if="imdbUrl"
              :href="imdbUrl"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`${series.name} op IMDb`"
            >IMDb ↗</a>
          </span>
        </div>
      </div>
    </div>

    <div class="synopsis" :style="{ color: C.dim2 }">{{ series.overview }}</div>

    <!-- Reached by URL or by a link made before the ceiling was lowered. The
         page keeps its name, years and episode list — the archive says what it
         holds — and says in one line why none of it opens. -->
    <div
      v-if="isLocked"
      class="age-lock"
      :style="{ borderColor: C.border2, background: C.bg2, color: C.dim2 }"
    >
      <strong :style="{ color: C.ink }">{{ AGE_COPY.locked }}</strong>
      <span>{{ AGE_COPY.seriesNotice }}</span>
    </div>

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
        :disabled="!nextBroadcast || isLocked"
        :style="{ background: nextBroadcast && !isLocked ? colour : C.border2, color: C.chipFg }"
        @click="watchOnChannel"
      >
        KIJK OP {{ network.name.toUpperCase() }} →
      </button>
    </div>

    <!-- One list, however many seasons. A season is a heading you scroll past,
         not a tab you switch between: the archive's whole point is showing what
         a show was, and a tab strip hides most of it behind a click and makes
         the gaps in season four invisible from season one. -->
    <div class="episodes">
      <template v-for="sea in seasons" :key="sea.season">
        <h2
          v-if="showSeasonHeadings"
          class="mono season-heading"
          :style="{ color: C.dim, background: C.bg, borderColor: C.border2 }"
        >
          {{ sea.name }}
          <span class="season-count">{{ sea.episodes.length }} afl.</span>
        </h2>
        <div v-for="ep in sea.episodes" :key="`${ep.season}-${ep.episode}`" class="ep-block">
          <div class="ep-row" :style="{ borderColor: C.border, opacity: isOpenable(ep) ? 1 : 0.55 }">
            <span class="mono ep-num" :style="{ color: C.dim }">{{ ep.episode }}</span>
            <button
              type="button"
              class="ep-title"
              :disabled="!isOpenable(ep)"
              :style="{ color: C.ink, cursor: isOpenable(ep) ? 'pointer' : 'default' }"
              @click="goEpisode(ep)"
            >{{ ep.title }}</button>
            <span class="mono ep-meta" :style="{ color: C.dim }">
              {{ ep.runtime ? `${ep.runtime} min · ` : '' }}{{ formatAirDate(ep.airDate) }}
            </span>
            <!-- More than one upload is worth advertising on the row, but the
                 choosing happens in the player where the video is. -->
            <span
              v-if="ep.sources.length > 1"
              class="mono ep-sources"
              :style="{ color: C.dim, borderColor: C.border2 }"
              :title="`${ep.sources.length} bronnen — kies er een in de speler`"
            >{{ ep.sources.length }} BRONNEN</span>
            <a
              v-if="episodeImdbUrl(ep)"
              class="mono ep-imdb"
              :href="episodeImdbUrl(ep)!"
              target="_blank"
              rel="noopener noreferrer"
              :style="{ color: C.dim }"
              :aria-label="`Bekijk S${pad2(ep.season)}E${pad2(ep.episode)} — ${ep.title} op IMDb`"
              @click.stop
            >IMDb ↗</a>
            <span
              class="mono ep-tag"
              :style="{ color: isLocked ? C.dim : tagFor(ep).colour }"
            >{{ isLocked ? AGE_COPY.locked : tagFor(ep).label }}</span>
          </div>
          <!-- The gap is information: a missing episode keeps its row, title and
               air date, and says plainly that no upload was found. -->
          <div v-if="!isPlayable(ep)" class="ep-report" :style="{ color: C.dim }">
            {{ COPY.missingNote }}
            <a :href="reportUrl(ep)" target="_blank" rel="noopener noreferrer">
              Werkende link melden ↗
            </a>
          </div>
        </div>
      </template>
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

.hero-genres {
  margin-left: 8px;
}

.hero-links {
  display: inline-flex;
  gap: 10px;
  margin-left: 8px;
  /* The rest of .hero-text is click-through so the backdrop reads as one
     image; these are the only things on it anybody can follow. */
  pointer-events: auto;
}

.hero-links a {
  color: #d8dce4;
  text-decoration: none;
  border-bottom: 1px solid rgba(216, 220, 228, 0.4);
}

.hero-links a:hover,
.hero-links a:focus-visible {
  color: #f3ecdd;
  border-bottom-color: #f3ecdd;
}

.synopsis {
  max-width: 760px;
  padding: 20px 24px 8px;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.5;
}

.age-lock {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 14px 24px 0;
  padding: 12px 14px;
  border: 1px solid;
  border-radius: 2px;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.45;
}

.age-lock strong {
  font: 700 11px 'IBM Plex Mono', monospace;
  letter-spacing: 0.08em;
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

/* Sticky so the season you are reading names itself the whole way down. A show
   with two hundred episodes is otherwise a wall of titles with no sense of
   where you are in it. */
.season-heading {
  position: sticky;
  /* Clears the app's own sticky chrome, which is also pinned to the top — see
     `--ntv-chrome-height` in App.vue. Without the offset these scroll behind
     the channel strip and are never actually seen. */
  top: var(--ntv-chrome-height, 0px);
  /* Below the chrome's own z-index of 50, so the bar always wins. */
  z-index: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 22px 0 0;
  padding: 10px 8px 8px;
  border-bottom: 1px solid;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.season-heading:first-child {
  margin-top: 0;
}

.season-count {
  font-size: 10px;
  letter-spacing: 0.06em;
  opacity: 0.75;
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
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  font-family: 'Oswald', sans-serif;
  font-size: 17px;
  flex: 1;
}

.ep-meta {
  font-size: 12px;
  white-space: nowrap;
}

.ep-sources {
  font-size: 10px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  padding: 2px 6px;
  border: 1px solid;
  border-radius: 2px;
}

/* Its own target, not part of the title button: following it must not also
   open the episode. */
.ep-imdb {
  font-size: 10px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  text-decoration: none;
  opacity: 0.7;
  transition: opacity 120ms ease;
}

.ep-imdb:hover,
.ep-imdb:focus-visible {
  opacity: 1;
  text-decoration: underline;
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

  .hero-genres {
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

  /* Both sit on the metadata line rather than claiming a column of their own,
     which there is no room for at this width. */
  .ep-sources,
  .ep-imdb {
    flex: none;
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
