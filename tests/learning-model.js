"use strict";

const assert = require("assert");
const WikiLearning = require("../learning.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const TODAY = "2026-09-19";

function emptyStore(extra) {
  return Object.assign(WikiLearning.migrateStore(null), extra || {});
}

function dueFirst(queue, slugsDue, introduced) {
  const due = new Set(slugsDue);
  const firstNew = queue.findIndex((s) => !due.has(s));
  if (firstNew === -1) {
    assert.ok(queue.every((s) => due.has(s)), "queue should be due-only");
    return;
  }
  assert.ok(
    queue.slice(0, firstNew).every((s) => due.has(s)),
    "due slugs must come before new slugs"
  );
  assert.ok(
    queue.slice(firstNew).every((s) => introduced.includes(s)),
    "tail of queue should be introduced new slugs"
  );
}

// 1. migrateStore recovers garbage + adds goal/newToday; preserves st:"known"
{
  for (const garbage of [null, undefined, "nope", 0, 42, true]) {
    const store = WikiLearning.migrateStore(garbage);
    assert.deepStrictEqual(store.cards, {});
    assert.deepStrictEqual(store.streak, { last: null, count: 0 });
    assert.deepStrictEqual(store.libOpen, {});
    assert.strictEqual(store.goal, 5);
    assert.deepStrictEqual(store.newToday, { date: null, slugs: [] });
  }

  const preserved = WikiLearning.migrateStore({
    cards: { foo: { st: "known", reps: 4, int: 12, ease: 2.5, due: 99 } },
    streak: { last: "2026-09-01", count: 6 },
    libOpen: { agents: true },
    goal: 10,
  });
  assert.strictEqual(preserved.cards.foo.st, "known");
  assert.ok(Array.isArray(preserved.cards.foo.lg));
  assert.strictEqual(preserved.streak.count, 6);
  assert.strictEqual(preserved.libOpen.agents, true);
  assert.strictEqual(preserved.goal, 10);
  assert.ok(preserved.newToday);
  assert.ok(Array.isArray(preserved.newToday.slugs));

  const coerced = WikiLearning.migrateStore({ goal: 7, cards: { x: { st: "known" } } });
  assert.ok(WikiLearning.GOAL_CHOICES.includes(coerced.goal));
  assert.strictEqual(coerced.cards.x.st, "known");
}

// 2. isFluent false until int>=21 and last two lg grades >=2
{
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 20, lg: [2, 2] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 21, lg: [2] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 21, lg: [3] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 21, lg: [2, 1] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 21, lg: [1, 2] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 21, lg: [0, 3] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: "known", int: 21, lg: [2, 2] }), false);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 21, lg: [2, 2] }), true);
  assert.strictEqual(WikiLearning.isFluent({ st: null, int: 30, lg: [1, 2, 3] }), true);
}

// 3. applyGrade first Hard=1, first Good=2, first Easy=4 (Hard ≠ Good)
{
  const blank = WikiLearning.emptyCard();
  const hard = WikiLearning.applyGrade(blank, 1, NOW);
  const good = WikiLearning.applyGrade(blank, 2, NOW);
  const easy = WikiLearning.applyGrade(blank, 3, NOW);

  assert.strictEqual(hard.intervalDays, 1);
  assert.strictEqual(good.intervalDays, 2);
  assert.strictEqual(easy.intervalDays, 4);
  assert.notStrictEqual(hard.intervalDays, good.intervalDays);
  assert.strictEqual(blank.reps, 0);
  assert.deepStrictEqual(blank.lg, []);
  assert.strictEqual(hard.card.int, 1);
  assert.strictEqual(good.card.int, 2);
  assert.strictEqual(easy.card.int, 4);
  assert.strictEqual(hard.card.due, NOW + 1 * DAY);
  assert.strictEqual(good.card.due, NOW + 2 * DAY);
  assert.strictEqual(easy.card.due, NOW + 4 * DAY);
}

// 4. Again does not mark skipped/known; sets unknown
{
  const again = WikiLearning.applyGrade(WikiLearning.emptyCard(), 0, NOW);
  assert.strictEqual(again.card.st, "unknown");
  assert.notStrictEqual(again.card.st, "known");
  assert.strictEqual(WikiLearning.isSkipped(again.card), false);
  assert.strictEqual(again.intervalDays, 0);
  assert.strictEqual(again.card.int, 0);
  assert.strictEqual(again.card.due, NOW);
}

