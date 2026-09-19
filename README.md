# Wiki Flashcards

Mobile-first flashcards app for learning the concepts from my YouTube wiki.

Live: https://dong-xuyong.github.io/wiki-flashcards/

## Features

- **Library** — concepts grouped by theme; search and filter by Due / New / Learning / Fluent / Unknown / Skipped (legacy Known)
- **Study** — graded retrieval only: reveal, then Again / Hard / Good / Easy
- **Card states** — New, Learning, Fluent, or Skipped. Fluent needs a 21+ day interval and two recent Good/Easy grades
- **Daily goal** — pick 5, 10, or 20 graded reviews
- **Bounded sessions** — at most 8 new cards per day and 20 cards per session; due cards fill first
- **Spaced repetition** — SM-2-lite; first Hard / Good / Easy use 1 / 2 / 4 day intervals
- **Streak** — consecutive local days with at least one graded review
- **Analytics** — fluency, recently fluent chips, SRS buckets, 30-day review chart, heatmap
- **Source videos** — `#/v/<source-slug>` studies one video's concepts; links into [Wiki Insights](https://dong-xuyong.github.io/wiki-insights/)
- **Deep links** — `#/c/<concept-slug>` opens a card
- Progress lives in `localStorage` only (no account, no XP or levels)

## Stack

Plain HTML/CSS/JS, no build step. `data/concepts.json` is generated from the wiki
by `scripts/build_wiki_flashcards_data.py` in the source (private) repo, which merges
hand-written Q&A pairs with concept metadata (title, definition, keywords, section,
related concepts).

Each concept carries `videos` as a list of source slugs resolving against a shared
top-level `videos` index, so video metadata is stored once. Those slugs are the same
ones Wiki Insights uses, which is what makes the cross-app links line up. The link
itself comes from the `## Sources` section of each concept page in the vault.

## Updating content (automatic)

In the Second Brain source repo, after any `youtube-wiki/wiki/concepts/` change:

```bash
python scripts/sync_wiki_flashcards.py
```

That rebuilds `data/concepts.json` from the full wiki and pushes this repo. GitHub Pages redeploys automatically.

Also wired in that repo:
- Wiki ingest step 9 in `youtube-wiki/AGENTS.md` requires the sync after concept updates
- Cursor hooks mark concept/Q&A edits dirty and run the sync on session stop
## Run locally

```bash
python -m http.server 8791
# open http://localhost:8791
```

(The app fetches JSON, so it needs HTTP — opening `index.html` directly as a file won't work.)

To exercise the Wiki Insights cross-links locally, serve the parent folder holding both
app directories instead, then open `http://localhost:8790/wiki-flashcards/`. On localhost
the app points at `../wiki-insights/`; everywhere else it uses the public URL.

## Tests

```bash
node tests/learning-model.js
```
