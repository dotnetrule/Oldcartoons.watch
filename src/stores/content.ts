import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  BroadcastChannel,
  BroadcastDataFile,
  BroadcastSchedule,
  IndexFile,
  Network,
  SeriesFile,
  SeriesStub,
} from '../types';

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
  const broadcastData = ref<BroadcastDataFile | null>(null);

  let indexRequest: Promise<IndexFile> | null = null;
  const seriesRequests = new Map<string, Promise<SeriesFile>>();
  let broadcastRequest: Promise<BroadcastDataFile> | null = null;

  const networks = computed<Network[]>(() => index.value?.networks ?? []);
  const stubs = computed<SeriesStub[]>(() => index.value?.series ?? []);
  const decades = computed<string[]>(() => index.value?.decades ?? []);
  const channels = computed<BroadcastChannel[]>(() => broadcastData.value?.channels ?? []);
  const schedules = computed<BroadcastSchedule[]>(() => broadcastData.value?.schedules ?? []);
  const liveChannels = computed<BroadcastChannel[]>(() =>
    channels.value.filter((channel) => channel.scheduleId !== null),
  );
  /** Broadcasters that actually went on air. The catalogue also carries
   * bookkeeping buckets for material with no established channel, and those
   * are never shown to a viewer as a channel. */
  const realNetworks = computed<Network[]>(() => networks.value.filter((network) => network.real));
  const realNetworkSlugs = computed(() => new Set(realNetworks.value.map((network) => network.slug)));

  /** One feed per real network: what the channel map draws a card for.
   * Archive weeks belong to a network page, not to the map. */
  const primaryChannels = computed<BroadcastChannel[]>(() =>
    channels.value.filter(
      (channel) => channel.kind === 'primary' && realNetworkSlugs.value.has(channel.networkSlug),
    ),
  );

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

  function loadBroadcastData(): Promise<BroadcastDataFile> {
    broadcastRequest ??= loadJson<BroadcastDataFile>('/data/broadcast.json').then((data) => {
      broadcastData.value = data;
      return data;
    });
    return broadcastRequest;
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

  function channel(id: string | null | undefined): BroadcastChannel | null {
    return id ? channels.value.find((item) => item.id === id) ?? null : null;
  }

  /** Everything the archive lists for a broadcaster: its own catalogue plus
   * the programmes a lineup places on it. Dutch-language sources first, then
   * chronological — the order the channel map and the broadcaster page share.
   * An empty result is a statement, not a gap: a channel in the 1–10 map that
   * carried no children's programming has no titles to list. */
  function seriesForNetwork(networkSlug: string | null | undefined): SeriesStub[] {
    if (!networkSlug) return [];
    return stubs.value
      .filter((item) => item.networkSlugs.includes(networkSlug))
      .sort(
        (a, b) =>
          Number(b.availableLanguages.includes('nl')) - Number(a.availableLanguages.includes('nl')) ||
          a.firstAirYear - b.firstAirYear,
      );
  }

  function channelsForNetwork(networkSlug: string | null | undefined): BroadcastChannel[] {
    return networkSlug
      ? channels.value.filter((item) => item.networkSlug === networkSlug)
      : [];
  }

  /** The preserved weeks of a network's real schedule, in listed order. */
  function archiveChannelsForNetwork(networkSlug: string | null | undefined): BroadcastChannel[] {
    return channelsForNetwork(networkSlug).filter((item) => item.kind === 'archive');
  }

  function schedule(id: string | null | undefined): BroadcastSchedule | null {
    return id ? schedules.value.find((item) => item.id === id) ?? null : null;
  }

  function scheduleForChannel(channelId: string | null | undefined): BroadcastSchedule | null {
    return schedule(channel(channelId)?.scheduleId);
  }

  return {
    index,
    broadcastData,
    networks,
    stubs,
    decades,
    channels,
    schedules,
    liveChannels,
    realNetworks,
    primaryChannels,
    loadIndex,
    loadSeries,
    loadBroadcastData,
    network,
    stub,
    series,
    seriesForNetwork,
    channel,
    channelsForNetwork,
    archiveChannelsForNetwork,
    schedule,
    scheduleForChannel,
  };
});
