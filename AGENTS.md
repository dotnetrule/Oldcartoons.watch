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
3. **Every series carries a negative placeholder `tmdbId`, and TMDB is still
   leading.** The placeholder is the archive's own key; the real upstream id
   lives in `content/tmdb-metadata.json`, written by `npm run enrich-tmdb`. A
   series that has one takes its episode list from
   `content/tmdb-episodes/{placeholderId}.json` and `--covers` matching works
   for it. A series with no match keeps the older world, where `--episodes-for`
   is the only route that produces episodes.
4. **`content/` is hand-curated source; `public/data/` and `data/` are
   generated.** Never hand-edit generated output. `content/episodes.json`,
   `content/queue.json`, `content/tmdb-seed/` and `content/tmdb-episodes/` are
   written by the pipeline but committed, so they show up in diffs and that is
   expected.
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
7. **Every channel has two line-ups, and the language rule only governs one.**
   `build-data.ts` emits a `-daily` schedule per channel under the rule above,
   and a `-open` one over the same network with no language filter — the
   viewer's `ntv-language` setting picks between them (`src/data/language.ts`).
   `-daily` is the default and the premise; nothing about the wider feed
   loosens rule 6, because a slot's `metadata.audioLanguage` is derived from
   what the video actually carries rather than from the station, so an English
   programme on a widened line-up is asked for in English. A channel whose
   material is all in its own language gets no `-open` schedule and no entry to
   ship. The wider schedules live in their own `broadcast-open.json`, fetched
   only once a viewer asks for them: they are the same size again as the
   broadcast feeds, and every route loads `broadcast.json`.

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

Both pass `--limit`, because a page each over the whole archive is an hour and
ingest is the loop a person waits on. The ceiling is safe because the scan
reads **least-read sources first**: a playlist the same run whitelisted has
nothing read yet and goes to the front, so the newcomer is always what gets
read and the backlog is what waits. Do not "fix" that ordering into file order
— `episodes.json` is grouped by series in an order unrelated to when a source
was added, and a limited run over it would never reach today's playlist.

**The remainder: choosing the track is possible, but only unofficially.**
YouTube documents no way to do it — no player parameter, no supported IFrame
API call — and a logged-out viewer normally gets the upload's original. The
player object does carry undocumented `getAvailableAudioTracks` /
`setAudioTrack` methods, and `preferAudioLanguage` in
`src/player/youtubeApi.ts` uses them: both players ask for their language on
every video, and where the embed answers, a Nederlandse dub is switched on
before the viewer sees anything. Track objects have appeared both with a
`getLanguageInfo()` method and as plain nested data after crossing the iframe;
the reader deliberately handles both. After a switch it keeps checking for 12
seconds, because YouTube can apply its own account/player preference late and
undo an earlier choice.

Written to survive their removal, because nothing promises they will stay.
The methods are optional on `YtPlayer`, an absent or throwing one reports
`unsupported`. When the upload's default language differs from the requested
one, both `unsupported` and `unavailable` automatically try subtitles in the
requested language next. Only when that also fails can
`src/components/AudioTrackNotice.vue` return as the manual last resort. The
other outcomes are informative rather than apologetic: `unavailable` means the
player listed its tracks and this video has no Dutch one.

Which language is asked for differs by player, and neither reads the scan:

| player | asks for | why |
| --- | --- | --- |
| `PlayerView` | always `nl` | the archive is Dutch-first, and on demand there is no station to speak for |
| `LivePlayerView` | `Broadcast.metadata.audioLanguage` | the slot's own language, every time — `dubbedAudio` only speaks up when the video disagrees, so it cannot be what is asked for. An English channel must not start speaking Dutch because an upload quietly gained a track, and on a widened line-up an English-only programme is asked for in English rather than promised a dub it does not have. |

Both players also carry `src/components/TrackControls.vue`, next to their play
controls: a button that asks for the audio track again and says out loud what
came back, and a subtitle toggle beside it. The audio button is the same
`preferAudioLanguage` call the page already makes on its own — it exists
because when that quietly fails the viewer's only recourse is a gear menu that
is easy to miss and, in fullscreen, easy to lose.

Subtitles work the same way and are equally undocumented:
`preferSubtitleLanguage` loads the captions module under both names it has ever
had, prefers a real Nederlands track, and falls back to asking YouTube to
translate one — reported as `translated` rather than folded into `switched`,
because a machine translation is a different thing from subtitles somebody
wrote. The embeds still omit `cc_load_policy`, so captions are not forced onto
videos that already speak the requested language. They turn on automatically
only as the fallback above, or when a viewer asks with the subtitle button.

The scan stays the record of what the archive *knows*, and it is still what
colours a series `dubbed` rather than green — Dutch that a viewer may yet have
to click for is not a Nederlandse bron, and the call to find one stays open.
But the switch does not consult it: the player knows the video in front of it,
and `audioLanguages: null` on a row nobody has scanned is no reason not to ask.

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
by both `match.ts` and `build-data.ts`. Four kinds of series, in precedence
order — the first that applies wins:

