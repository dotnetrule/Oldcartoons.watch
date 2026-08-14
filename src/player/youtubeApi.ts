/**
 * Loads YouTube's IFrame Player API.
 *
 * This is the app's only runtime script load, and it is player machinery
 * rather than a data call — nothing here queries the Data API or fetches
 * metadata. It exists because autoplay-advance needs an end-of-video event,
 * and a bare `<iframe>` cannot report one.
 */

/**
 * One entry from the player's audio-track list.
 *
 * Undocumented, so the shape is written as "some strings, names unknown"
 * rather than guessed at. Nothing here reads a specific key: `trackLanguages`
 * below looks at every string on the object instead, which survives YouTube
 * renaming one.
 */
export type YtAudioTrack = Record<string, unknown>;

export type YtPlayer = {
  destroy: () => void;
  loadVideoById: (video: string | { videoId: string; startSeconds?: number }) => void;
  /** The API replaces the mount element with this iframe, so it is the only
   * handle on the embed once a player exists. */
  getIframe?: () => HTMLIFrameElement | null;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  /* Undocumented, hence optional — see `preferAudioLanguage`. */
  getAvailableAudioTracks?: () => YtAudioTrack[] | undefined;
  getAudioTrack?: () => YtAudioTrack | undefined;
  setAudioTrack?: (track: YtAudioTrack) => void;
};

type YtPlayerEvent = { data: number; target: YtPlayer };
type YtPlayerErrorEvent = { data: number; target: YtPlayer };

type YtNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      host?: string;
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: YtPlayerEvent) => void;
        onStateChange?: (event: YtPlayerEvent) => void;
        onError?: (event: YtPlayerErrorEvent) => void;
      };
    },
  ) => YtPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** The API-built iframe is what the browser hands fullscreen to when a viewer
 * uses YouTube's own control bar, and that needs the embedding page's
 * permission. Set defensively — the API usually does this itself. */
export function allowIframeFullscreen(target: YtPlayer): void {
  const iframe = target.getIframe?.();
  if (!iframe) return;
  iframe.setAttribute('allowfullscreen', 'true');
  const allow = iframe.getAttribute('allow') ?? '';
  if (!allow.includes('fullscreen')) {
    iframe.setAttribute('allow', allow ? `${allow}; fullscreen` : 'fullscreen');
  }
}

/* ---------------------------------------------------------------- */
/* Audio tracks                                                      */
/* ---------------------------------------------------------------- */

/**
 * What asking the player for a language got us.
 *
 * Four outcomes rather than a boolean, because the interesting distinction is
 * not "did it work" but *why not*: a video with no Nederlands track and a
 * player that will not admit to having one look identical to a viewer and need
 * opposite handling. Only `unsupported` is worth a notice — the others are
 * either done or genuinely not on offer.
 */
export type AudioPreference =
  | 'switched' /* the wanted language was there and is now playing */
  | 'already' /* it was already the playing track */
  | 'unavailable' /* the player listed its tracks and that language is not among them */
  | 'unsupported'; /* the player would not say — no track control on this embed */

/** How long to keep asking before calling it unsupported. The list is not
 * populated the instant the player is ready; it arrives with the video's data. */
const TRACK_WAIT_MS = 4_000;
const TRACK_POLL_MS = 250;

/** A language tag's primary subtag, lowercased: `nl-NL` → `nl`. */
function primarySubtag(tag: string): string {
  return (tag.split(/[-_]/, 1)[0] ?? '').toLowerCase();
}

/** Two or three letters, optionally with subtags, optionally `.`-prefixed the
 * way YouTube writes some ids. Deliberately strict at the front so a track
 * *name* — "Nederlands", "English (United States)" — cannot pass for a tag. */
