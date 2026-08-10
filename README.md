# oldcartoons.watch

A teletext/CRT-styled TV guide for classic cartoons and kids' TV — schedule
grid, broadcaster pages, series pages, and a video player, with light/dark
themes, NL·BE / USA region switching, and NL/FR/EN localization.

This is the real Vue implementation, built from a design handoff produced in
Claude Design. The original design bundle (prototype HTML/CSS/JS, chat
transcript, design notes) is kept in [`design/`](./design) for reference.

## Stack

- [Vue 3](https://vuejs.org/) (`<script setup>` SFCs) + [Vite](https://vitejs.dev/)
- [vue-router](https://router.vuejs.org/) — one route per screen:
  - `/` — schedule grid
  - `/broadcaster/:id` — broadcaster page
  - `/series/:id` — series page
  - `/watch/:seriesId/:season/:episode` — player
- No UI framework/CSS library — scoped component styles, matching the
  original design's teletext/CRT look (Oswald/Inter/IBM Plex Mono).

## Getting started

```sh
npm install
npm run dev       # start the dev server
npm run build      # production build to dist/
npm run preview    # preview the production build locally
```

## TMDB integration

Show/episode artwork and synopses can be enriched from
[TMDB](https://www.themoviedb.org/) at runtime. Copy `.env.example` to `.env`
and set your API key:

```sh
cp .env.example .env
# then edit .env:
# VITE_TMDB_API_KEY=your_key_here
```

Get a free key at https://www.themoviedb.org/settings/api.

**Without a key**, the app runs fully on the bundled sample data
(`src/data/series.js`, `src/data/networks.js`) — real network/show names with
placeholder episode details — and every `<CoverImage>` falls back to a
teletext-style initials tile instead of a photo. This is the current state
of this checkout: no key is configured yet.

The TMDB client (`src/services/tmdb.js`) is best-effort and never throws —
a missing key, a failed lookup, or an API error all just fall back to the
sample data.

## Project structure

```
src/
  data/            sample data ported from the design prototype
    themes.js        color tokens, regions, langs, view/theme options
    networks.js       broadcaster info per region
    series.js         shows/seasons/episodes per region
    i18n.js            NL/FR/EN copy
    helpers.js         season/episode synthesis, initials, date padding
  services/
    tmdb.js           TMDB API client (search, details, season episodes)
  composables/
    useAppState.js    shared reactive state: region, lang, theme, view mode,
                       filters, hover preview, reported links, player state
  components/
    HeaderBar.vue      logo + theme/view/region/lang switchers + page code
    ChannelTabs.vue    horizontal broadcaster tab strip
    CoverImage.vue     TMDB-backed artwork with an initials-tile fallback
  views/
    ScheduleView.vue    desktop grid + mobile list + type/age filters + hover preview dock
    BroadcasterView.vue listings/covers for one network
    SeriesView.vue       hero, synopsis, seasons, episode list
    PlayerView.vue       mocked video chrome, up-next rail, season rail
```

## Notes on the port

- The original design's `image-slot.js` component is a proprietary editor
  widget (drag-and-drop placeholder tied to the Claude Design tool's local
  sidecar file) and isn't meaningful in a real deployed app. It's replaced
  by `CoverImage.vue`, which shows real TMDB artwork when available and a
  themed initials tile otherwise.
- The design prototype's `N()` network helper never actually set a `name`
  field (a bug in the prototype — `net.name` rendered blank throughout).
  `src/data/networks.js` fixes this with the real broadcaster names.
- State (region/lang/theme/view mode) persists to `localStorage` and screens
  have real URLs via vue-router, both upgrades from the prototype's
  in-memory single-page state — reasonable for a real site with shareable
  links and reload persistence.