| kind | identity from | episodes from |
| --- | --- | --- |
| resolved against TMDB | `content/tmdb-metadata.json`, or the guide when there is one | `content/tmdb-episodes/{placeholderId}.json` (committed) |
| real TMDB id (positive) | `data/tmdb/{id}.json` (cache, gitignored) | same file |
| seeded id (negative) | `content/tmdb-seed/{id}.json` (committed) | same file |
| guide listing | `content/historical-series.json` | `content/tmdb-seed/{id}.json`, once a playlist writes one |

The first row is what makes TMDB leading: real seasons, real numbering, real air
dates, and honest gaps where no upload was found. A TMDB record with **no**
episodes does not count — TMDB carries entries for shows it has registered and
not catalogued, and taking one as the list would blank a series that plays
today.

Identity still wins from the guide wherever there is one. A guide says what the
show **is**; a playlist says what its episodes **are**, and an upstream record
may be a reboot, a dub or a differently-scoped entry. Nothing either of them
writes may overrule the name, overview or years the guide recorded.

One narrower display-name fallback also applies without a guide: when TMDB has
no Dutch/Latin localized title and returns a Japanese, Chinese or Korean name,
`loadSeriesCache` keeps the committed seed's reviewed Latin title. TMDB still
owns the episode list, dates and artwork, and its original title remains in
`tmdb-metadata.json`; East-Asian script must never become the public primary
series name.

## The retention guarantee

When a series gains a TMDB episode list, its playlist stops authoring the list
and becomes a pool of candidates to match into one. That is an improvement in
shape and a risk to content: Dutch upload titles match English TMDB titles
badly, and a playlist that covered a show completely can come out of matching
half empty.

So `match.ts` computes both answers and the TMDB-led one has to earn the
switch. If it places fewer playable episodes than the playlist supplies, the
playlist keeps the series and the run says so out loud. Gaining gaps is the
point; losing episodes a viewer can watch today is not.

When an upstream match is simply wrong — the wrong show, a reboot, a
differently-scoped entry — `npm run enrich-tmdb -- --remove <slug>` drops it and
the series goes back to being playlist-led permanently.

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
| `ingest.yml` | push to any branch **except Master** touching `content/playlists.json`, `content/channels.json`, `content/videos.json`, `content/series.json`, `content/tmdb-metadata.json`, `scripts/**` or itself; `workflow_dispatch` | restores the `data/` cache, then `resolve-playlists` → `enrich-tmdb` → `fetch` → `match` → `scan-audio` → `build-data`, then commits `content/` back to the same branch. This is how an offline environment fills the archive. It pushes with `GITHUB_TOKEN`, so it cannot re-trigger itself. `TMDB_API_TOKEN` is optional — without it both TMDB steps say so and stop, and the run proceeds on the committed data. |
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
npm run enrich-tmdb  # needs network + TMDB token; matches placeholders to real TMDB ids
npm run fetch        # needs network (--youtube-only, --series, --force, --max-age-hours N)
npm run match        # needs data/youtube/ from fetch
npm run scan-audio   # needs network; reads each video's audio tracks (--all, --limit N)
npm run resolve-playlists  # needs network; fills in playlist title + curator
```

## Traps

- **`data/` and `public/data/` are gitignored and disposable.** A fresh clone
  builds without API keys because `content/tmdb-seed/` and
  `content/tmdb-episodes/` are committed. Do not gitignore either directory by
  analogy with `data/tmdb/` — without the second, a clone with no TMDB
  credential builds an archive with no episode lists at all.
- **`fetch` skips a source read in the last 24 hours.** That is what
  `--force` and `--max-age-hours N` are for. On a runner the skip only works
  because `ingest.yml` caches `data/` between runs; without that step every
  source looks unfetched and, worse, skipping one would leave `match` with
  nothing to read.
- **`match.ts` overwrites `content/`.** It rewrites `episodes.json`,
  `queue.json` and the seed files of playlist-backed series. Never run it to
  "see what happens" in the working tree.
- **Episode records are decisions.** `match` never reorders or replaces an
  existing upload; newly found ones are appended to the tail, so the default a
  person chose in the admin stays the default. The exception is a
  source-derived series — playlist or hand-picked set — whose whole list is
  rebuilt every run. That is what lets a playlist that gained episodes, or a
  video added to a set, show up on a re-run.
- **An episode holds a list of uploads, not one.** `Episode.videos[]`, best
  first; the head is what plays and what the schedule books. Episode-level
  status is derived (`scripts/lib/episodes.ts`) — `missing` precisely when no
  upload plays — so an episode with alternates survives losing one.
- **Two year ceilings, and they are not the same.** A series is in scope when
  it first aired in or before **2005**, checked at fetch so no request is spent
  outside the period. An episode is listed when it aired in or before **2008**,
  checked at build. An episode with no air date is kept: reading absence as
  "too recent" would empty the archive rather than trim it. Both live in
  `scripts/lib/cutoff.ts`.
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
