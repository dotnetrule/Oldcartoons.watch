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
6. **Language is a safety field, not a label.** `build-data.ts` only schedules
   an episode on a channel whose language matches. Marking an English playlist
   `nl` puts English audio on a Dutch station; marking a Dutch one `en` only
   keeps it out of the schedule. When unsure, pick `en` — the failure is
   quieter and reversible with one field.

## Adding playlists (the common job)

Do this from the repo root, on the session's designated branch.

```sh
# 1. whitelist — one command per playlist, one series each
npm run add-playlist -- "<playlist url>" --episodes-for <slug> --language nl|en \
  --note "why this source, in Dutch"

# 2. prove the build gate still passes (no network needed)
npm run build-data

# 3. commit and push; ingest.yml does the rest on a runner
```

`--episodes-for` says *the playlist **is** that series' episode list*: playlist
order becomes episode order, video titles become episode titles, and
`content/tmdb-seed/{id}.json` is regenerated from it. That is the route that
works here. `--covers` says *the playlist holds uploads that may match TMDB's
episode list*, which needs a real positive `tmdbId` — nothing has one yet.

What `add-playlist` refuses, all deliberately:

- a URL with no `list=` — a `watch?v=…` link is a **video** id and identifies no
  playlist. There is no path for a single video: `content/episodes.json`
  requires provenance from a whitelisted playlist or channel. Ask for a
  playlist link instead of inventing one.
- auto-generated `RD…` mixes (built per viewer, not a stable list)
- a duplicate id, or a slug not in `content/series.json`
- a second playlist claiming a series whose list another one already owns

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
| `ingest.yml` | push to any branch **except Master** touching `content/playlists.json`, `content/channels.json`, `content/series.json`, `scripts/**` or itself; `workflow_dispatch` | `resolve-playlists` → `fetch --youtube-only` → `match` → `build-data`, then commits `content/` back to the same branch. This is how an offline environment fills the archive. It pushes with `GITHUB_TOKEN`, so it cannot re-trigger itself. |
| `build.yml` | push to Master, every pull request, `workflow_dispatch` | `npm run build` — the same three gates Vercel runs (Zod, `vue-tsc`, vite), on a runner that costs nothing to fail. Needs no secrets. |
| `health-check.yml` | weekly cron (Mondays 05:00 UTC), `workflow_dispatch` | Re-checks every matched video. Gone or un-embeddable flips the episode to `missing`. Opens a **pull request** rather than pushing, because removing episodes should be reviewed. |

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
#       { youtubeId (11 chars), title, description, publishedAt }, … ] }
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
  The exception is a playlist-derived series, whose whole list is rebuilt every
  run — that is what lets a playlist that gained episodes show up.
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