const LANGUAGE_TAG = /^\.?[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

/**
 * Every language tag this track carries, from whichever key holds it.
 *
 * The list is undocumented and its keys have no contract, so reading
 * `track.languageCode` would be one rename away from silently never matching.
 * Reading every string on the object costs nothing here — a track has a
 * handful of fields — and keeps working through a rename.
 */
function trackLanguages(track: YtAudioTrack): string[] {
  return Object.values(track).flatMap((value) => {
    if (typeof value !== 'string' || !LANGUAGE_TAG.test(value)) return [];
    return [primarySubtag(value.replace(/^\./, ''))];
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start this player in `language` when the video has a track for it.
 *
 * YouTube documents no way to do this — there is no player parameter and no
 * supported API call, which is why the archive has been telling viewers to
 * reach for the settings menu themselves. The player *object* does carry
 * `getAvailableAudioTracks`/`setAudioTrack`, undocumented and unpromised, and
 * on the embeds that expose them a Nederlands dub can simply be switched on
 * before the viewer notices.
 *
 * Everything here is written for the day that stops being true: the methods
 * are optional on the type, absent ones report `unsupported`, and a throw is
 * caught rather than propagated. The failure mode of the whole function is the
 * behaviour the site had before it existed — the video plays in its upload
 * language and `AudioTrackNotice` says where the switch is.
 */
export async function preferAudioLanguage(
  player: YtPlayer,
  language: string,
  /** Lets a caller abandon a video it has already navigated away from. */
  isCurrent: () => boolean = () => true,
): Promise<AudioPreference> {
  if (
    typeof player.getAvailableAudioTracks !== 'function' ||
    typeof player.setAudioTrack !== 'function'
  ) {
    return 'unsupported';
  }

  const wanted = primarySubtag(language);
  const deadline = Date.now() + TRACK_WAIT_MS;

  while (isCurrent()) {
    let tracks: YtAudioTrack[] | undefined;
    try {
      tracks = player.getAvailableAudioTracks();
    } catch {
      return 'unsupported';
    }

    // Only a non-empty list counts as an answer. An empty one is what both a
    // single-track video and a player that has not loaded its tracks look
    // like, so it is waited on rather than acted on.
    if (Array.isArray(tracks) && tracks.length > 0) {
      const match = tracks.find((track) => trackLanguages(track).includes(wanted));
      if (!match) return 'unavailable';

      try {
        const playing = player.getAudioTrack?.();
        if (playing && trackLanguages(playing).includes(wanted)) return 'already';
        player.setAudioTrack(match);
      } catch {
        return 'unsupported';
      }
      return 'switched';
    }

    // Nothing usable within the wait. `unsupported` rather than `unavailable`
    // on purpose, and it is the conservative reading: a player that stays
    // silent has not ruled a Nederlands track out, so this falls back to the
    // notice — what the site did before any of this existed — instead of
    // asserting there was nothing to switch to.
    if (Date.now() >= deadline) return 'unsupported';
    await sleep(TRACK_POLL_MS);
  }

  return 'unsupported';
}

const API_SRC = 'https://www.youtube.com/iframe_api';
const API_LOAD_TIMEOUT_MS = 12_000;

/** Privacy-enhanced host: no cookie is set until the viewer actually plays. */
export const NOCOOKIE_HOST = 'https://www.youtube-nocookie.com';

let apiPromise: Promise<YtNamespace> | null = null;

export function loadYoutubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  apiPromise ??= new Promise<YtNamespace>((resolve, reject) => {
    // The API calls this global exactly once, whoever asked for it first.
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function fail(error: Error): void {
      clearTimeout(timeout);
      script.remove();
      reject(error);
    }

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error('YouTube IFrame API loaded without a Player constructor'));
    };

    script.src = API_SRC;
    script.async = true;
    script.onerror = () => fail(new Error('failed to load the YouTube IFrame Player API'));
    document.head.appendChild(script);
    timeout = setTimeout(
      () => fail(new Error('timed out loading the YouTube IFrame Player API')),
      API_LOAD_TIMEOUT_MS,
    );
  }).catch((error: unknown) => {
    // A transient network failure should not poison every later retry for the
    // rest of the browser session.
    apiPromise = null;
    throw error;
  });

  return apiPromise;
}
