import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  BroadcastChannel,
  BroadcastDataFile,
  BroadcastOpenFile,
  BroadcastSchedule,
  IndexFile,
  Network,
  SeriesFile,
  SeriesStub,
} from '../types';
import { useUiStore } from './ui';

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
  const openData = ref<BroadcastOpenFile | null>(null);

  let indexRequest: Promise<IndexFile> | null = null;
  const seriesRequests = new Map<string, Promise<SeriesFile>>();
  let broadcastRequest: Promise<BroadcastDataFile> | null = null;
  let openRequest: Promise<BroadcastOpenFile> | null = null;

  const networks = computed<Network[]>(() => index.value?.networks ?? []);
  const stubs = computed<SeriesStub[]>(() => index.value?.series ?? []);
  const decades = computed<string[]>(() => index.value?.decades ?? []);
  const channels = computed<BroadcastChannel[]>(() => broadcastData.value?.channels ?? []);
  const schedules = computed<BroadcastSchedule[]>(() => [
    ...(broadcastData.value?.schedules ?? []),
    ...(openData.value?.schedules ?? []),
  ]);
  const liveChannels = computed<BroadcastChannel[]>(() =>
    channels.value.filter((channel) => activeScheduleId(channel) !== null),
  );

  /** Broadcasters that actually went on air. The catalogue also carries
   * bookkeeping buckets for material with no established channel, and those
   * are never shown to a viewer as a channel. */
  const realNetworks = computed<Network[]>(() => networks.value.filter((network) => network.real));

  /**
   * Networks with at least one programme that has a playable episode.
   *
   * A station whose whole line-up is still gaps is a station this archive
   * cannot show anything on. Drawing it anyway produces a card that never
   * lights up and a page that lists titles and plays none of them, which reads
   * as a broken channel rather than an honest one — so it is left off the
   * channel map and the tab strip until something on it can be watched.
   *
   * This is about the archive, not about the schedule: a network whose
   * episodes exist but are not in its own language has programmes to show on
   * its page even while its live feed stays dark, and it keeps its place.
   */
  const stockedNetworkSlugs = computed(
    () => new Set(stubs.value.flatMap((stub) => (stub.availableCount > 0 ? stub.networkSlugs : []))),
  );

  /** Real networks that have something to watch. */
  const stockedNetworks = computed<Network[]>(() =>
    realNetworks.value.filter((network) => stockedNetworkSlugs.value.has(network.slug)),
  );

  /** The tab strip: stocked stations of the Dutch channel map, in position order. */
  const listedNetworks = computed<Network[]>(() =>
    [...stockedNetworks.value]
      .filter((network) => network.listed)
      .sort((a, b) => a.channelNumber - b.channelNumber),
  );

  /** One feed per stocked network: what the channel map draws a card for. */
  const primaryChannels = computed<BroadcastChannel[]>(() => {
    const shown = new Set(stockedNetworks.value.map((network) => network.slug));
    return channels.value.filter((channel) => shown.has(channel.networkSlug));
  });

  /** index.json is the only payload the schedule route loads — the archive is
   * thousands of episodes and the grid needs stubs. */
  function loadIndex(): Promise<IndexFile> {
    // Held as a promise so concurrent route entries share one request rather
    // than racing to fetch the same file.
    indexRequest ??= loadJson<IndexFile>('/data/index.json')
      .then((data) => {
        index.value = data;
        return data;
      })
      .catch((error: unknown) => {
        indexRequest = null;
        throw error;
      });
    return indexRequest;
  }

  /** Fetched on series/episode route entry, then cached for the session. */
  function loadSeries(slug: string): Promise<SeriesFile> {
    const cached = seriesFiles.value.get(slug);
    if (cached) return Promise.resolve(cached);

    let request = seriesRequests.get(slug);
    if (!request) {
      request = loadJson<SeriesFile>(`/data/series-${slug}.json`)
        .then((data) => {
          seriesFiles.value.set(slug, data);
          return data;
        })
        .catch((error: unknown) => {
          seriesRequests.delete(slug);
          throw error;
        });
      seriesRequests.set(slug, request);
    }
    return request;
  }

  function loadBroadcastData(): Promise<BroadcastDataFile> {
    broadcastRequest ??= loadJson<BroadcastDataFile>('/data/broadcast.json')
      .then((data) => {
        broadcastData.value = data;
        return data;
      })
      .catch((error: unknown) => {
        broadcastRequest = null;
        throw error;
      });
    return broadcastRequest;
  }

  /** The wider line-ups, which are the same size again as the broadcast feeds.
   * Fetched only once a viewer asks for them — see `BroadcastOpenFile`. */
  function loadOpenSchedules(): Promise<BroadcastOpenFile> {
    openRequest ??= loadJson<BroadcastOpenFile>('/data/broadcast-open.json')
      .then((data) => {
        openData.value = data;
        return data;
      })
      .catch((error: unknown) => {
        openRequest = null;
        throw error;
      });
    return openRequest;
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

  function channelsForNetwork(networkSlug: string | null | undefined): BroadcastChannel[] {
    return networkSlug
      ? channels.value.filter((item) => item.networkSlug === networkSlug)
      : [];
  }

  function schedule(id: string | null | undefined): BroadcastSchedule | null {
    return id ? schedules.value.find((item) => item.id === id) ?? null : null;
  }

  /**
   * Which of a channel's two feeds this viewer is watching.
   *
   * Falls back to the broadcast feed whenever the wider one is not an option —
   * the channel has no wider line-up, or `broadcast-open.json` has not arrived
   * yet. A setting about *adding* programmes should never be what takes a
   * channel off the air, and the fallback resolves itself: `schedules` is
   * computed, so the moment the payload lands every caller re-evaluates and the
   * wider line-up takes over.
   */
  function activeScheduleId(item: BroadcastChannel | null): string | null {
    if (!item) return null;
    if (useUiStore().languageMode !== 'all') return item.scheduleId;
    const open = item.openScheduleId;
    return open !== null && schedules.value.some((entry) => entry.id === open)
      ? open
      : item.scheduleId;
  }

  function scheduleForChannel(channelId: string | null | undefined): BroadcastSchedule | null {
    return schedule(activeScheduleId(channel(channelId)));
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
    stockedNetworks,
    listedNetworks,
    primaryChannels,
    loadIndex,
    loadSeries,
    loadBroadcastData,
    loadOpenSchedules,
    network,
    stub,
    series,
    channel,
    channelsForNetwork,
    schedule,
    activeScheduleId,
    scheduleForChannel,
  };
});