// 5. buildQueue: due first; new capped by 8/day leftover; starting queue <=20
{
  assert.strictEqual(WikiLearning.NEW_PER_DAY, 8);
  assert.strictEqual(WikiLearning.SESSION_CAP, 20);

  const store = emptyStore();
  const slugsDue = ["d1", "d2"];
  const slugsNew = ["n1", "n2", "n3"];
  const mixed = WikiLearning.buildQueue({ slugsDue, slugsNew, store, today: TODAY });
  assert.ok(mixed.queue.length <= 20);
  assert.ok(slugsDue.every((s) => mixed.queue.includes(s)));
  dueFirst(mixed.queue, slugsDue, mixed.introduced);
  assert.ok(mixed.introduced.every((s) => slugsNew.includes(s)));
  assert.ok(mixed.introduced.length <= 8);

  const leftoverStore = emptyStore({
    newToday: { date: TODAY, slugs: ["a", "b", "c", "d", "e"] },
  });
  assert.strictEqual(WikiLearning.newBudgetRemaining(leftoverStore, TODAY), 3);
  const leftover = WikiLearning.buildQueue({
    slugsDue: ["due-a"],
    slugsNew: ["n1", "n2", "n3", "n4", "n5"],
    store: leftoverStore,
    today: TODAY,
  });
  assert.ok(leftover.introduced.length <= 3);
  assert.ok(leftover.queue.length <= 20);
  assert.ok(leftover.queue.length <= 1 + 3);
  dueFirst(leftover.queue, ["due-a"], leftover.introduced);

  const due25 = Array.from({ length: 25 }, (_, i) => "due-" + i);
  const overflow = WikiLearning.buildQueue({
    slugsDue: due25,
    slugsNew: ["fresh-1", "fresh-2"],
    store,
    today: TODAY,
  });
  assert.strictEqual(overflow.queue.length, 20);
  assert.deepStrictEqual(overflow.introduced, []);
  assert.ok(overflow.queue.every((s) => due25.includes(s)));
}

// 6. recordIntroduced then newBudgetRemaining drops
{
  const store = emptyStore();
  assert.strictEqual(WikiLearning.newBudgetRemaining(store, TODAY), 8);
  WikiLearning.recordIntroduced(store, ["a", "b", "c"], TODAY);
  assert.strictEqual(WikiLearning.newBudgetRemaining(store, TODAY), 5);
  WikiLearning.recordIntroduced(store, ["c", "d"], TODAY);
  assert.strictEqual(WikiLearning.newBudgetRemaining(store, TODAY), 4);
  assert.strictEqual(store.newToday.date, TODAY);
  assert.ok(store.newToday.slugs.includes("a"));
  assert.ok(store.newToday.slugs.includes("d"));
}

// 7. bumpReviewStreak consecutive local days; gap resets
{
  const streak = { last: null, count: 0 };
  WikiLearning.bumpReviewStreak(streak, "2026-09-17");
  assert.strictEqual(streak.count, 1);
  assert.strictEqual(streak.last, "2026-09-17");
  WikiLearning.bumpReviewStreak(streak, "2026-09-18");
  assert.strictEqual(streak.count, 2);
  WikiLearning.bumpReviewStreak(streak, "2026-09-19");
  assert.strictEqual(streak.count, 3);
  WikiLearning.bumpReviewStreak(streak, "2026-09-19");
  assert.strictEqual(streak.count, 3);
  WikiLearning.bumpReviewStreak(streak, "2026-09-21");
  assert.strictEqual(streak.count, 1);
  assert.strictEqual(streak.last, "2026-09-21");
}

// 8. missBand thresholds 0.11 easy, 0.12 zone, 0.3 hard, 0.4 over
{
  assert.strictEqual(WikiLearning.missBand(0.11), "easy");
  assert.strictEqual(WikiLearning.missBand(0.12), "zone");
  assert.strictEqual(WikiLearning.missBand(0.3), "hard");
  assert.strictEqual(WikiLearning.missBand(0.4), "over");
}

// 9. goalProgress met when done>=goal
{
  const met = WikiLearning.goalProgress(5, 5);
  assert.strictEqual(met.met, true);
  assert.strictEqual(met.done, 5);
  assert.strictEqual(met.goal, 5);
  assert.strictEqual(WikiLearning.goalProgress(4, 5).met, false);
  assert.strictEqual(WikiLearning.goalProgress(10, 5).met, true);
  assert.strictEqual(WikiLearning.goalProgress(0, 20).met, false);
}

console.log("ok");
process.exit(0);
