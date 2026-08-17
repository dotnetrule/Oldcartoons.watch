# `content/tmdb-episodes/`

The real TMDB season and episode list for a series that carries a **negative
placeholder `tmdbId`**. One file per series, named `{placeholderId}.json` —
the placeholder, not the upstream id.

This is what makes TMDB leading. A series here shows the seasons and episodes
TMDB lists, in TMDB's order, with TMDB's titles and air dates. YouTube supplies
videos that get matched into that list; an episode nobody found a video for
keeps its row and renders as a gap.

## Why not `content/tmdb-seed/`

The two directories hold the same *shape* and answer to different owners, and
merging them would make one of the two owners lose every run.

`content/tmdb-seed/` is written by `scripts/match.ts` for series whose episode
list a playlist authors — it is rewritten from the playlist on every ingest,
because playlist order *is* episode order for those series. If TMDB episodes
landed there, the next ingest would overwrite them with the playlist's version.

These files are written only by `npm run fetch`, from the real TMDB id recorded
in `content/tmdb-metadata.json`. Keeping them apart is what lets a series be
TMDB-led and still have a playlist matched into it.

`scripts/lib/series-metadata.ts` (`loadSeriesCache`) resolves between them and
is the only place that decides.

## Why this is committed

Same reason as `content/tmdb-seed/`, and it matters more here: without these
files a clone with no `TMDB_API_TOKEN` would build an archive with no episode
lists at all. Committing them is what makes the keyless path a real fallback
rather than an empty site. `npm run build-data` never needs a credential.

The trade is that they are large and they show up in diffs. That is the point —
an episode list changing under the archive should be visible in review.

## Refreshing

`npm run fetch` rewrites a file when it is older than the freshness ceiling
(24h by default; see `scripts/lib/freshness.ts`). `--force` ignores that, and
`--series <slug>` scopes the run to one show.

A series only gets a file here once `npm run enrich-tmdb` has matched it to a
real TMDB id. Series with no match keep their playlist-authored list and have
no file here — that is the intended fallback, not a gap.
