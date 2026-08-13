# Notes for agents

TV van Toen (oldcartoons.watch) — a Dutch TV guide and live simulator for
classic cartoons. Vue 3 + TypeScript + Vite, no backend, no database.

[`README.md`](./README.md) explains *why* the project is built this way and is
worth reading before changing anything structural. This file is the short
version: what you need in your head to do the routine jobs, and the traps that
cost time if you rediscover them by hand.

## Six facts that change what you do

1. **Every network call happens at build time.** The deployed app reads JSON
   generated before deploy. If a value is not in `public/data/` at request
   time, it does not exist. Components carry no defensive checks — the Zod gate
   in `scripts/build-data.ts` is what makes that safe.
2. **This sandbox cannot reach youtube.com.** The egress proxy blocks it, both
   for `curl` and for `WebFetch`. Do not try to work around it; whitelisting a
   playlist and ingesting it are separable acts, and `.github/workflows/ingest.yml`
   runs the network half on a GitHub runner.
3. **Every series carries a negative placeholder `tmdbId`.** No series has real
   TMDB metadata, so `--covers` ingests and then matches nothing.
   `--episodes-for` is the only route that produces episodes today.
4. **`content/` is hand-curated source; `public/data/` and `data/` are
   generated.** Never hand-edit generated output. `content/episodes.json`,
   `content/queue.json` and `content/tmdb-seed/` are written by the pipeline
   but committed, so they show up in diffs and that is expected.
5. **A broadcast slot is cut from the video's measured length.** Ingest reads it
   (`lengthSeconds` or the thumbnail badge on the public page; `videos.list`
   with an API key) and stores it as `runtimeSeconds` on the metadata seed. Only
   when no source stated one does the schedule fall back to a 22-minute
   editorial slot, and it says so in `metadata.runtimeEstimated`. A slot longer
   than its own video is not a cosmetic error: the live player seeks past the
   end of the file and the viewer gets a black screen with a buffer bar that
   restarts forever.
6. **Language is a safety field, not a label — and a source only sets half of
   it.** A source's `language` is the track that plays by default, and it is
   the only language claim anyone makes by hand. The other half is measured:
   `scan-audio` reads each video's audio tracks into `Episode.audioLanguages`,
   and `build-data.ts` schedules an episode on a channel whose language is in
   *either*. So an English playlist carrying a Nederlandse dub belongs on a
   Dutch station and still gets `--language en`. Marking that playlist `nl`
   would be a lie about every video in it, including the ones with no dub.
   When unsure, pick `en` — the failure is quieter and reversible with one
   field.

## Adding playlists (the common job)

Do this from the repo root, on the session's designated branch.

```sh
# 1. whitelist — one command per playlist
npm run add-playlist -- "<playlist url>" --episodes-for <slug> --language nl|en \
  --note "why this source, in Dutch"

# 2. prove the build gate still passes (no network needed)
npm run build-data

# 3. commit and push; ingest.yml does the rest on a runner
```

**Several playlists may make up one series' list.** Run the command once per
playlist with the same `--episodes-for`; their videos are laid end to end **in
the order content/playlists.json lists them**, and that order is the episode
order. Where a playlist sits in the file is a decision, not a formality — so
whitelist them in the order you want them numbered. A video an earlier playlist
already contributed is dropped rather than numbered twice.

**`--max-duration <seconds>` keeps compilations out.** Playlists of short-form
children's shows routinely mix the episodes with hour-long compilations of
those same episodes. Both are real uploads; only one is an episode, and a
compilation ingested as a row claims a 45-minute slot replaying what the rows
around it already carry. The ceiling cuts on the *measured* length, before
anything is numbered, so the surviving numbers stay contiguous — and a video
whose length the source never stated is kept, because the point is not to
guess. Every cut video is named in the ingest log. Only meaningful alongside
`--episodes-for`; the schema rejects it otherwise.

`--episodes-for` says *the playlist **is** that series' episode list*: playlist
order becomes episode order, video titles become episode titles, and
`content/tmdb-seed/{id}.json` is regenerated from it. That is the route that
works here. `--covers` says *the playlist holds uploads that may match TMDB's
episode list*, which needs a real positive `tmdbId` — nothing has one yet.

What `add-playlist` refuses, all deliberately:

- a URL with no `list=` — a `watch?v=…` or `youtu.be/…` link is a **video** id
  and identifies no playlist. Those go in `content/videos.json` instead; see
  the next section.
- auto-generated `RD…` mixes (built per viewer, not a stable list)
- a duplicate id, or a slug not in `content/series.json`
- `--max-duration` without `--episodes-for` — the candidate-pool path numbers
  TMDB's episodes, never the uploads, so a ceiling there would look like it was
  working and do nothing

The playlist's title and curator are looked up over the network, so here they
land as `null`, meaning *not looked up yet*. That is expected and not an error.

### After pushing

`ingest.yml` fires, pulls the episodes, and commits them back to the same
branch. Then `git pull` and check what actually landed — playlists are often
shorter than they look, and a two-episode playlist is worth mentioning:

