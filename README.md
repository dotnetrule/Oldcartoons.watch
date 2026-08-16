# TV van Toen
# new push test
De Nederlandse tv-gids en live simulator voor klassieke tekenfilms en
jeugdtelevisie, bereikbaar via oldcartoons.watch. TV van Toen zet
Nederlandstalige zenders en hun programmering voorop, bouwt vaste speelschema’s
uit het archief en speelt de actuele uitzending via een YouTube-embed.

De publieke zenderselectie is gebaseerd op de
[TV Home-zenderkaart van september 2005](https://www.digitalekabeltelevisie.nl/nieuws/archives/pdf/tvhomezenderkaarokt2005.pdf):
de Nederlandse basiszenders staan op de historische posities 1–10.
Vlaamse, buitenlandse en fictieve archiefcategorieën blijven buiten deze
selectie.

**It hosts no video.** Every playback path is a `youtube-nocookie` embed.

The UI came from a design handoff produced in Claude Design; the original bundle
(prototype HTML/CSS/JS, chat transcript, notes) is kept in [`design/`](./design)
for reference.

This README explains why the project is built the way it is.
[`AGENTS.md`](./AGENTS.md) is the working brief for anyone — human or agent —
doing the routine jobs: adding playlists, adding a series, and what the CI
workflows do on their behalf.

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
content/broadcast-channels.json viewer-facing regional/historical TV feeds
content/network-programmes.json series shown on each Dutch channel; duplicates allowed
content/series.json      curated series list: slug, tmdbId, network, type, age
content/episodes.json    curated YouTube ↔ TMDB matches
content/overrides.json   sparse hand-authored corrections to TMDB metadata
content/channels.json    whitelisted rights-holder channels
content/playlists.json   whitelisted third-party playlists
content/videos.json      hand-picked individual videos, where no playlist exists
content/queue.json       unresolved matches awaiting a human
content/tmdb-seed/       stand-in metadata for series with no real TMDB id yet

data/tmdb/{id}.json      cached TMDB responses    — gitignored, disposable
data/youtube/{id}.json   cached source dumps      — gitignored, disposable
public/data/*.json       generated output         — gitignored, rebuilt on build
```

## Broadcast engine

The live player never selects an episode. Its input is a channel id and a
timestamp; `src/broadcast/engine.ts` resolves those through the channel's
generated schedule into one broadcast, one media asset, and an exact media
offset. The same function feeds the network Now/Next panel, the daily EPG, and
the player, so those surfaces cannot disagree about what is on air.

`scripts/build-data.ts` matches the language of every validated playable
episode to the language of its regional channel, round-robins the result into a
gapless repeating schedule and writes it to `public/data/broadcast.json`. A
Dutch feed therefore never silently switches to an English upload. Its anchor,
slot order and durations are stable, so a timestamp produces the same result
for every viewer and a rebuild introduces no random programming changes.

Each channel also gets a second, wider line-up built from the same network
without that language filter, written to `public/data/broadcast-open.json`. A
viewer chooses between the two, and the choice is remembered; the station's own
line-up is the default. This is two generated timelines rather than one filter,
because a schedule is an absolute running order — a per-viewer setting can hide
a programme the way the age ceiling does, but it cannot conjure one. The wider
feeds are a separate payload so that the viewer who never asks for them never
downloads them, and a slot there is labelled with the language the video
actually carries, so widening the line-up adds programmes without ever claiming
a dub that does not exist.

Viewer-facing broadcast channels are deliberately separate from
`content/channels.json`: the latter remains the whitelist of YouTube ingest
sources. A broadcast channel can exist with a null schedule while its media
archive is still pending; the UI identifies that state instead of fabricating
a fallback programme.

### Only real stations appear as stations

The channel map on the front page is a claim about what was actually on air in
2005, so two fields keep invented channels out of it and the build gate
enforces both.

`real` on a network says a broadcaster of that name went on air. The catalogue
also holds bookkeeping buckets — `syndication` collects material with no
established channel — and those are not stations. A network that is not `real`
cannot be `listed` and cannot own a broadcast channel; either one fails the
build rather than reaching a viewer as a station.

`kind` on a broadcast channel separates the one feed that stands for a network
(`primary`) from a preserved week of that same network's real schedule
(`archive`). Fox Kids' 2001 and 2004 weeks are two more views of channel 8, not
two more channels, so the map draws one card per `primary` feed and the weeks
are listed apart from it, each labelled with the station it came off. Exactly
one primary per network is a build rule.

### And only stations with something to show

Being a real station earns a place in `content/`, not a card on the map. A
station is drawn only while at least one of its programmes has a playable
episode — `stockedNetworks` in `src/stores/content.ts` — and disappears from
the channel map, the tab strip and the archive-week list until then.

That is a rule about the archive, not about the schedule. A network whose
episodes exist but are not in its own language keeps its card: its page lists
programmes that play, and only its live feed is still dark, which the card says
in as many words. A network where nothing plays at all has no such page to
offer, and a card that never lights up reads as a broken channel rather than an
honest gap — the gaps worth showing are episode-shaped, inside a programme, not
station-shaped.

Curation stays in `content/`: a station that empties out is hidden rather than
deleted, and comes back by itself the moment a source fills it in.

Network marks in `public/networks/` are identification plates — the station's
real name and on-air colour, set in a neutral condensed face — rather than
reproductions of the broadcasters' own logos. They carry their own colours, so
nothing inverts them for the dark theme: a station's colour is part of what
identifies it. `src/components/NetworkLogo.vue` is the only thing that renders
one. Dropping a licensed logo file in over any plate needs no other change.

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
TMDB_API_TOKEN=...    # npm run enrich-tmdb, npm run fetch (recommended)
TMDB_READ_ONLY_KEY=... # accepted alias for the read token
TMDB_API_KEY=...      # alternative TMDB v3 key
YOUTUBE_API_KEY=...   # npm run fetch, npm run health-check
```

Placeholder series keep their negative ids because those ids own the curated
episode lists. `npm run enrich-tmdb` safely matches their catalogue title and
air year, fetches localized descriptions, genres, posters and textless
backdrops, and writes the refreshable result to `content/tmdb-metadata.json`.
Ambiguous matches are reported and left unchanged; set a reviewed result with
`npm run enrich-tmdb -- --match slug=1234`. This step reads `.env` locally, and
the generated static app receives only image paths and public metadata.

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

#### Several playlists, one episode list

A curator rarely gathers a whole show into a single list. One holds the first
two seasons and another the rest; a rights-holder splits its uploads across two
lists years apart. Turning the second one away leaves real episodes out of the
archive, so more than one playlist may name the same series in `episodesFor`.

What made two owners a problem was never the count — it was the ordering. Two
lists are two sequences, and merging them by upload date or title would pick an
episode order nobody chose. So the order is **stated rather than inferred**:
the playlists are laid end to end in the order `content/playlists.json` lists
them, exactly as the array order in `content/videos.json` is the episode order
there. Where a playlist sits in the file is a decision. A video an earlier
playlist already contributed is dropped rather than numbered a second time,
which is what keeps two overlapping lists from shifting every episode after the
overlap.

Provenance stays per playlist even when several make one list: each episode
records the playlist it actually came from, so one list rotting is still
droppable as a unit while the others keep playing.

#### Compilations are not episodes

Playlists of short-form children's shows routinely mix the episodes with
hour-long compilations of those same episodes. Both are legitimate uploads and
only one of them is an episode: ingested as a row, a compilation claims a
45-minute broadcast slot and replays material the rows around it already carry.

`maxDurationSeconds` on a playlist is the cut. It compares against the video's
**measured** length — the same figure the broadcast slot is cut from, read from
the source rather than guessed — and it applies before anything is numbered, so
the surviving episode numbers run 1, 2, 3 with no hole where a compilation used
to be. A video whose length the source never stated is kept rather than
dropped: filtering on a length nobody reported would be exactly the guess this
is here to avoid. Every cut video is named in the ingest log, because a cut
list nobody mentions is indistinguishable from a playlist that was always this
short.

#### A guide listing can acquire an episode list

`content/historical-series.json` holds titles lifted from historical Dutch TV
guides: the show's name, what it was, and the years it ran. A guide records a
year rather than a date, and says nothing whatever about episodes, so a listing
starts with an empty one and its page is a catalogue entry.

That is a statement about the guide, not a ceiling on the series. A guide says
what the show **is**; a curated playlist says what its episodes **are**, and
`--episodes-for` works on a listing exactly as it does on a seeded series.
`scripts/lib/series-metadata.ts` is the single place both `match.ts` and
`build-data.ts` ask where a series' metadata comes from: identity always from
the guide, episodes from `content/tmdb-seed/{id}.json` once a playlist has
written one. A playlist knows the order of a show's episodes and does not know
the show, so nothing it writes may overrule the name, description or years the
guide recorded.

Unlike a matched or hand-resolved episode, a playlist-derived one is **not** a
final decision: the decision lives in the playlist and is re-read on every run,
so re-running the pipeline picks up a playlist that gained or reordered
episodes. One series' list may be owned by at most one playlist.

#### When no playlist exists at all

Some series were never gathered into a playlist by anybody. What survives is a
handful of separate uploads, found one at a time, and `add-playlist` rightly
refuses a `watch?v=…` link — it names a video and not a playlist.

`content/videos.json` is where those go: a series slug, a language, and the
video ids in the order they should be numbered. It makes the same claim
`--episodes-for` makes, with the ordering supplied by hand rather than by a
curator, and it is hand-written rather than scripted because that ordering is
the only part a machine cannot supply.

Two things follow from the videos having nothing in common but the person who
chose them. A bare id states neither a title nor a length, so ingest resolves
each video on its own — one page read apiece without a key, one `videos.list`
call per fifty with one. And provenance is recorded **per video** rather than
per source: `video:<id>` on every episode, because any one of them can rot
while the rest keep playing, and the health check should be able to drop it
alone.

A video that cannot be read is named and left out rather than quietly skipped.
Its position is an episode number, so closing the gap silently would renumber
every episode after it and point each at the wrong video.

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

#### When the machine cannot reach YouTube

Whitelisting a playlist and ingesting it are separable acts, because the id is
the only part of a playlist a person actually has — it is sitting in the link
they pasted. The title and curator credit live on YouTube.

So `add-playlist` no longer refuses when it cannot reach them. It writes the
entry with `name` and `curator` as `null`, meaning *not looked up yet* rather
than *has no title*, and says so. Anywhere with a route to youtube.com then
completes it:

```sh
npm run resolve-playlists
```

That is the one script that deliberately mutates `content/` in place. Filling a
known gap in a record that already exists is a different act from `fetch`
quietly rewriting curated data behind you, which is why it is its own named
step rather than a side effect of the pipeline.

`.github/workflows/ingest.yml` runs the whole thing on GitHub's runners when a
push changes an ingest whitelist, and commits the derived episodes back to the
same branch — so an environment that can edit `content/` but not reach YouTube
can still fill the archive in. It never runs on `Master`.

`npm run fetch -- --youtube-only` skips the TMDB half outright, which is what
an archive built entirely from playlists needs: every series here still carries
a placeholder id, and the TMDB half refuses those by design.

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
/                                        zenders en volledige programmering
/zender/:slug                            één zender met liveblok en archief
/kijken/:channelId                       live speler voor een regionale feed
/programma/:slug                         programma, seizoenen en afleveringen
/programma/:slug/:season/:episode        speler met vaste afleveringslijst
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

The 118 series and 15 source networks in `content/` are seeded so the app builds
and runs today without API keys. `network-programmes.json` projects that
catalogue onto the ten public Dutch channels: a series can occur on several
channels and remains listed when it has no episodes. Twenty-eight curated
playlists and one hand-picked video set are whitelisted; every remaining gap
stays visible instead of being presented as available.

Twenty of those playlists are already ingested and provide 589 playable
episodes. Anything added since carries only its ids — this checkout has no route
to youtube.com, so `.github/workflows/ingest.yml` resolves the titles and pulls
the episodes in on a runner. Until that lands, the stations they fill stay
hidden by the rule above rather than appearing empty.

Every series carries a **negative placeholder `tmdbId`**, which `fetch.ts`
refuses outright. A plausible-looking positive id would make a mis-seeded
series quietly fetch the wrong show.

This is also why `--covers` cannot fill a seeded series in yet: there is no real
TMDB episode list to match uploads against. `--episodes-for` is the route that
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
