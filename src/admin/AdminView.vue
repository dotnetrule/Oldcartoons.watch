<script setup lang="ts">
/**
 * Dev-only. Two modes, one job each: resolve one ambiguity per keystroke.
 *
 * This route is registered only under `import.meta.env.DEV`, so the branch
 * folds away and this chunk is never emitted in a production build. Its write
 * endpoint is a Vite dev-server middleware for the same reason.
 *
 * Anything that is not on the critical path of "decide, commit, next" is
 * deliberately absent — general CRUD over this data is faster as a script.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useUiStore } from '../stores/ui';
import { tmdbImage } from '../data/helpers';
import type { Episode, Override, QueueEntry, SeriesSource } from '../types';

type TmdbImage = { file_path: string; iso_639_1: string | null; width: number; height: number };
type ImagesResponse = {
  detail: { name: string; overview: string; first_air_date: string | null };
  images: { backdrops: TmdbImage[]; posters: TmdbImage[] };
};

const ui = useUiStore();
const C = computed(() => ui.C);

const mode = ref<'match' | 'metadata'>('match');
const status = ref('');
const busy = ref(false);

const queue = ref<QueueEntry[]>([]);
const episodes = ref<Episode[]>([]);
const overrides = ref<Record<string, Override>>({});
const seriesSources = ref<SeriesSource[]>([]);

/* ---------------------------------------------------------------- */
/* Match mode                                                        */
/* ---------------------------------------------------------------- */

const queueIdx = ref(0);
const candidateIdx = ref(0);

const entry = computed<QueueEntry | null>(() => queue.value[queueIdx.value] ?? null);
const candidates = computed(() => entry.value?.candidates ?? []);

/** Accept the highlighted candidate. The decision is terminal: match.ts never
 * revisits an episode that already has a record. */
async function selectCandidate(): Promise<void> {
  const current = entry.value;
  const candidate = candidates.value[candidateIdx.value];
  if (!current || !candidate) return;

  const next: Episode = {
    tmdbEpisodeId: current.tmdbEpisodeId,
    seriesId: current.seriesId,
    season: current.season,
    episode: current.episode,
    youtubeId: candidate.youtubeId,
    status: 'available',
    checkedAt: new Date().toISOString().slice(0, 10),
    source: candidate.source,
  };

  // Replace rather than append: there is exactly one record per episode, and
  // a seeded 'missing' placeholder for this slot may already exist.
  const others = episodes.value.filter(
    (ep) =>
      !(ep.seriesId === next.seriesId && ep.season === next.season && ep.episode === next.episode),
  );
  const merged = [...others, next];

  await post('/__admin/episodes', merged);
  episodes.value = merged;
  dropCurrentEntry();
}

/** Skip: leave the episode unresolved and move on. */
function skip(): void {
  queueIdx.value = Math.min(queueIdx.value + 1, Math.max(queue.value.length - 1, 0));
  candidateIdx.value = 0;
}

function dropCurrentEntry(): void {
  queue.value = queue.value.filter((_, i) => i !== queueIdx.value);
  if (queueIdx.value >= queue.value.length) queueIdx.value = Math.max(queue.value.length - 1, 0);
  candidateIdx.value = 0;
}

/* ---------------------------------------------------------------- */
/* Metadata mode                                                     */
/* ---------------------------------------------------------------- */

const seriesIdx = ref(0);
const imageIdx = ref(0);
const images = ref<TmdbImage[]>([]);
const form = ref<{ name: string; overview: string; firstAirYear: string; networkSlug: string }>({
  name: '',
  overview: '',
  firstAirYear: '',
  networkSlug: '',
});

const activeSeries = computed<SeriesSource | null>(() => seriesSources.value[seriesIdx.value] ?? null);

async function loadImages(): Promise<void> {
  const series = activeSeries.value;
  images.value = [];
  imageIdx.value = 0;
  if (!series) return;

  const data = await getJson<ImagesResponse>(`/__admin/images/${series.tmdbId}`);
  // The design sets titles in display type over the backdrop, so candidates
  // with burned-in title text are filtered out rather than left to be
  // rejected by eye.
  images.value = data.images.backdrops.filter((img) => img.iso_639_1 === null);

  const existing = overrides.value[String(series.tmdbId)] ?? {};
  form.value = {
    name: existing.name ?? '',
    overview: existing.overview ?? '',
    firstAirYear: existing.firstAirYear ? String(existing.firstAirYear) : '',
    networkSlug: existing.networkSlug ?? '',
  };
}

function stepSeries(delta: number): void {
  const count = seriesSources.value.length;
  if (count === 0) return;
  seriesIdx.value = (seriesIdx.value + delta + count) % count;
  void loadImages();
}

