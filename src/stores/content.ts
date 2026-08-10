import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { IndexFile, Network, SeriesFile, SeriesStub } from '../types';

/**
 * The generated payload, and nothing else.
 *
 * Both loaders throw on failure. There are no fallback data paths: if
 * `public/data/` is missing or stale the build gate did not run, and rendering
 * a half-empty archive would hide that rather than surface it.
 */
async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed to load: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const useContentStore = defineStore('content', () => {
  const index = ref<IndexFile | null>(null);
  const seriesFiles = ref(new Map<string, SeriesFile>());

  let indexRequest: Promise<IndexFile> | null = null;
  const seriesRequests = new Map<string, Promise<SeriesFile>>();

  const networks = computed<Network[]>(() => index.value?.networks ?? []);
  const stubs = computed<SeriesStub[]>(() => index.value?.series ?? []);
  const decades = computed<string[]>(() => index.value?.decades ?? []);

  /** index.json is the only payload the schedule route loads — the archive is
   * thousands of episodes and the grid needs stubs. */
  function loadIndex(): Promise<IndexFile> {
    // Held as a promise so concurrent route entries share one request rather
    // than racing to fetch the same file.
    indexRequest ??= loadJson<IndexFile>('/data/index.json').then((data) => {
      index.value = data;
      return data;
    });
    return indexRequest;
  }

  /** Fetched on series/episode route entry, then cached for the session. */
  function loadSeries(slug: string): Promise<SeriesFile> {
    const cached = seriesFiles.value.get(slug);
    if (cached) return Promise.resolve(cached);

    let request = seriesRequests.get(slug);
    if (!request) {
      request = loadJson<SeriesFile>(`/data/series-${slug}.json`).then((data) => {
        seriesFiles.value.set(slug, data);
        return data;
      });
      seriesRequests.set(slug, request);
    }
    return request;
  }

  const networkBySlug = computed(() => new Map(networks.value.map((n) => [n.slug, n])));

  function network(slug: string | null | undefined): Network | null {
    return slug ? networkBySlug.value.get(slug) ?? null : null;
  }

  function stub(slug: string | null | undefined): SeriesStub | null {
    return slug ? stubs.value.find((s) => s.slug === slug) ?? null : null;
  }

  function series(slug: string | null | undefined): SeriesFile | null {
    return slug ? seriesFiles.value.get(slug) ?? null : null;
  }

  return {
    index,
    networks,
    stubs,
    decades,
    loadIndex,
    loadSeries,
    network,
    stub,
    series,
  };
});
