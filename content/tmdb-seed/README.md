# `content/tmdb-seed/`

TMDB-shaped metadata for series that have **not yet been resolved against
TMDB** — the ones still carrying a negative placeholder `tmdbId` in
`content/series.json`. One file per series, named `{tmdbId}.json`.

## Why this is committed and `data/tmdb/` is not

They look like the same thing and are not.

`data/tmdb/{id}.json` is a genuine cache: it holds a real TMDB response for a
real series id, it is disposable, and `npm run fetch` can rebuild it at any
time. Gitignoring it costs nothing.

These files hold data for series with **no real TMDB id**, so there is nothing
to re-fetch and nothing to rebuild them from. They are hand-authored source
data that merely happens to be TMDB-shaped, which makes them content, not
cache. They live here so a fresh clone can run `npm run build-data` — and
therefore `npm run build` — without any API keys.

`scripts/lib/paths.ts` picks between the two on the sign of the id.

## Retiring one

When a series gets a real positive `tmdbId` in `content/series.json`,
`npm run fetch` writes the real response to `data/tmdb/` and the resolver stops
looking here. The corresponding seed file is then dead and should be deleted in
the same commit that resolves the id.