/** Overrides stay sparse: only keys that actually differ from TMDB are
 * written, because anything absent keeps tracking TMDB on the next fetch. */
async function saveOverride(backdrop?: string): Promise<void> {
  const series = activeSeries.value;
  if (!series) return;

  const next: Override = {};
  if (form.value.name.trim()) next.name = form.value.name.trim();
  if (form.value.overview.trim()) next.overview = form.value.overview.trim();
  if (form.value.firstAirYear.trim()) next.firstAirYear = Number(form.value.firstAirYear);
  if (form.value.networkSlug.trim()) next.networkSlug = form.value.networkSlug.trim();

  const chosen = backdrop ?? overrides.value[String(series.tmdbId)]?.backdrop;
  if (chosen) next.backdrop = chosen;

  const merged = { ...overrides.value };
  if (Object.keys(next).length === 0) delete merged[String(series.tmdbId)];
  else merged[String(series.tmdbId)] = next;

  await post('/__admin/overrides', merged);
  overrides.value = merged;
}

function selectImage(): void {
  const image = images.value[imageIdx.value];
  if (image) void saveOverride(image.file_path);
}

/* ---------------------------------------------------------------- */
/* Transport                                                         */
/* ---------------------------------------------------------------- */

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

async function post(url: string, body: unknown): Promise<void> {
  busy.value = true;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { error?: string; wrote?: string };
    if (!response.ok) throw new Error(result.error ?? `${response.status}`);
    status.value = `wrote content/${result.wrote}`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

/* ---------------------------------------------------------------- */
/* Keyboard — one decision per keystroke                             */
/* ---------------------------------------------------------------- */

function onKeydown(e: KeyboardEvent): void {
  // The metadata form has real text inputs; typing in one is not navigation.
  const target = e.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

  if (mode.value === 'match') {
    if (!entry.value) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        candidateIdx.value = Math.min(candidateIdx.value + 1, candidates.value.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        candidateIdx.value = Math.max(candidateIdx.value - 1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        skip();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        queueIdx.value = Math.max(queueIdx.value - 1, 0);
        candidateIdx.value = 0;
        break;
      case 'Enter':
        e.preventDefault();
        void selectCandidate();
        break;
      case 's':
        e.preventDefault();
        skip();
        break;
      default:
        break;
    }
    return;
  }

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      imageIdx.value = Math.min(imageIdx.value + 1, images.value.length - 1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      imageIdx.value = Math.max(imageIdx.value - 1, 0);
      break;
    case 'ArrowDown':
      e.preventDefault();
      stepSeries(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      stepSeries(-1);
      break;
    case 'Enter':
      e.preventDefault();
      selectImage();
      break;
    case 's':
      e.preventDefault();
      stepSeries(1);
      break;
    default:
      break;
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  try {
    queue.value = await getJson<QueueEntry[]>('/__admin/queue');
    episodes.value = await getJson<Episode[]>('/__admin/episodes');
    overrides.value = await getJson<Record<string, Override>>('/__admin/overrides');
    seriesSources.value = await getJson<SeriesSource[]>('/__admin/series');
    await loadImages();
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  }
});

onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="admin" :style="{ color: C.ink }">
    <div class="admin-head" :style="{ borderColor: C.border2 }">
      <h1 :style="{ color: C.ink }">ADMIN</h1>
      <div class="chipgroup">
        <button
          v-for="m in (['match', 'metadata'] as const)"
          :key="m"
          class="chip"
          :style="{
            background: mode === m ? C.ink : 'transparent',
            color: mode === m ? C.chipFg : C.dim,
            borderColor: C.border2,
          }"
          @click="mode = m"
        >
          {{ m.toUpperCase() }}
        </button>
      </div>
      <span class="mono hint" :style="{ color: C.dim }">
        ↑↓ move · ←→ {{ mode === 'match' ? 'entry' : 'image' }} · ⏎ select · s skip
      </span>
      <span class="mono status" :style="{ color: busy ? C.dim : C.dim2 }">{{ status }}</span>
    </div>

    <!-- Match mode -->
    <div v-if="mode === 'match'" class="panes">
      <div class="pane" :style="{ borderColor: C.border }">
        <div class="mono pane-label" :style="{ color: C.dim }">
          TMDB EPISODE · {{ queue.length }} QUEUED
        </div>
        <template v-if="entry">
          <div class="ep-series" :style="{ color: C.dim2 }">{{ entry.seriesSlug }}</div>
          <div class="ep-title">{{ entry.episodeTitle }}</div>
          <div class="mono" :style="{ color: C.dim }">S{{ entry.season }} · E{{ entry.episode }}</div>
        </template>
        <div v-else class="mono" :style="{ color: C.dim }">
          Queue is empty — run <code>npm run match</code> to fill it.
        </div>
      </div>

      <div class="pane" :style="{ borderColor: C.border }">
        <div class="mono pane-label" :style="{ color: C.dim }">CANDIDATE UPLOADS</div>
        <div
          v-for="(candidate, i) in candidates"
          :key="candidate.youtubeId"
          class="candidate"
          :style="{ background: i === candidateIdx ? C.railBg : 'transparent' }"
          @click="candidateIdx = i"
          @dblclick="selectCandidate()"
        >
          <div class="candidate-title">{{ candidate.title }}</div>
          <div class="mono" :style="{ color: C.dim }">
            {{ candidate.youtubeId }} · {{ Math.round(candidate.score * 100) }}% ·
            {{ candidate.source.kind }}
          </div>
        </div>
        <div v-if="entry && candidates.length === 0" class="mono" :style="{ color: C.dim }">
          No candidates — this episode has no upload to match.
        </div>
      </div>
    </div>

    <!-- Metadata mode -->
    <div v-else class="panes">
      <div class="pane" :style="{ borderColor: C.border }">
        <div class="mono pane-label" :style="{ color: C.dim }">
          SERIES {{ seriesIdx + 1 }}/{{ seriesSources.length }}
        </div>
        <div class="ep-title">{{ activeSeries?.slug }}</div>
        <div class="mono" :style="{ color: C.dim }">tmdb {{ activeSeries?.tmdbId }}</div>

        <label class="field">
          <span class="mono" :style="{ color: C.dim }">name</span>
          <input v-model="form.name" :style="{ borderColor: C.border2, color: C.ink }" />
        </label>
        <label class="field">
          <span class="mono" :style="{ color: C.dim }">overview</span>
          <textarea v-model="form.overview" rows="4" :style="{ borderColor: C.border2, color: C.ink }" />
        </label>
        <label class="field">
          <span class="mono" :style="{ color: C.dim }">firstAirYear</span>
          <input v-model="form.firstAirYear" :style="{ borderColor: C.border2, color: C.ink }" />
        </label>
        <label class="field">
          <span class="mono" :style="{ color: C.dim }">networkSlug</span>
          <input v-model="form.networkSlug" :style="{ borderColor: C.border2, color: C.ink }" />
        </label>
        <button class="chip" :style="{ borderColor: C.border2, color: C.dim2 }" @click="saveOverride()">
          SAVE TEXT FIELDS
        </button>
      </div>

      <div class="pane" :style="{ borderColor: C.border }">
        <div class="mono pane-label" :style="{ color: C.dim }">
          BACKDROPS · textless only ({{ images.length }})
        </div>
        <div class="image-grid">
          <button
            v-for="(image, i) in images"
            :key="image.file_path"
            class="image-cell"
            :style="{ outline: i === imageIdx ? `2px solid ${C.ink}` : 'none' }"
            @click="imageIdx = i"
            @dblclick="selectImage()"
          >
            <img :src="tmdbImage(image.file_path, 'w300')" :alt="''" loading="lazy" />
          </button>
        </div>
        <div v-if="images.length === 0" class="mono" :style="{ color: C.dim }">
          No textless backdrops cached — run <code>npm run fetch</code>.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin {
  padding: 20px;
}

.mono {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}

.admin-head {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid;
}

.admin-head h1 {
  margin: 0;
  font-family: 'Oswald', sans-serif;
  font-size: 24px;
  letter-spacing: 0.06em;
}

.chipgroup {
  display: flex;
  gap: 4px;
}

.chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  padding: 5px 10px;
  border: 1px solid;
  border-radius: 2px;
  cursor: pointer;
  background: none;
}

.hint,
.status {
  letter-spacing: 0.04em;
}

.status {
  margin-left: auto;
}

.panes {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.pane {
  flex: 1;
  min-width: 0;
  border: 1px solid;
  border-radius: 2px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.pane-label {
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.ep-series {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}

.ep-title {
  font-family: 'Oswald', sans-serif;
  font-size: 22px;
  line-height: 1.15;
}

.candidate {
  padding: 8px;
  border-radius: 2px;
  cursor: pointer;
}

.candidate-title {
  font-family: 'Oswald', sans-serif;
  font-size: 15px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field input,
.field textarea {
  background: transparent;
  border: 1px solid;
  border-radius: 2px;
  padding: 6px 8px;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.image-cell {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  line-height: 0;
}

.image-cell img {
  width: 100%;
  height: auto;
  display: block;
}
</style>
