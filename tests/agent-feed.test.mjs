/**
 * Run: node tests/agent-feed.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console });
context.window = context;
context.globalThis = context;
vm.runInContext(fs.readFileSync(new URL("../agent-feed.js", import.meta.url), "utf8"), context);
const { WikiAgent } = context;

const deck = [
  { slug: "prompt-caching", title: "Prompt Caching" },
  { id: "concept-99", slug: "legacy-id", title: "Legacy" },
];
const sections = ["agents", "systems"];

function file(entries) {
  return { app: "wiki-flashcards-agent", version: 1, updatedAt: "2026-10-13T23:26:13+01:00", entries };
}

let union = WikiAgent.unionEntries([], null);
assert.deepEqual(union, []);
union = WikiAgent.unionEntries(union, { app: "wiki-flashcards-agent", entries: [] });
assert.deepEqual(union, [], "empty entries are a no-op");
union = WikiAgent.unionEntries(union, { app: "wiki-flashcards", entries: [{ id: "fc_x", kind: "note", title: "X" }] });
assert.deepEqual(union, [], "a different app file is a no-op");
const missing = WikiAgent.unionEntries([], undefined);
assert.deepEqual(missing, []);

const first = file([
  { id: "fc_llm-token-cost-reduction", kind: "new_concept", conceptSlug: "llm-token-cost-reduction", title: "Llm Token Cost Reduction", note: "thin", e: "💸" },
  { id: "fc_llm-token-cost-reduction", kind: "new_concept", conceptSlug: "llm-token-cost-reduction", title: "Duplicate should lose", note: "second" },
  { id: "fc_prompt-caching_20261013", kind: "updated_concept", conceptSlug: "prompt-caching", title: "Prompt Caching", note: "Updated", emoji: "⚡", links: [{ label: "commit", url: "https://github.com/Dong-Xuyong/second-brain/commit/0518da2" }, { label: "bad", url: "javascript:alert(1)" }] },
  { id: "fc_note_1", kind: "note", conceptSlug: "prompt-caching", title: "A note", note: "just a note" },
]);
union = WikiAgent.unionEntries([], first);
assert.equal(union.length, 3, "duplicate ids collapse to the first");
const again = WikiAgent.unionEntries(union, first);
assert.equal(again, union, "re-reading the same ids keeps the same list");

const added = WikiAgent.unionEntries(union, file([
  { id: "fc_fresh-qa", kind: "qa_added", conceptSlug: "fresh-qa", title: "Fresh", question: "What is it?", answer: "A card.", section: "agents", keywords: "cost, cache", videoSlugs: ["some-video"] },
  { id: "fc_legacy", kind: "qa_added", conceptId: "concept-99", conceptSlug: "legacy-id", title: "Legacy", q: "Q?", a: "A." },
  { id: "fc_also-new", kind: "new_concept", conceptSlug: "also-new", title: "Also", qa: [{ q: "Why?", a: "Because." }] },
  { id: "fc_update-with-qa", kind: "updated_concept", conceptSlug: "brand-new-update", title: "Nope", q: "Q", a: "A" },
  { id: "", kind: "note", title: "No id" },
  { id: "fc_weird", kind: "invented", title: "Skip me", conceptSlug: "weird" },
]));
assert.equal(added.length, 8);

assert.equal(WikiAgent.emojiOf({ e: " 🙏 " }), "🙏");
assert.equal(WikiAgent.emojiOf({ e: "", emoji: "📘" }), "📘");
assert.equal(WikiAgent.emojiOf({ emoji: "🧠" }), "🧠");
assert.equal(WikiAgent.emojiOf({}), "");
assert.equal(WikiAgent.emojiOf(null), "");

const surface = WikiAgent.surface(deck, added, sections);
const cardSlugs = surface.cards.map((c) => c.slug).sort();
assert.deepEqual(Array.from(cardSlugs), ["also-new", "fresh-qa", "llm-token-cost-reduction"]);
const fresh = surface.cards.find((c) => c.slug === "fresh-qa");
assert.equal(fresh.q, "What is it?");
assert.equal(fresh.a, "A card.");
assert.equal(fresh.section, "agents");
assert.deepEqual(Array.from(fresh.keywords), ["cost", "cache"]);
assert.deepEqual(Array.from(fresh.videos), ["some-video"]);
assert.equal(fresh.fromAgent, true);
assert.ok(Array.isArray(fresh.related));
const also = surface.cards.find((c) => c.slug === "also-new");
assert.equal(also.section, "from-agent", "unknown section falls back to the agent section");
assert.equal(also.q, "Why?");

const listed = new Set(surface.list.map((row) => row.id));
assert.equal(listed.has("fc_fresh-qa"), false, "a new card is not also listed");
assert.equal(listed.has("fc_also-new"), false);
assert.equal(listed.has("fc_llm-token-cost-reduction"), false, "a new concept is a normal concept, not an agent-log row");
assert.ok(listed.has("fc_prompt-caching_20261013"));
assert.ok(listed.has("fc_note_1"));
assert.ok(listed.has("fc_legacy"), "Q&A for an existing concept id is not a second card");
assert.ok(listed.has("fc_update-with-qa"), "updated concepts stay on the list");
assert.equal(listed.has("fc_weird"), false, "unknown kinds are ignored");

const update = surface.list.find((row) => row.id === "fc_prompt-caching_20261013");
assert.equal(update.openSlug, "prompt-caching");
assert.equal(
  JSON.stringify(update.links),
  JSON.stringify([{ label: "commit", url: "https://github.com/Dong-Xuyong/second-brain/commit/0518da2" }])
);
const legacy = surface.list.find((row) => row.id === "fc_legacy");
assert.equal(legacy.openSlug, "legacy-id");
assert.equal(legacy.q, "Q?");

const thin = surface.cards.find((c) => c.slug === "llm-token-cost-reduction");
assert.equal(thin.e, "💸");
assert.equal(thin.title, "Llm Token Cost Reduction");
assert.equal(deck[0].e, "⚡", "an existing concept picks up a missing emoji without a second card");
assert.equal(WikiAgent.KIND_LABELS.new_concept, "New concept");

const secondPass = WikiAgent.surface(deck.concat(surface.cards), added, sections);
assert.equal(secondPass.cards.length, 0, "surfacing twice does not duplicate cards");

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
assert.match(app, /const AGENT_APP = "wiki-flashcards-agent"/);
assert.match(app, /GhSync\.load\(AGENT_APP,\s*applyAgentFile\)/);
assert.doesNotMatch(app, /GhSync\.save\(\s*AGENT_APP/);
assert.match(app, /GhSync\.save\(BACKUP_APP,/);
const payloadStart = app.indexOf("function progressPayload");
const payloadEnd = app.indexOf("function applyProgress");
assert.ok(payloadStart > 0 && payloadEnd > payloadStart);
assert.doesNotMatch(app.slice(payloadStart, payloadEnd), /agent/i, "save payload stays the flashcards backup");
assert.doesNotMatch(app, /From the agent log/);
assert.doesNotMatch(app, /Added by agent/);
assert.doesNotMatch(app, /agentListHtml/);
assert.match(app, /Wiki Review Cards/);
assert.match(app, /function emojiTag/);
assert.match(app, /row-emoji/);
assert.match(app, /detail-emoji/);
assert.match(app, /card-emoji/);
assert.doesNotMatch(app, /badge agent">Agent/);
const libStart = app.indexOf("function renderLibList");
const libEnd = app.indexOf("function bindConceptRows");
assert.ok(libStart > 0 && libEnd > libStart);
const library = app.slice(libStart, libEnd);
assert.doesNotMatch(library, /agentListHtml/);
assert.doesNotMatch(library, /From the agent log/);
assert.doesNotMatch(library, /Added by agent/);
assert.doesNotMatch(library, /agent-link/);
assert.doesNotMatch(library, /badge agent/);
const rowStart = app.indexOf("function conceptRow");
const rowEnd = app.indexOf("function renderLibList");
assert.doesNotMatch(app.slice(rowStart, rowEnd), /fromAgent/);
assert.match(app, /projectAgentEntries/);
assert.match(app, /function renderLibList/);

console.log("agent feed tests passed");
