/**
 * Loads YouTube's IFrame Player API.
 *
 * This is the app's only runtime script load, and it is player machinery
 * rather than a data call — nothing here queries the Data API or fetches
 * metadata. It exists because autoplay-advance needs an end-of-video event,
 * and a bare `<iframe>` cannot report one.
 */

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

const API_SRC = 'https://www.youtube.com/iframe_api';

/** Privacy-enhanced host: no cookie is set until the viewer actually plays. */
export const NOCOOKIE_HOST = 'https://www.youtube-nocookie.com';

let apiPromise: Promise<YtNamespace> | null = null;

export function loadYoutubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  apiPromise ??= new Promise<YtNamespace>((resolve, reject) => {
    // The API calls this global exactly once, whoever asked for it first.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API loaded without a Player constructor'));
    };

    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('failed to load the YouTube IFrame Player API'));
    document.head.appendChild(script);
  });

  return apiPromise;
}
