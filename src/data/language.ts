/**
 * The viewer's line-up setting, and the one question it answers.
 *
 * The archive is Dutch-first: a station broadcasts what it can carry in its own
 * language, and everything else the archive holds for that network sits on the
 * series pages, reachable on demand but never on air. This setting is how a
 * viewer asks for the rest of it.
 *
 * It is a **choice between two schedules**, not a filter over one. `build-data`
 * emits both — the station's own line-up and the same network without the
 * language filter — because a schedule is an absolute running order. The age
 * ceiling can hide a slot at runtime; nothing can conjure one, and thinning the
 * wide feed back down to Dutch would leave the default viewer watching skip
 * cards instead of television.
 */

/** `'dutch'` is the station as it broadcast: the default, and the premise. */
export type ChannelLanguageMode = 'dutch' | 'all';

export const LANGUAGE_OPTS: { id: ChannelLanguageMode; label: string }[] = [
  { id: 'dutch', label: 'NEDERLANDS' },
  { id: 'all', label: 'ALLES' },
];

/** Persist only values the chips can represent, so a stray stored value cannot
 * leave every chip looking inactive over a setting that is really in force. */
export const LANGUAGE_MODES: readonly ChannelLanguageMode[] = LANGUAGE_OPTS.map(
  (option) => option.id,
);

/** The setting's own voice, kept in one place so the header, the drawer and the
 * players word it the same way. */
export const LANGUAGE_COPY = {
  chipGroup: 'Uitzendingen',
  label: 'TAAL',
  drawerHeading: 'UITZENDINGEN',
  /** Reads under the drawer heading. */
  drawerHint:
    'Nederlands houdt iedere zender bij wat hij in het Nederlands kan uitzenden. Alles neemt ook de anderstalige programma’s van die zender op in de programmering.',
  audioButton: 'NL-audio',
  subtitleButton: 'NL-ondertiteling',
  subtitleButtonOff: 'Ondertiteling uit',
  audio: {
    switched: 'Nederlands audiospoor aangezet.',
    already: 'Deze aflevering speelt al in het Nederlands.',
    unavailable: 'Deze aflevering heeft geen Nederlands audiospoor.',
    unsupported: 'De speler geeft zijn audiosporen niet prijs. Kies in de speler het tandwiel → “Audiotrack”.',
  },
  subtitles: {
    switched: 'Nederlandse ondertiteling aangezet.',
    already: 'Nederlandse ondertiteling stond al aan.',
    translated: 'Automatisch vertaalde Nederlandse ondertiteling aangezet.',
    unavailable: 'Voor deze aflevering is geen Nederlandse ondertiteling beschikbaar.',
    unsupported: 'De speler geeft zijn ondertiteling niet prijs. Kies in de speler het tandwiel → “Ondertiteling”.',
    off: 'Ondertiteling uitgezet.',
  },
} as const;
