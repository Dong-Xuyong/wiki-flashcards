/**
 * AWS study merge, readiness, and a stubbed 409 save.
 * Never calls the real GitHub API.
 * Run: node tests/aws-study.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { core, saveWithRetry } = require("../aws-study.js");
const { normalize, merge, newId, readiness, domainConfidence, scorePct, daysLeft } = core;

const seed = JSON.parse(fs.readFileSync(new URL("../aws-study.seed.json", import.meta.url), "utf8"));
const weights = [24, 30, 34, 12];

function topic(id, domainId, confidence, updatedAt, extra) {
  return Object.assign({
    id: id,
    domainId: domainId,
    title: id,
    confidence: confidence,
    lastReviewed: null,
    notes: "",
    links: [],
    updatedAt: updatedAt,
  }, extra || {});
}

function blank() {
  return normalize(null);
}

assert.equal(seed.exam.date, null);
assert.equal(seed.exam.time, null);
assert.equal(seed.exam.booked, false);
assert.deepEqual(seed.topics, []);
assert.deepEqual(seed.practiceTests, []);
assert.deepEqual(normalize(null).domains.map((domain) => domain.weight), weights);
assert.equal(weights.reduce((sum, weight) => sum + weight, 0), 100);
assert.deepEqual(normalize(seed).exam, normalize(null).exam);
assert.deepEqual(normalize(seed).domains, normalize(null).domains);
assert.deepEqual(normalize(normalize(seed)), normalize(seed));

const partial = normalize({ domains: [{ id: "d1", name: "Cloud Concepts", weight: 24, note: "keep" }] });
assert.deepEqual(partial.domains.map((domain) => domain.id).slice(0, 4), ["d1", "d2", "d3", "d4"]);
assert.equal(partial.domains[0].note, "keep");
assert.equal(partial.domains.reduce((sum, domain) => sum + domain.weight, 0), 100);

const local = blank();
local.customFlag = true;
local.updatedAt = "2026-10-02T00:00:00+01:00";
local.exam.note = "local-only";
local.exam.updatedAt = "2026-10-02T00:00:00+01:00";
local.topics = [
  topic("tp_local1", "d1", 4, "2026-10-16T12:00:00.000Z", { title: "Rated locally", extra: 1 }),
];
const remote = blank();
remote.botNote = "from rayleigh";
remote.updatedAt = "2026-10-01T23:30:00Z";
remote.exam.date = "2026-11-08";
remote.exam.booked = true;
remote.exam.updatedAt = "2026-10-01T23:30:00Z";
remote.topics = [
  topic("tp_local1", "d1", 1, "2026-10-16T10:00:00.000Z", { botField: "stay" }),
  topic("tp_bot111", "d2", null, "2026-10-16T11:00:00.000Z", { title: "Added by Rayleigh" }),
];

const merged = merge(local, remote);
assert.equal(merged.customFlag, true);
assert.equal(merged.botNote, "from rayleigh");
assert.equal(merged.updatedAt, "2026-10-01T23:30:00Z");
assert.equal(merged.exam.date, "2026-11-08", "parsed instants, not date strings");
assert.equal(merged.exam.booked, true);
assert.equal(merged.exam.note, "local-only");
assert.equal(merged.topics.length, 2);
const rated = merged.topics.find((item) => item.id === "tp_local1");
assert.equal(rated.confidence, 4);
assert.equal(rated.extra, 1);
assert.equal(rated.botField, "stay");
assert.equal(merged.topics.find((item) => item.id === "tp_bot111").title, "Added by Rayleigh");
assert.equal(merged.owner, "rayleigh");
assert.equal(merged.app, "aws-study");

const olderRemote = merge(remote, local);
assert.equal(olderRemote.exam.date, "2026-11-08");

const newerLocalExam = blank();
newerLocalExam.exam.date = null;
newerLocalExam.exam.updatedAt = "2026-10-16T12:00:00.000Z";
const olderRemoteExam = blank();
olderRemoteExam.exam.date = "2026-12-01";
olderRemoteExam.exam.booked = true;
olderRemoteExam.exam.updatedAt = "2026-10-01T00:00:00.000Z";
assert.equal(merge(newerLocalExam, olderRemoteExam).exam.date, null);
assert.equal(merge(newerLocalExam, olderRemoteExam).exam.booked, false);

const tombLocal = blank();
tombLocal.topics = [topic("tp_gone01", "d3", 2, "2026-10-16T08:00:00.000Z")];
const tombRemote = blank();
tombRemote.topics = [topic("tp_gone01", "d3", 2, "2026-10-16T09:00:00.000Z", { deleted: true })];
const tomb = merge(tombLocal, tombRemote);
assert.equal(tomb.topics.length, 1);
assert.equal(tomb.topics[0].deleted, true);

const tiedLocal = blank();
tiedLocal.exam.date = "keep-local";
tiedLocal.exam.updatedAt = "2026-10-01T23:00:00Z";
const tiedRemote = blank();
tiedRemote.exam.date = "2026-11-01";
tiedRemote.exam.updatedAt = "2026-10-02T00:00:00+01:00";
assert.equal(merge(tiedLocal, tiedRemote).exam.date, null, "equal instants keep the local exam");

const ready = blank();
ready.topics = [
  topic("tp_d1aaa1", "d1", 5, "2026-10-01T00:00:00.000Z"),
  topic("tp_d1aaa2", "d1", 3, "2026-10-01T00:00:00.000Z"),
  topic("tp_d2aaa1", "d2", null, "2026-10-01T00:00:00.000Z"),
  topic("tp_d2aaa2", "d2", 3, "2026-10-01T00:00:00.000Z"),
  topic("tp_d3aaa1", "d3", 1, "2026-10-01T00:00:00.000Z"),
  topic("tp_d4aaa1", "d4", 5, "2026-10-01T00:00:00.000Z"),
  topic("tp_d4aaa2", "d4", 5, "2026-10-01T00:00:00.000Z"),
  topic("tp_d4dead", "d4", 1, "2026-10-02T00:00:00.000Z", { deleted: true }),
];
assert.equal(domainConfidence(ready, "d1"), 4);
assert.equal(domainConfidence(ready, "d2"), 2);
assert.equal(domainConfidence(ready, "d3"), 1);
assert.equal(domainConfidence(ready, "d4"), 5);
assert.equal(domainConfidence(ready, "missing"), null);
assert.equal(readiness(ready), 37.5);
assert.equal(readiness(blank()), 0);
const mastered = blank();
mastered.topics = ["d1", "d2", "d3", "d4"].map((id, index) => topic("tp_all55" + index, id, 5, "2026-10-01T00:00:00.000Z"));
assert.equal(readiness(mastered), 100);
const unrated = blank();
unrated.topics = ["d1", "d2", "d3", "d4"].map((id, index) => topic("tp_none5" + index, id, null, "2026-10-01T00:00:00.000Z"));
assert.equal(readiness(unrated), 0);

assert.equal(scorePct({ correct: 52, total: 65 }), 80);
assert.equal(scorePct({ correct: 7, total: 10 }), 70);
assert.ok(scorePct({ correct: 45, total: 65 }) < 70);
assert.equal(scorePct({ correct: 0, total: 10 }), 0);
assert.equal(scorePct({ correct: 1, total: 0 }), null);
assert.equal(scorePct({ correct: 1, total: 2, deleted: true }), null);

assert.equal(daysLeft("2026-11-08", "2026-10-16"), 23);
assert.equal(daysLeft("2026-10-16", "2026-10-16"), 0);
assert.equal(daysLeft("2026-10-15", "2026-10-16"), -1);
assert.equal(daysLeft(null, "2026-10-16"), null);
assert.equal(daysLeft("soon", "2026-10-16"), null);

const ids = new Set();
for (let i = 0; i < 30; i++) {
  const id = newId("tp", Array.from(ids));
  assert.match(id, /^tp_[a-z0-9]{6}$/);
  assert.equal(ids.has(id), false);
  ids.add(id);
}
assert.match(newId("pt"), /^pt_[a-z0-9]{6}$/);

const higher = merge({ schemaVersion: 1, updatedAt: "2026-10-02T00:00:00.000Z" }, { schemaVersion: 3, updatedAt: "2026-10-01T00:00:00.000Z", future: true });
assert.equal(higher.schemaVersion, 3);
assert.equal(higher.future, true);
assert.equal(higher.updatedAt, "2026-10-02T00:00:00.000Z");

const memory = new Map();
const localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
};
const calls = [];
let handler = async () => { throw new Error("fetch not stubbed"); };

function encodeContent(data) {
  return Buffer.from(unescape(encodeURIComponent(JSON.stringify(data))), "binary").toString("base64");
}
function decodeContent(b64) {
  return JSON.parse(decodeURIComponent(escape(Buffer.from(String(b64).replace(/\s/g, ""), "base64").toString("binary"))));
}
function response(status, body) {
  return { status: status, ok: status >= 200 && status < 300, json: async () => body };
}

const context = vm.createContext({
  localStorage: localStorage,
  console: console,
  JSON: JSON,
  Object: Object,
  Array: Array,
  Error: Error,
  Promise: Promise,
  Date: Date,
  String: String,
  Number: Number,
  unescape: unescape,
  escape: escape,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  fetch: (url, opts) => {
    calls.push({ url: url, method: opts && opts.method, body: opts && opts.body, headers: opts && opts.headers });
    return handler(url, opts || {});
  },
  confirm: () => false,
  prompt: () => null,
});
context.window = context;
context.globalThis = context;
vm.runInContext(fs.readFileSync(new URL("../dong-ui/gh-sync.js", import.meta.url), "utf8"), context);

const FILE = "https://api.github.com/repos/Dong-Xuyong/progress-sync/contents/aws-study.json";
localStorage.setItem("dong-gh-sync", JSON.stringify({
  token: "test-token",
  repo: "Dong-Xuyong/progress-sync",
}));

let remoteDoc = blank();
remoteDoc.updatedAt = "2026-10-16T11:00:00.000Z";
remoteDoc.topics = [topic("tp_bot111", "d2", null, "2026-10-16T11:00:00.000Z", { title: "Added by Rayleigh" })];
let current = remoteDoc;
let sawConflict = false;
handler = async (url, opts) => {
  assert.equal(url, FILE);
  assert.equal(opts.headers.Authorization, "Bearer test-token");
  assert.equal(url.includes("wiki-flashcards"), false);
  if (opts.method === "GET") {
    return response(200, {
      sha: sawConflict ? "sha-new" : "sha-old",
      content: encodeContent(current),
    });
  }
  const body = JSON.parse(opts.body);
  if (!sawConflict) {
    assert.equal(body.sha, "sha-old");
    sawConflict = true;
    return response(409, {});
  }
  assert.equal(body.sha, "sha-new");
  current = decodeContent(body.content);
  return response(200, { content: { sha: "sha-done" } });
};

let localDoc = blank();
localDoc.updatedAt = "2026-10-16T12:00:00.000Z";
localDoc.topics = [topic("tp_local1", "d1", 4, "2026-10-16T12:00:00.000Z", { title: "Rated locally" })];
const saved = await saveWithRetry(context.GhSync, () => localDoc, (data) => {
  localDoc = merge(localDoc, data);
});
assert.equal(saved, "Saved to GitHub");
assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT", "GET", "PUT"]);
assert.equal(localDoc.topics.find((item) => item.id === "tp_local1").confidence, 4);
assert.ok(localDoc.topics.find((item) => item.id === "tp_bot111"));
assert.equal(current.topics.length, 2);
assert.equal(calls.some((call) => String(call.url).includes("wiki-flashcards")), false);

calls.length = 0;
sawConflict = false;
let puts = 0;
handler = async (url, opts) => {
  assert.equal(url, FILE);
  if (opts.method === "GET") {
    return response(200, { sha: "sha-" + puts, content: encodeContent(current) });
  }
  puts += 1;
  return response(409, {});
};
localDoc.topics.push(topic("tp_again1", "d3", 2, "2026-10-16T13:00:00.000Z"));
await assert.rejects(
  saveWithRetry(context.GhSync, () => localDoc, (data) => { localDoc = merge(localDoc, data); }),
  /merge retry; not retrying/
);
assert.equal(puts, 2, "a second 409 stops");
assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT", "GET", "PUT"]);

const source = fs.readFileSync(new URL("../aws-study.js", import.meta.url), "utf8");
assert.equal(source.includes("wiki-flashcards.json"), false);
assert.equal(/setItem\(/.test(source), false);
assert.match(source, /APP_ID = "aws-study"/);

console.log("aws-study tests passed");
