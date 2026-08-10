# oldcartoons.watch

A teletext/CRT-styled TV guide for classic cartoons and kids' TV. It indexes
archived television series and plays them through embedded YouTube uploads from
rights-holder channels.

**It hosts no video.** Every playback path is a `youtube-nocookie` embed.

The UI came from a design handoff produced in Claude Design; the original bundle
(prototype HTML/CSS/JS, chat transcript, notes) is kept in [`design/`](./design)
for reference.

## The governing idea

Every network call happens at build time or in CI. There is no backend, no
database, and no runtime call to YouTube or TMDB for data. The deployed app
reads JSON that was generated before deploy — **if a value is not in that JSON
at request time, it does not exist.**

That is why there are no defensive checks in components. `scripts/build-data.ts`
validates everything against Zod and throws; anything that reaches
`public/data/` has already passed the gate. There are no fallback data paths: if
a fetch fails, it throws rather than rendering a quietly smaller archive.

## Stack

Vue 3 (`<script setup lang="ts">`) + TypeScript + Vite, Pinia for state,
vue-router, Zod at the build gate. No CSS framework — scoped component styles
matching the design's teletext/CRT look (Oswald / Inter / IBM Plex Mono).

## Data model

Two committed directories matter. Everything else is regenerable cache.

```
content/networks.json    broadcasters — hand-curated, closed set
content/series.json      curated series list: slug, tmdbId, network, type, age
content/episodes.json    curated YouTube ↔ TMDB matches
content/overrides.json   sparse hand-authored corrections to TMDB metadata
content/channels.json    whitelisted rights-holder channels
content/playlists.json   whitelisted third-party playlists
content/queue.json       unresolved matches awaiting a human

data/tmdb/{id}.json      cached TMDB responses    — gitignored, disposable
data/youtube/{id}.json   cached source dumps      — gitignored, disposable
public/data/*.json       generated output         — gitignored, rebuilt on build
```

Overrides are merged shallow at build time (`{ ...tmdb, ...override }`) and hold
only the keys that differ from TMDB, so anything absent keeps tracking TMDB on
the next fetch. Every override key must exist on the series object or the build
fails — that catches typos and surfaces TMDB schema changes instead of letting a
stale override sit silently unapplied.

## Getting started

```sh
npm install
npm run build-data   # generate public/data/ from content/
npm run dev
```

`npm run build` runs `build-data` and `typecheck` before `vite build`, so the
Zod gate runs on every production build.

### API keys

Build-time only — see [`.env.example`](./.env.example). The app never reads
them; only `scripts/` and CI do.

```sh
TMDB_API_KEY=...      # npm run fetch
YOUTUBE_API_KEY=...   # npm run fetch, npm run health-check
```

## Pipeline

Three scripts, run in order, each writing forward only.

```sh
npm run fetch        # channels.list → playlistItems.list; TMDB detail/seasons/images → data/
npm run match        # fuzzy-match upload titles to TMDB episodes → episodes.json + queue.json
npm run build-data   # merge, validate, split → public/data/
```

`match` resolves roughly 60% automatically and queues the rest. That ratio is
the design, not a shortfall — heuristics chasing the tail cost more to maintain
than the keystrokes they save. It never overwrites an existing decision.

Quota is 10,000 units/day. `playlistItems.list` and `videos.list` cost 1 unit
per call, so a full refetch of thirty channels lands well under a thousand.

## Curation policy

Rights-holder channels are whitelisted **by hand, one time**. Enumerating a
channel's uploads gives thousands of episodes that will not disappear, whereas
fan uploads rot constantly and turn the index into a maintenance treadmill.
Prioritising official sources is also what keeps the project on defensible
ground. There is deliberately **no general YouTube search ingest.**

### Third-party playlists

A third party with a ready-made playlist only has to hand over its id.
`content/playlists.json` whitelists it with attribution and a `covers` list of
series slugs, and `fetch.ts` ingests it through the identical path as a channel
— same endpoint, same per-page cost, same matching, same Zod gate.

Two things keep that safe. A playlist is **scoped** by `covers`, so it cannot
pull in series it has no business matching. And every episode records
**provenance** (`source: { kind: 'channel' | 'playlist', id }`), because a
curated playlist can point at fan uploads that rot in a way a rights-holder
channel does not — provenance makes a rotting source visible and lets it be
dropped as a unit.

#### Importing one

```sh
npm run add-playlist -- "<youtube url or playlist id>" --covers heman,spc
```

