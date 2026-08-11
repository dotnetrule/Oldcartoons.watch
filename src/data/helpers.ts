const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build a TMDB image URL from a `file_path` at render time. Images hotlink
 * image.tmdb.org — nothing is proxied or re-hosted, and attribution sits in
 * the footer. */
export function tmdbImage(filePath: string, size = 'w500'): string {
  return `${TMDB_IMAGE_BASE}/${size}${filePath}`;
}

/** Initials tile for series TMDB has no artwork for. This is a design
 * affordance rather than a data fallback: the absence is real, and the tile
 * is how the design chose to draw it. */
export function initialsFor(title: string): string {
  const stop = new Set(['the', 'and', 'of', 'a', 'an', 'de', 'het', 'een']);
  const words = title.split(/\s+/).filter((w) => w && !stop.has(w.toLowerCase().replace(/[^a-z]/g, '')));
  const pick = words.length ? words : title.split(/\s+/);
  return pick
    .slice(0, 2)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
    .join('')
    .toUpperCase();
}

/** "1997–2005", of "1997–heden" als de reeks nog loopt. */
export function yearRangeLabel(from: number, to: number): string {
  const currentYear = new Date().getUTCFullYear();
  return `${from}–${to >= currentYear ? 'heden' : to}`;
}

/** The design shows an em dash rather than "0 EP" for a series whose aired
 * count is unknown. */
export function episodeCountLabel(count: number): string {
  return count > 0 ? `${count} AFL.` : '— AFL.';
}

/** ISO dates come out of TMDB; the design renders them short and readable. */
export function formatAirDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function countryLabel(country: string): string {
  return ({ NL: 'Nederland', BE: 'België', GB: 'Verenigd Koninkrijk', US: 'Verenigde Staten' } as Record<string, string>)[country]
    ?? country;
}

export function languageLabel(language: string): string {
  return ({ nl: 'Nederlands', en: 'Engels' } as Record<string, string>)[language]
    ?? language.toUpperCase();
}

export function broadcastTypeLabel(type: string): string {
  return ({
    Episode: 'Aflevering',
    Movie: 'Film',
    NetworkIdent: 'Zenderleader',
    ShowBumper: 'Programmaleader',
    Commercial: 'Reclame',
    CommercialBlock: 'Reclameblok',
    Promo: 'Promo',
    Trailer: 'Trailer',
    Interstitial: 'Tussendoortje',
  } as Record<string, string>)[type] ?? type;
}
