# Wiki Flashcards

Mobile-first flashcards app for learning the concepts from my YouTube wiki.

Live: https://dong-xuyong.github.io/wiki-flashcards/

## Features

- **Library** — all concepts grouped by theme, each with keywords; search and filter by Known / Unknown / Due / New
- **Study** — question & answer flashcards with an optional keywords hint
- **Spaced repetition** — grade cards Again / Hard / Good / Easy (SM-2-lite scheduling); due cards resurface automatically
- **Known / unknown tracking** — mark cards you already know to remove them from study, or flag ones you don't to prioritize them
- **Analytics** — progress timeline with 30-day review chart, activity heatmap, KPIs, and per-section mastery
- **Source videos** — every card lists the videos it came from, with a thumbnail and a link straight into [Wiki Insights](https://dong-xuyong.github.io/wiki-insights/) alongside the YouTube link
- **Study one video** — `#/v/<source-slug>` shows every concept from a single video and studies just that set
- **Deep links** — `#/c/<concept-slug>` opens a card directly, so concepts are shareable and the phone back button works
- Progress, streak, card state, and analytics events live in `localStorage` on the device

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
