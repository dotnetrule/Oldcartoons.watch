export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** A series with a hand-authored `seasons` array keeps it; otherwise a
 * placeholder run is synthesized from its year span so every series has
 * something playable in the mocked player. */
export function genSeasons(series) {
  if (series.seasons) return series.seasons;
  const count = typeof series.episodeCount === 'number' ? Math.min(series.episodeCount, 12) : 6;
  const states = ['available', 'available', 'region-locked', 'available', 'missing', 'available', 'region-locked', 'available'];
  const span = Math.max(series.yearEnd - series.yearStart, 1);
  const eps = [];
  for (let i = 0; i < count; i++) {
    const yr = series.yearStart + Math.floor((i / count) * span);
    eps.push({
      number: i + 1,
      title: 'Episode ' + (i + 1),
      runtime: series.type === 'Live-action' ? 25 : 22,
      airDate: MONTHS[i % 12] + ' ' + (((i * 7) % 28) + 1) + ', ' + yr,
      availability: states[i % states.length],
    });
  }
  return [{ n: 1, episodes: eps }];
}

export function initialsFor(title) {
  const stop = new Set(['the', 'and', 'of', 'a', 'an', 'de', 'het', 'een']);
  const words = title.split(/\s+/).filter((w) => w && !stop.has(w.toLowerCase().replace(/[^a-z]/g, '')));
  const pick = words.length ? words : title.split(/\s+/);
  return pick
    .slice(0, 2)
    .map((w) => (w.replace(/[^A-Za-z0-9]/g, '')[0] || ''))
    .join('')
    .toUpperCase();
}