```sh
git pull origin <branch> && npm run build-data
node -e "
const i=require('./public/data/index.json');
for (const s of i.series.filter(x=>x.availableCount>0))
  console.log(s.slug.padEnd(24), s.availableCount+'/'+s.episodeCount, s.availableLanguages.join(','));
"
```

## Adding loose videos (no playlist exists)

Some series were never gathered into a playlist by anyone. What exists is a
handful of separate uploads found one at a time. Those go in
`content/videos.json`, hand-written — there is no script, because the ordering
is the thing only a person can supply:

```json
[
  {
    "episodesFor": "why-why-family",
    "language": "nl",
    "videos": ["nNndV-t18mg", "wUgcLmIMahY", "iXQ4OHuDokI"],
    "note": "Losse uploads; van deze serie bestaat geen playlist."
  }
]
```

It makes the same claim `--episodes-for` makes on a playlist — *these videos
**are** that series' episode list* — with the order given by hand. Position is
the episode number, so the order in the array is a decision, not a formality.

Two things differ from a playlist. Titles and lengths are not stated anywhere
in a bare id, so `fetch` resolves each video on its own (one page fetch each
without an API key, one `videos.list` call per fifty with one). And provenance
is **per video**: each episode records `video:<id>` rather than a shared source,
because these videos have nothing in common but the person who chose them, and
any one can rot while the rest keep playing.

A video that cannot be read — private, removed, region-blocked — is reported by
`fetch` and left out, and the rest keep their positions. It is never silently
skipped: dropping it quietly would renumber every episode after it.

One series, one list: a slug may not appear in both `videos.json` and a
playlist's `episodesFor`. Both `match` and the build gate refuse that.

## Playlists whose videos carry a Dutch dub

A YouTube upload can hold more than one audio track — an English original with
a Nederlandse dub beside it — and no part of the Data API will say so.
`snippet.defaultAudioLanguage` names the track that plays by default and stops
there. The list only exists in the watch page's `ytInitialPlayerResponse`, so
`readAudioTrackLanguages` in `scripts/lib/youtube-public.ts` reads it from the
same blob `readWatchPageDuration` already parses, and `scripts/scan-audio-tracks.ts`
walks the archive with it.

Three states, and the middle one is why re-runs are cheap:

| `Episode.audioLanguages` | means |
| --- | --- |
| `null` | not looked up yet — the next run picks it up |
| `[]` | looked up; the page described its streams and named one track |
| `['en','nl']` | the languages on offer, the default one included |

Whitelist such a playlist as `--language en`, because that is the track that
plays. The Dutch comes from the scan, per video, and `build-data.ts` then puts
those episodes on a Dutch station. Both `ingest.yml` and `health-check.yml` run
the scan, so a video that gains a dub later is picked up without anyone asking.

**The remainder to be honest about: an embed cannot choose an audio track.**
There is no player parameter and no IFrame API call for it, and a logged-out
viewer normally gets the upload's original. So a dubbed episode on a Dutch
channel starts in English until the viewer opens the player's own menu.
`src/components/AudioTrackNotice.vue` says so on screen, and the archive marks
these series `dubbed` rather than green — Dutch that plays only after a click
is not a Nederlandse bron, and the call to find one stays open.

## Adding a series that does not exist yet

A playlist can only be scoped to a slug already in `content/series.json`. A new
series needs two things:

1. an entry in `content/series.json` — `slug`, the next unused **negative**
   `tmdbId`, `networkSlug` (its home station), `type`, `age`
2. an identity, in one of two places:
   - `content/historical-series.json` — name, overview, `firstAirYear`,
     `lastAirYear`. Use this when only the years are known. A guide records a
     year, not a date, and this is the honest shape for that.
   - `content/tmdb-seed/{id}.json` — a full TMDB-shaped seed with a real
     `first_air_date`. Use this only when you actually have the date.

Then whitelist the playlist as above. Both kinds can carry a playlist-authored
episode list — see below.

## Where a series' metadata comes from

`scripts/lib/series-metadata.ts` (`loadSeriesCache`) is the single answer, used
by both `match.ts` and `build-data.ts`. Three kinds of series:

| kind | identity from | episodes from |
| --- | --- | --- |
| real TMDB id (positive) | `data/tmdb/{id}.json` (cache, gitignored) | same file |
| seeded id (negative) | `content/tmdb-seed/{id}.json` (committed) | same file |
| guide listing | `content/historical-series.json` | `content/tmdb-seed/{id}.json`, once a playlist writes one |

The third row is the subtle one. A guide says what the show **is**; a playlist
says what its episodes **are**. Identity always wins from the guide — nothing a
playlist writes may overrule the name, overview or years. Before this existed,
a guide listing could never hold episodes and `match.ts` crashed looking for a
seed file that was never going to appear.

## Which channels are shown

A station appears on the channel map, the tab strip and the archive-week list
only while at least one of its programmes has a playable episode
(`stockedNetworks` in `src/stores/content.ts`). Hidden, never deleted: curation
stays in `content/`, and a station returns by itself once a source fills it.