**The URL must contain `list=`.** Copying the address bar while watching a
video gives `watch?v=…`, which is a *video* id and identifies no playlist —
open the video from inside the playlist and the URL becomes `…&list=PL…`. The
script rejects a URL without it rather than importing something inert.

It also refuses auto-generated `RD…` mixes (built per viewer, not a stable
list), duplicate ids, and any `--covers` slug not in `content/series.json`.
`name` and `curator` are looked up via `playlists.list` (1 quota unit); with no
`YOUTUBE_API_KEY` set, pass `--name` and `--curator` instead.

`--covers` is required and must name at least one series. An unscoped playlist
is not a looser playlist — `match.ts` scopes with `covers.includes(slug)`, so
an empty list ingests and then matches nothing.

Then, since matching compares upload titles against **TMDB episode titles**,
the covered series needs real TMDB metadata — a real positive `tmdbId` in
`content/series.json`, not a seed placeholder:

```sh
npm run fetch -- --series heman   # --series scopes the TMDB half of the run
npm run match
npm run dev                       # /admin to resolve whatever was queued
npm run build-data
```

`--series` exists so a single series can be brought up without first resolving
a real TMDB id for all the others.

## Admin

Dev-only, at `/admin`. The route is registered under `import.meta.env.DEV` and
its write endpoint is a Vite dev-server middleware, so neither exists in a
production build — there is nothing to authenticate at runtime.

Two modes, keyboard-driven, one decision per keystroke (`↑↓` move, `←→` change
entry/image, `⏎` select, `s` skip):

- **Match** — reads `queue.json`, TMDB episode left, candidate uploads right,
  writes `episodes.json`.
- **Metadata** — textless backdrop candidates in a grid (filtered on
  `iso_639_1: null`, because the design sets titles in display type over the
  image), plus a form for the text fields. Writes `overrides.json`.

It is not general CRUD. Anything off the critical path of "resolve one ambiguity
fast" is faster as a script.

## Health check

`.github/workflows/health-check.yml` runs weekly. An id absent from
`videos.list` means the video is gone; `status.embeddable: false` means the
player will refuse to load it. Both flip the episode to `missing` and stamp
`checkedAt`.

The action opens a **pull request** rather than pushing. Dead episodes should be
reviewable, not silently mutated in production.

Region-locking is detected at ingest from `contentDetails.regionRestriction`,
never at render. Region-locked episodes stay playable and are labelled.

## Routes

```
/                                schedule grid — decades × networks
/network/:slug                   one broadcaster, chronological
/series/:slug                    hero, season tabs, episode rows
/series/:slug/:season/:episode   player with persistent episode rail
```

The schedule loads `index.json` only. Series and episode routes load
`series-{slug}.json` on entry — the archive is thousands of episodes and the
grid only needs stubs, so there is never one combined file.

Season and episode are **real numbers**, not array indices: the URL is the
episode's identity and has to survive TMDB reordering a season.

## Playback

Autoplay advances to the next playable episode **within the season**. When the
season ends, it stops — a season boundary is a deliberate stopping point.

Episodes with status `missing` keep their row, title and air date but have no
link. The gap is information; it is shown rather than hidden. Availability is
always visible before a click, never discovered after one.

## Current state of this checkout

The 36 series and 8 networks in `content/` are **seeded from the design
prototype's sample data**, so the app builds and runs today without API keys.
Two things follow from that:

- **`content/episodes.json` is empty**, so every episode renders as a gap.
  Nothing has been matched against a real upload yet, and nothing claims to be
  playable. An empty file is the correct starting state, not a missing one:
  a record means a decision was made about that episode, so writing
  placeholder rows for unexamined episodes would mark them decided and exclude
  them from every future `match` run.
- Every series carries a **negative placeholder `tmdbId`**, which `fetch.ts`
  refuses outright. A plausible-looking positive id would make a mis-seeded
  series quietly fetch the wrong show.

To go live: resolve the real TMDB ids in `content/series.json`, whitelist
sources in `content/channels.json` (and any playlists via `add-playlist`), then
run `fetch` → `match` → `build-data`.

## Attribution

Series and episode metadata from [TMDB](https://www.themoviedb.org/). This
product uses the TMDB API but is not endorsed or certified by TMDB. Images
hotlink `image.tmdb.org` and are never proxied or re-hosted.

The marks in `public/networks/` are hand-drawn monograms, deliberately **not**
the broadcasters' corporate logos — those are current identities rather than
era-correct ones.
