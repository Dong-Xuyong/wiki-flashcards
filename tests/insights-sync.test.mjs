// Insights tab: completed videos sync to progress-sync/wiki-insights.json as a union.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const appSrc = fs.readFileSync(new URL("../insights/app.js", import.meta.url), "utf8");
function fn(name) {
  const start = appSrc.indexOf(`  function ${name}(`);
  assert.ok(start > -1, `insights/app.js lacks ${name}`);
  let i = appSrc.indexOf(") {", start) + 2, depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}" && --depth === 0) break;
  }
  return appSrc.slice(start, i + 1);
}

function device(progress, token = "t", files) {
  const store = { "wiki-insights-progress-v1": JSON.stringify(progress) };
  if (token) store["dong-gh-sync"] = JSON.stringify({ token, repo: "Dong-Xuyong/progress-sync" });
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const puts = [];
  const ctx = vm.createContext({
    localStorage, puts, console, JSON, Object, Date, Number, Set, Promise, Error,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    TextEncoder, TextDecoder, encodeURIComponent, escape, unescape,
    confirm: () => { throw new Error("quiet sync must not confirm"); },
    prompt: () => { throw new Error("quiet sync must not prompt"); },
    fetch: async (url, opts) => {
      const method = (opts && opts.method) || "GET";
      const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
      if (method === "GET") {
        if (!files.remote) return res(404, { message: "Not Found" });
        return res(200, { sha: files.sha, content: Buffer.from(unescape(encodeURIComponent(JSON.stringify(files.remote))), "binary").toString("base64") });
      }
      const body = JSON.parse(opts.body);
      if (files.conflicts > 0) { files.conflicts--; files.sha += "x"; files.remote = files.onConflict(files.remote); return res(409, { message: "conflict" }); }
      files.remote = JSON.parse(decodeURIComponent(escape(Buffer.from(body.content, "base64").toString("binary"))));
      files.sha += "+";
      puts.push(files.remote);
      return res(200, { content: { sha: files.sha } });
    },
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(new URL("../insights/dong-ui/gh-sync.js", import.meta.url), "utf8"), ctx);
  vm.runInContext(`const PROGRESS_KEY = "wiki-insights-progress-v1";
    ${fn("loadProgressMap")}\n${fn("completedPayload")}\n${fn("applyCompleted")}\n${fn("completedIds")}\n${fn("completedDiffer")}
    function sync() { return GhSync.save("wiki-insights", completedPayload, applyCompleted, { quiet: true, union: true, differ: completedDiffer }); }
    globalThis.api = { sync, completedPayload, loadProgressMap };`, ctx);
  return { ctx, api: ctx.api, store };
}
const done = (n) => ({ t: 0, updated: n, done: true });
const ids = (data) => Object.keys(data.completed).sort();

// 1) phone with local-only completions after 13 Oct: remote has iPad items -> union pushed, nothing lost
{
  const files = { sha: "s1", remote: { app: "wiki-insights", version: 1, exportedAt: "x", completed: { A: done(1), IPAD: done(2) } } };
  const phone = device({ A: done(1), PHONE1: done(3), PHONE2: done(4), WATCHING: { t: 99, updated: 5, done: false } }, "t", files);
  // stale base from the 13 Oct save that already contained a now-missing id must not delete it
  phone.store["dong-gh-sync-base:wiki-insights"] = JSON.stringify({ app: "wiki-insights", version: 1, completed: { A: done(1), PHONE1: done(3) } });
  files.remote.completed = { A: done(1), IPAD: done(2) }; // PHONE1 absent remotely although in base
  assert.equal(await phone.api.sync(), "Saved to GitHub");
  assert.deepEqual(ids(files.remote), ["A", "IPAD", "PHONE1", "PHONE2"]);
  assert.deepEqual(Object.keys(phone.api.loadProgressMap()).sort(), ["A", "IPAD", "PHONE1", "PHONE2", "WATCHING"]);
  assert.equal(files.remote.completed.WATCHING, undefined, "only completed videos are synced");

  // 2) iPad opens next: pulls everything, nothing to push
  const ipad = device({ A: done(1), IPAD: done(2) }, "t", files);
  assert.equal(await ipad.api.sync(), "Already in sync");
  assert.deepEqual(Object.keys(ipad.api.loadProgressMap()).sort(), ["A", "IPAD", "PHONE1", "PHONE2"]);
  assert.equal(ipad.ctx.puts.length, 0);
}

// 3) first save ever (no remote file) and a 409 during the save keep the union
{
  const files = { sha: "s", remote: null };
  const d = device({ A: done(1) }, "t", files);
  assert.equal(await d.api.sync(), "Saved to GitHub");
  files.conflicts = 1;
  files.onConflict = (r) => ({ ...r, completed: { ...r.completed, OTHER: done(9) } });
  d.store["wiki-insights-progress-v1"] = JSON.stringify({ A: done(1), B: done(2) });
  assert.equal(await d.api.sync(), "Saved to GitHub");
  assert.deepEqual(ids(files.remote), ["A", "B", "OTHER"]);
}

// 4) no token: quiet sync rejects visibly (NO_TOKEN), never prompts, never writes
{
  const files = { sha: "s", remote: null };
  const d = device({ A: done(1) }, null, files);
  assert.equal(d.ctx.GhSync.hasToken(), false);
  await assert.rejects(d.api.sync(), (e) => e.code === "NO_TOKEN");
  assert.equal(d.ctx.puts.length, 0);
}

// 5) the app wires it: debounced save on completion change, sync on open and on visibility, warning without token
assert.match(fn("setSavedSeconds"), /scheduleSync\(\)/);
assert.match(fn("scheduleSync"), /setTimeout\(/);
assert.match(fn("runSync"), /quiet: true,\s*union: true,\s*differ: completedDiffer/);
assert.match(fn("runSync"), /no GitHub token on this device/);
assert.match(appSrc, /visibilitychange[\s\S]{0,600}runSync\(\)/);
assert.match(appSrc, /\.then\(\(\) => \{\s*runSync\(\);/);
assert.match(appSrc, /const PROGRESS_KEY = "wiki-insights-progress-v1";/, "localStorage key unchanged");
assert.match(appSrc, /GhSync\.save\("wiki-insights"/, "app id unchanged");
console.log("insights sync tests passed");
