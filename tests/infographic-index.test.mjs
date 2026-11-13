/**
 * Run: node tests/infographic-index.test.mjs
 * The manifest parser lives inside the insights IIFE; lift that one function out.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../insights/app.js", import.meta.url), "utf8");
const start = src.indexOf("function infographicIdsFromIndex");
const end = src.indexOf("function loadInfographicIndex");
assert.ok(start > 0 && end > start, "infographicIdsFromIndex is present");
const infographicIdsFromIndex = new Function(`${src.slice(start, end)} return infographicIdsFromIndex;`)();

function ids(data) {
  const set = infographicIdsFromIndex(data);
  return set ? [...set] : set;
}

assert.deepEqual(ids(["abc", " def ", "", "  "]), ["abc", "def"]);
assert.deepEqual(ids([{ video_id: "abc" }, { id: "def" }, { videoId: "ghi" }, { title: "nope" }]), [
  "abc",
  "def",
  "ghi",
]);
assert.deepEqual(ids({ abc: true, def: { w: 1920 }, skip: false, blank: "" }), ["abc", "def"]);
assert.deepEqual(ids({ video_ids: ["abc", "def"] }), ["abc", "def"]);
assert.deepEqual(ids({ ids: [{ video_id: "abc" }] }), ["abc"]);
assert.deepEqual(ids({ videos: { xyz: true, nope: false } }), ["xyz"]);
assert.deepEqual(ids({ generated: "today", items: ["abc"] }), ["abc"]);
assert.deepEqual(ids([]), []);
assert.equal(ids(null), null);
assert.equal(ids("abc"), null);
assert.equal(ids(3), null);
console.log("infographic index parser ok");
