/**
 * Stubbed GitHub contents API. Never touches Dong-Xuyong/progress-sync.
 * Run: node tests/gh-sync-auto.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const memory = new Map();
const localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
};

const calls = [];
let handler = async () => { throw new Error("fetch not stubbed"); };
const confirms = [];
const prompts = [];

function encodeContent(data) {
  return Buffer.from(unescape(encodeURIComponent(JSON.stringify(data))), "binary").toString("base64");
}
function decodeContent(b64) {
  return JSON.parse(decodeURIComponent(escape(Buffer.from(String(b64).replace(/\s/g, ""), "base64").toString("binary"))));
}
function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const context = vm.createContext({
  localStorage,
  console,
  JSON,
  Object,
  Array,
  Error,
  Promise,
  Date,
  String,
  Number,
  unescape,
  escape,
  encodeURIComponent,
  decodeURIComponent,
  btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  fetch: (url, opts) => {
    calls.push({ url, method: opts && opts.method, body: opts && opts.body, headers: opts && opts.headers });
    return handler(url, opts || {});
  },
  confirm: (msg) => { confirms.push(msg); return false; },
  prompt: (msg) => { prompts.push(msg); return null; },
});
context.window = context;
context.globalThis = context;

vm.runInContext(fs.readFileSync(new URL("../dong-ui/gh-sync.js", import.meta.url), "utf8"), context);
vm.runInContext(fs.readFileSync(new URL("../analytics.js", import.meta.url), "utf8"), context);

const { GhSync, WikiAnalytics } = context;
const APP = "wiki-flashcards";
const FILE = "https://api.github.com/repos/Dong-Xuyong/progress-sync/contents/wiki-flashcards.json";

function reset() {
  memory.clear();
  calls.length = 0;
  confirms.length = 0;
  prompts.length = 0;
  localStorage.setItem("dong-gh-sync", JSON.stringify({
    token: "test-token",
    repo: "Dong-Xuyong/progress-sync",
  }));
}

function puts() { return calls.filter((c) => c.method === "PUT"); }
function gets() { return calls.filter((c) => c.method === "GET"); }

reset();
await assert.rejects(
  GhSync.save(APP, () => ({ app: APP }), () => {}),
  /Save cancelled/
);
assert.equal(puts().length, 0, "cancelled save must not PUT");
assert.equal(confirms.length, 1);

reset();
const remote = {
  app: APP,
  version: 1,
  exportedAt: "2020-01-01T00:00:00.000Z",
  cards: {
    "remote-only": { st: "known", reps: 2, int: 4, ease: 2.5, due: 20, last: 8000 },
    both: { st: null, reps: 1, int: 1, ease: 2.5, due: 5, last: 1000 },
  },
  analytics: null,
};
let current = remote;
handler = async (url, opts) => {
  assert.equal(url, FILE);
  assert.equal(opts.headers.Authorization, "Bearer test-token");
  if (opts.method === "GET") {
    return response(200, { sha: "sha-1", content: encodeContent(current) });
  }
  const body = JSON.parse(opts.body);
  assert.equal(body.sha, "sha-1");
  current = decodeContent(body.content);
  return response(200, { content: { sha: "sha-2" } });
};

const localCards = {
  "local-only": { st: null, reps: 3, int: 2, ease: 2.5, due: 9, last: 5000 },
  both: { st: "known", reps: 4, int: 6, ease: 2.5, due: 30, last: 9000 },
};
let cards = { ...localCards };
const applied = [];
const message = await GhSync.save(APP, () => ({
  app: APP,
  version: 1,
  exportedAt: new Date().toISOString(),
  cards,
  analytics: null,
}), (data) => {
  applied.push(data);
  cards = WikiAnalytics.mergeCards(cards, data.cards);
}, { quiet: true });

assert.equal(confirms.length, 0, "quiet save must not confirm");
assert.equal(prompts.length, 0);
assert.equal(message, "Saved to GitHub");
assert.equal(applied.length, 1);
assert.deepEqual(Object.keys(cards).sort(), ["both", "local-only", "remote-only"]);
assert.equal(cards.both.st, "known", "newer local copy of a shared card wins");
assert.equal(cards["remote-only"].st, "known");
assert.equal(cards["local-only"].reps, 3);
assert.equal(current.cards.both.last, 9000);
assert.ok(current.cards["local-only"]);
assert.ok(current.cards["remote-only"]);

calls.length = 0;
const again = await GhSync.save(APP, () => ({
  app: APP,
  version: 1,
  exportedAt: "2099-01-01T00:00:00.000Z",
  cards,
  analytics: null,
}), (data) => { cards = WikiAnalytics.mergeCards(cards, data.cards); }, { quiet: true });
assert.equal(again, "Already in sync");
assert.equal(puts().length, 0, "unchanged progress must not PUT");
assert.equal(gets().length, 1);

calls.length = 0;
let sawConflict = false;
let conflictPuts = 0;
handler = async (url, opts) => {
  if (opts.method === "GET") {
    return response(200, {
      sha: sawConflict ? "sha-new" : "sha-old",
      content: encodeContent(current),
    });
  }
  conflictPuts += 1;
  const body = JSON.parse(opts.body);
  if (!sawConflict) {
    assert.equal(body.sha, "sha-old");
    sawConflict = true;
    return response(409, {});
  }
  assert.equal(body.sha, "sha-new");
  return response(200, {});
};
cards = { ...cards, fresh: { st: null, reps: 1, int: 1, ease: 2.5, due: 1, last: 42 } };

let retried = false;
async function pushWithOneRetry() {
  try {
    return await GhSync.save(APP, () => ({ app: APP, version: 1, cards, analytics: null }), (data) => {
      cards = WikiAnalytics.mergeCards(cards, data.cards);
    }, { quiet: true });
  } catch (err) {
    if (!retried && /another device/.test(String(err && err.message))) {
      retried = true;
      return GhSync.save(APP, () => ({ app: APP, version: 1, cards, analytics: null }), (data) => {
        cards = WikiAnalytics.mergeCards(cards, data.cards);
      }, { quiet: true });
    }
    throw err;
  }
}
const saved = await pushWithOneRetry();
assert.equal(retried, true, "the 409 must be retried once");
assert.equal(saved, "Saved to GitHub");
assert.equal(conflictPuts, 2, "one retry after 409, then stop");
assert.equal(cards.fresh.last, 42);
assert.ok(cards["remote-only"], "retry merge must keep the remote card");

handler = async (url, opts) => {
  assert.equal(opts.method, "GET");
  return response(401, {});
};
await assert.rejects(GhSync.load(APP, () => {}), /token rejected/);
assert.equal(localStorage.getItem("dong-gh-sync"), null);

console.log("gh-sync auto tests passed");
