/**
 * Reading an episode's state off its list of uploads.
 *
 * An episode used to carry one video and one status, so "is this playable" was
 * a field. With several uploads per episode it becomes a question about the
 * set, and every caller has to answer it the same way or the archive will
 * disagree with itself — the schedule booking a slot the series page calls a
 * gap. These are that one answer.
 */
import type { ContentLanguage, Episode, EpisodeStatus, EpisodeVideo } from '../../src/types';

/** A video nobody can open any more. The health check writes this, and the row
 * is kept rather than deleted so matching does not go and find it again. */
const isDead = (video: EpisodeVideo): boolean => video.status === 'missing';

/** The uploads a viewer could actually watch, in order. Region-locked counts:
 * it plays for most people and the player says so for the rest. */
export const playableVideos = (episode: Episode): EpisodeVideo[] =>
  episode.videos.filter((video) => !isDead(video));

/**
 * The upload the player opens and the schedule books.
 *
 * The first that still plays, rather than the first outright — a head that has
 * since died should hand over to its alternate instead of turning the episode
 * into a gap while three working copies sit behind it.
 */
export const defaultVideo = (episode: Episode): EpisodeVideo | null =>
  playableVideos(episode)[0] ?? null;

/**
 * The episode's status, derived from its uploads.
 *
 * 'missing' means no upload plays — either none was ever found, or every one
 * that was has since gone. Those are the same fact to a viewer and the archive
 * says the same thing about both. Otherwise the default upload's own status
 * stands, so a region-locked default still reports the restriction.
 */
export function episodeStatus(episode: Episode): EpisodeStatus {
  return defaultVideo(episode)?.status ?? 'missing';
}

/** Whether anything on this episode can be played at all. */
export const isPlayable = (episode: Episode): boolean => defaultVideo(episode) !== null;

/**
 * Every language this episode can be heard in, across all of its uploads.
 *
 * Union rather than the default upload's alone: an English default with a Dutch
 * copy behind it genuinely is available in Dutch, and hiding that would keep a
 * series off a Dutch station it belongs on.
 */
export function audioLanguagesOf(
  episode: Episode,
  defaultLanguageOf: (video: EpisodeVideo) => ContentLanguage | null,
): ContentLanguage[] {
  const languages = new Set<ContentLanguage>();
  for (const video of playableVideos(episode)) {
    const source = defaultLanguageOf(video);
    if (source) languages.add(source);
    for (const language of video.audioLanguages ?? []) languages.add(language);
  }
  return [...languages].sort();
}
