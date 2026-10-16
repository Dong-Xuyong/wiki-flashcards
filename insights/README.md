# Study · Insights

The YouTube Wiki Insights app, copied into the Study suite at `/wiki-flashcards/insights/`.

- **Source:** `Dong-Xuyong/wiki-insights` @ `6f967a31e85366dd50619633048109b126128100` (`wiki-insights@6f967a31e85366dd50619633048109b126128100`).
- **Data:** read from `/wiki-insights/data/` (`catalog.json` and `insights/<slug>.json`). This folder does not contain a `data/` copy. Grok Bot keeps committing that data in the wiki-insights repo.
- **Sync:** this folder is part of the wiki-flashcards Pages repo. Completed-video sync still reads and writes `wiki-insights.json` in `Dong-Xuyong/progress-sync`. `wiki-insights-agent.json` stays read-only. `localStorage` keys are unchanged (`wiki-insights-progress-v1`, `wiki-insights-game-v1`, `wiki-insights-local-v1`, `wiki-insights-return-v1`, `wiki-insights-bili-hover-reset-v2`).

SECOND BRAIN PENDING: `wiki-flashcards` `insights/`. This copy could not read `Dong-Xuyong/second-brain`. If a wiki-flashcards source tree exists there, copy this `insights/` folder into it. A mirror sync that omits `insights/` will delete this tab.