This is about the archive, not the schedule. A network whose episodes exist but
are in the wrong language keeps its card and says "PROGRAMMERING VOLGT" — its
page plays, only its live feed is dark. Gaps worth showing are episode-shaped,
inside a programme, never station-shaped.

## GitHub workflows

| workflow | fires on | what it does |
| --- | --- | --- |
| `ingest.yml` | push to any branch **except Master** touching `content/playlists.json`, `content/channels.json`, `content/videos.json`, `content/series.json`, `scripts/**` or itself; `workflow_dispatch` | `resolve-playlists` → `fetch --youtube-only` → `match` → `scan-audio` → `build-data`, then commits `content/` back to the same branch. This is how an offline environment fills the archive. It pushes with `GITHUB_TOKEN`, so it cannot re-trigger itself. Passes `YOUTUBE_API_KEY`, `TMDB_READONLY_KEY` and `TMDB_API_KEY` through to `fetch`; the TMDB pair is unused while `--youtube-only` stands, and is already wired for when it goes. |
| `build.yml` | push to Master, every pull request, `workflow_dispatch` | `npm run build` — the same three gates Vercel runs (Zod, `vue-tsc`, vite), on a runner that costs nothing to fail. Needs no secrets. |
| `health-check.yml` | weekly cron (Mondays 05:00 UTC), `workflow_dispatch` | Re-checks every matched video, then reads the audio tracks of any it has not read yet. Gone or un-embeddable flips the episode to `missing`. Opens a **pull request** rather than pushing, because removing episodes should be reviewed. |

Because ingest commits with `GITHUB_TOKEN`, bot-written `content/` is validated
when it reaches a pull request, not when it lands on the branch. Expect the
ingest commit to appear on your branch a minute or two after your push, and
re-read the PR body afterwards — anything it said about pending data is now
stale.

## Verifying without network access

`npm run match` cannot run here: it needs `data/youtube/{source}.json` dumps
that only `fetch` can produce. To exercise the whole pipeline anyway, fabricate
the dumps in a throwaway copy of the repo (never in the working tree — `match`
rewrites `content/`):

```sh
cp -r content scripts src package.json tsconfig*.json node_modules "$SCRATCH/probe/"
# write $SCRATCH/probe/data/youtube/{playlistId}.json for each playlist:
#   { fetchedAt, kind: "playlist", id, name, covers: [...], videos: [
#       { youtubeId (11 chars), title, description, publishedAt, durationSeconds }, … ] }
# a hand-picked set is the same shape at videoset-{slug}.json, kind "videos"
cd "$SCRATCH/probe" && npx tsx scripts/match.ts && npx tsx scripts/build-data.ts
```

That catches the failures worth catching — a series whose metadata cannot be
resolved, a schema violation, a channel that stays empty — before a runner
spends a real fetch on it.

## Commands

```sh
npm install
npm run build-data   # generate public/data/ from content/ — safe, offline, run it often
npm run build        # build-data + typecheck + vite build; the full gate
npm run dev          # dev server; /admin exists only here
npm run add-playlist -- "<url>" --episodes-for <slug> --language nl|en
npm run fetch        # needs network
npm run match        # needs data/youtube/ from fetch
npm run scan-audio   # needs network; reads each video's audio tracks (--all, --limit N)
npm run resolve-playlists  # needs network; fills in playlist title + curator
```

## Traps

- **`data/` and `public/data/` are gitignored and disposable.** A fresh clone
  builds without API keys because `content/tmdb-seed/` is committed. Do not
  gitignore that directory by analogy with `data/tmdb/`.
- **`match.ts` overwrites `content/`.** It rewrites `episodes.json`,
  `queue.json` and the seed files of playlist-backed series. Never run it to
  "see what happens" in the working tree.
- **Episode records are decisions.** `match` never overwrites an existing one.
  The exception is a source-derived series — playlist or hand-picked set —
  whose whole list is rebuilt every run. That is what lets a playlist that
  gained episodes, or a video added to a set, show up on a re-run.
- **`resolve-playlists` currently resolves nothing.** It fails to read title and
  owner from the public playlist page for every unattributed playlist, while
  `fetch` reads the same page for videos successfully — so it is the
  title/owner branch of `scripts/lib/youtube-public.ts` aiming at a page shape
  YouTube no longer serves, not a network problem. Setting a `YOUTUBE_API_KEY`
  repository secret bypasses it entirely; `ingest.yml` already passes it
  through. Patching the scraper blind from a machine with no route to
  youtube.com is not worth it.
- **The public-page fallback refuses partial playlists.** It throws when it hits
  the continuation YouTube will not serve unauthenticated, because a playlist
  truncated at ~100 is a *wrong* episode list rather than a shorter one. A
  playlist reporting exactly 100 items passed that guard and is complete as far
  as the page shows.
- **UI text is Dutch.** Headings, labels, notes and commit messages follow the
  existing files; code, comments and this documentation are English.
