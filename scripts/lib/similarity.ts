/**
 * Title matching for scripts/match.ts. Deliberately small and dependency-free.
 *
 * The target is roughly 60% resolved automatically; the rest goes to the admin
 * queue for a human. That ratio is the design, not a shortfall — heuristics
 * chasing the last 40% cost more to maintain than the keystrokes they save, so
 * nothing here tries to be clever about the hard cases.
 */

/** Noise that upload titles carry and episode titles never do. */
const NOISE = new Set([
  'full',
  'episode',
  'episodes',
  'aflevering',
  'afl',
  'complete',
  'hd',
  'remastered',
  'official',
  'compilation',
  'cartoon',
  'cartoons',
  'classic',
  'season',
  'seizoen',
  'part',
  'deel',
]);

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 0 && !NOISE.has(t));
}

/** Season/episode numbering a video title may advertise, in the forms that
 * actually show up: "S01E04", "1x04", "episode 4", "aflevering 4". */
export function parseNumbering(title: string): { season: number | null; episode: number | null } {
  const sxxexx = /s(\d{1,2})\s*e(\d{1,3})/i.exec(title);
  if (sxxexx?.[1] && sxxexx[2]) {
    return { season: Number(sxxexx[1]), episode: Number(sxxexx[2]) };
  }

  const cross = /(?<![\d.])(\d{1,2})x(\d{1,3})(?![\d.])/i.exec(title);
  if (cross?.[1] && cross[2]) {
    return { season: Number(cross[1]), episode: Number(cross[2]) };
  }

  const worded = /(?:episode|afl(?:evering)?|ep)\.?\s*(\d{1,3})\b/i.exec(title);
  if (worded?.[1]) {
    return { season: null, episode: Number(worded[1]) };
  }

  return { season: null, episode: null };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function bigrams(text: string): Set<string> {
  const compact = text.replace(/ /g, '');
  const out = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) out.add(compact.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice over character bigrams — forgiving about word order and
 * small spelling drift in a way a pure token set is not. */
function dice(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared += 1;
  return (2 * shared) / (ga.size + gb.size);
}

export type ScoreInput = {
  /** The YouTube upload title. */
  videoTitle: string;
  /** The TMDB episode title. */
  episodeTitle: string;
  /** Stripped from the video title before scoring — every upload on a series'
   * channel repeats it, so leaving it in inflates every candidate equally. */
  seriesName: string;
  season: number;
  episode: number;
};

/**
 * Confidence in [0, 1] that `videoTitle` is an upload of the given episode.
 *
 * Explicit numbering in the upload title is treated as near-decisive when it
 * agrees, and as a hard veto when it contradicts — a video that says "S02E05"
 * is not episode 3 of season 1 no matter how the words line up.
 */
export function scoreMatch(input: ScoreInput): number {
  const numbering = parseNumbering(input.videoTitle);

  const seasonStated = numbering.season !== null;
  const seasonAgrees = numbering.season === input.season;
  const episodeStated = numbering.episode !== null;
  const episodeAgrees = numbering.episode === input.episode;

  if ((seasonStated && !seasonAgrees) || (episodeStated && !episodeAgrees)) return 0;

  const seriesTokens = new Set(tokenize(input.seriesName));
  const videoTokens = tokenize(input.videoTitle).filter((t) => !seriesTokens.has(t) && !/^\d+$/.test(t));
  const episodeTokens = tokenize(input.episodeTitle);

  const titleScore =
    0.6 * jaccard(new Set(videoTokens), new Set(episodeTokens)) +
    0.4 * dice(videoTokens.join(' '), episodeTokens.join(' '));

  // An episode number that agrees is strong evidence on its own: plenty of
  // uploads are titled "Series — Episode 12" with no episode title at all.
  if (episodeStated && episodeAgrees) {
    const numberingWeight = seasonStated && seasonAgrees ? 0.85 : 0.7;
    return numberingWeight + (1 - numberingWeight) * titleScore;
  }

  return titleScore;
}

/** Everything at or above this is written straight to content/episodes.json;
 * everything below goes to the queue for a human. */
export const CONFIDENCE_THRESHOLD = 0.72;
