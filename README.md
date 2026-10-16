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
- **AWS study** — `#/aws` tracks AWS Certified Cloud Practitioner (CLF-C02): domain confidence, practice scores, and a readiness meter. With no GitHub token the tab shows demo data. A saved token syncs `aws-study.json` in Dong-Xuyong/progress-sync, separate from flashcard progress.
- Progress is kept in this browser and, once a GitHub token is saved (`dong-gh-sync`), merged and synced automatically with `wiki-flashcards.json` in Dong-Xuyong/progress-sync
- Agent entries in `wiki-flashcards-agent.json` are read on that same sync and never written. A new concept joins the library as a normal concept, and becomes a review card when it has a question and answer and is not already in the deck. Other entries stay on the home Added by agent list. The library does not show that list, an agent badge, or commit chips. Concept emoji is the `e` string older concepts use (`emoji` is accepted as the same value); a missing emoji leaves the slot empty.

## Stack

Plain HTML/CSS/JS, no build step. `data/concepts.json` is a committed snapshot of the wiki
concepts: hand-written Q&A pairs merged with concept metadata (title, definition, keywords,
section, related concepts). There is currently no build script that regenerates it.

Each concept carries `videos` as a list of source slugs resolving against a shared
top-level `videos` index, so video metadata is stored once. Those slugs are the same
ones Wiki Insights uses, which is what makes the cross-app links line up. The link
itself comes from the `## Sources` section of each concept page in the vault.

## Updating content

`data/concepts.json` is updated by committing a new snapshot to this repo; GitHub Pages
redeploys automatically. Agents record new or updated concepts (not card state) in the private
`Dong-Xuyong/progress-sync` repo with `scripts/sync_wiki_flashcards.py` (see
`wiki-insights/AGENT_INSIGHTS_SPEC.md` there).

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
node tests/gh-sync-auto.test.mjs
node tests/agent-feed.test.mjs
node tests/aws-study.test.mjs
```
