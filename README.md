# Wiki Flashcards

Mobile-first flashcards app for learning the concepts from my YouTube wiki.

Live: https://dong-xuyong.github.io/wiki-flashcards/

## Features

- **Library** — all 1,184 concepts grouped by theme, each with keywords; search and filter by Known / Unknown / Due / New
- **Study** — question & answer flashcards with an optional keywords hint
- **Spaced repetition** — grade cards Again / Hard / Good / Easy (SM-2-lite scheduling); due cards resurface automatically
- **Known / unknown tracking** — mark cards you already know to remove them from study, or flag ones you don't to prioritize them
- Progress, streak, and card state live in `localStorage` on the device

## Stack

Plain HTML/CSS/JS, no build step. `data/concepts.json` is generated from the wiki
by `scripts/build_wiki_flashcards_data.py` in the source (private) repo, which merges
hand-written Q&A pairs with concept metadata (title, definition, keywords, section,
related concepts).

## Updating content

1. In the source repo, run `python scripts/build_wiki_flashcards_data.py`
2. Copy the updated app files here and push — GitHub Pages redeploys automatically

## Run locally

```bash
python -m http.server 8791
# open http://localhost:8791
```

(The app fetches JSON, so it needs HTTP — opening `index.html` directly as a file won't work.)
