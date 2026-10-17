import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../video-dedupe.js", import.meta.url), "utf8"), ctx);
const { collapseCatalogVideos, collapseConceptVideos } = ctx.VideoDedupe;
const same = fs.readFileSync(new URL("../video-dedupe.js", import.meta.url), "utf8") ===
  fs.readFileSync(new URL("../insights/video-dedupe.js", import.meta.url), "utf8");
assert.ok(same, "insights/video-dedupe.js must be a copy of video-dedupe.js");

// Insights catalog: the UVrH0lx9qvA bug (2 + 3 concepts under two slugs)
const catalog = [
  { slug: "im-39", video_id: "UVrH0lx9qvA", created: "2026-10-13", added: "2026-10-13", updated: "2026-10-13",
    tags: ["charisma"], concepts: [{ slug: "deferred" }, { slug: "love-no" }], conceptCount: 2, has_insights: true },
  { slug: "other", video_id: "BBBBBBBBBBB", concepts: [{ slug: "x" }], conceptCount: 1 },
  { slug: "wish-30", video_id: "UVrH0lx9qvA", created: "2026-10-14", added: "2026-10-17", updated: "2026-10-14",
    tags: ["charisma", "habits"], concepts: [{ slug: "breathwork" }, { slug: "feel" }, { slug: "bs-meter" }, { slug: "deferred" }], conceptCount: 4 },
  { slug: "no-id", concepts: [] },
  { slug: "no-id-2", concepts: [] },
];
const out = collapseCatalogVideos(catalog);
assert.deepEqual([...out.map((v) => v.slug)], ["im-39", "other", "no-id", "no-id-2"]);
const merged = out[0];
assert.deepEqual([...merged.concepts.map((c) => c.slug)], ["deferred", "love-no", "breathwork", "feel", "bs-meter"]);
assert.equal(merged.conceptCount, 5);
assert.deepEqual([...merged.tags], ["charisma", "habits"]);
assert.deepEqual([...merged.aliasSlugs], ["wish-30"]);
assert.equal(merged.added, "2026-10-13");
assert.equal(merged.updated, "2026-10-14");
assert.equal(catalog[0].conceptCount, 2, "input is not mutated");
// Continue watching filters this list, so one video id -> one row
assert.equal(out.filter((v) => v.video_id === "UVrH0lx9qvA").length, 1);

// Flashcards concepts.json
const doc = {
  videos: {
    "im-39": { id: "UVrH0lx9qvA", n: 2 },
    "wish-30": { id: "UVrH0lx9qvA", n: 3 },
    other: { id: "BBBBBBBBBBB", n: 1 },
  },
  concepts: [
    { slug: "deferred", videos: ["im-39"] },
    { slug: "breathwork", videos: ["wish-30"] },
    { slug: "both", videos: ["wish-30", "im-39", "other"] },
  ],
};
const alias = collapseConceptVideos(doc);
assert.deepEqual({ ...alias }, { "wish-30": "im-39" });
assert.deepEqual(Object.keys(doc.videos), ["im-39", "other"]);
assert.equal(doc.videos["im-39"].n, 3);
assert.deepEqual([...doc.concepts[1].videos], ["im-39"]);
assert.deepEqual([...doc.concepts[2].videos], ["im-39", "other"]);
assert.deepEqual({ ...collapseConceptVideos({ videos: { a: { id: "z" } }, concepts: [] }) }, {});

// the real data has one entry per video id
const real = JSON.parse(fs.readFileSync(new URL("../data/concepts.json", import.meta.url), "utf8"));
const ids = Object.values(real.videos).map((v) => v.id).filter(Boolean);
assert.equal(new Set(ids).size, ids.length, "data/concepts.json has duplicate video ids");
assert.equal(real.videos["im-39-what-i-wish-i-knew-at-30"].n, 5);

// both apps load the module before app.js and use it
for (const [html, js, fn] of [["../index.html", "../app.js", "collapseConceptVideos"], ["../insights/index.html", "../insights/app.js", "collapseCatalogVideos"]]) {
  const h = fs.readFileSync(new URL(html, import.meta.url), "utf8");
  assert.ok(h.indexOf("video-dedupe.js") > -1 && h.indexOf("video-dedupe.js") < h.indexOf('src="app.js'), html);
  assert.match(fs.readFileSync(new URL(js, import.meta.url), "utf8"), new RegExp(fn));
}
console.log("video-dedupe tests passed");
