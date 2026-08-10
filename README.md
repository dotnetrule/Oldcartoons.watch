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
content/tmdb-seed/       stand-in metadata for series with no real TMDB id yet

data/tmdb/{id}.json      cached TMDB responses    — gitignored, disposable
data/youtube/{id}.json   cached source dumps      — gitignored, disposable
public/data/*.json       generated output         — gitignored, rebuilt on build
```

`content/tmdb-seed/` and `data/tmdb/` look alike and are not. The latter is a
real cache — a real TMDB response for a real id, rebuildable by `npm run fetch`,
so gitignoring it costs nothing. The former covers series with **no real TMDB
id**, so there is nothing to re-fetch and nothing to rebuild it from; it is
hand-authored source data that happens to be TMDB-shaped, and a fresh clone
needs it to build without API keys. `scripts/lib/paths.ts` picks between them
on the sign of the id.

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

#### Two things a playlist can be

A playlist is whitelisted as one of two things, and picking the wrong one is
the difference between a full series page and a page of gaps.

`--covers` says the playlist **holds uploads that may match** those series'
episodes. Matching compares upload titles against **TMDB episode titles**, so
this only produces rows for a series that already has real TMDB metadata — a
real positive `tmdbId` in `content/series.json`, not a seed placeholder. Point
it at a series carrying a placeholder id and the ingest succeeds, the videos
cache, and nothing matches, because there is no episode list on the other side
of the comparison.

`--episodes-for` says the playlist **is** that series' episode list. Playlist
order becomes episode order, video titles become episode titles, and
`content/tmdb-seed/{id}.json` is regenerated from the playlist — no TMDB, no
key, no matching. That is the right answer for a series with no real TMDB id,
which is every series in this checkout.

What it deliberately does not invent: an upload date is not an air date, and a
playlist carries no runtime, so both stay empty rather than becoming
plausible-looking wrong values. A curated playlist is a flat ordered list — it
asserts sequence and nothing about season boundaries — so everything lands in
season 1.

Unlike a matched or hand-resolved episode, a playlist-derived one is **not** a
final decision: the decision lives in the playlist and is re-read on every run,
so re-running the pipeline picks up a playlist that gained or reordered
episodes. One series' list may be owned by at most one playlist.

#### Importing one

```sh
# the playlist IS the series' episode list — no TMDB needed
npm run add-playlist -- "<youtube url or playlist id>" --episodes-for spc
npm run fetch && npm run match && npm run build-data

# the playlist is a pool of candidates for series TMDB already describes
npm run add-playlist -- "<youtube url or playlist id>" --covers heman,spc
```

`--episodes-for` implies `--covers`, so a single-series playlist needs one flag.

**The URL must contain `list=`.** Copying the address bar while watching a
video gives `watch?v=…`, which is a *video* id and identifies no playlist —
open the video from inside the playlist and the URL becomes `…&list=PL…`. The
script rejects a URL without it rather than importing something inert.

It also refuses auto-generated `RD…` mixes (built per viewer, not a stable
list), duplicate ids, and any slug not in `content/series.json`.

Scoping is required either way. An unscoped playlist is not a looser playlist —
`match.ts` scopes with `covers.includes(slug)`, so an empty list ingests and
then matches nothing.

For the `--covers` route, bring the covered series' TMDB metadata up first:

```sh
npm run fetch -- --series heman   # --series scopes the TMDB half of the run
npm run match
npm run dev                       # /admin to resolve whatever was queued
npm run build-data
```

`--series` exists so a single series can be brought up without first resolving
a real TMDB id for all the others. A series whose list comes from
`--episodes-for` is skipped by the TMDB half entirely — there is nothing to
fetch.

#### Without an API key

`YOUTUBE_API_KEY` is still the better path: the Data API is paginated,
documented and complete. But requiring a Google Cloud project before a pasted
link can produce one episode row is friction the archive does not need, so with
no key set, `add-playlist` and `fetch` read the playlist's own public page
instead.

The fallback refuses to return a **partial** playlist. The public page serves
roughly the first hundred items and hands the rest to a continuation it will
not answer unauthenticated; hitting that limit throws and names the key, because
a playlist truncated at 100 is a wrong episode list rather than a shorter one.
Channels still need the key — `channels.list` has no page to read.

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

  This is also why `--covers` cannot fill a series in yet: there is no real
  episode list to match uploads against. `--episodes-for` is the route that
  works today, because it does not need one.

To go live, either route works per series:

```sh
# from a curated playlist, no keys required
npm run add-playlist -- "<playlist url>" --episodes-for <slug>
npm run fetch && npm run match && npm run build-data

# from TMDB plus rights-holder channels
# resolve the real tmdbId in content/series.json, whitelist the channel, then
npm run fetch && npm run match && npm run build-data
```

## Attribution

Series and episode metadata from [TMDB](https://www.themoviedb.org/). This
product uses the TMDB API but is not endorsed or certified by TMDB. Images
hotlink `image.tmdb.org` and are never proxied or re-hosted.

The marks in `public/networks/` are hand-drawn monograms, deliberately **not**
the broadcasters' corporate logos — those are current identities rather than
era-correct ones.
