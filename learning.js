/* Wiki Flashcards — pure learning model. Browser + Node, no DOM/storage. */
(function (root) {
  "use strict";

  var DAY = 24 * 60 * 60 * 1000;
  var NEW_PER_DAY = 8;
  var SESSION_CAP = 20;
  var FLUENT_INTERVAL = 21;
  var GOAL_CHOICES = [5, 10, 20];
  var DEFAULT_GOAL = 5;

  function todayKey(date) {
    var d = date || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function emptyCard() {
    return { st: null, reps: 0, int: 0, ease: 2.5, due: 0, lg: [] };
  }

  function cloneCard(card) {
    var base = emptyCard();
    if (!card || typeof card !== "object") return base;
    return {
      st: card.st === undefined ? null : card.st,
      reps: Number(card.reps) || 0,
      int: Number(card.int) || 0,
      ease: typeof card.ease === "number" && !isNaN(card.ease) ? card.ease : 2.5,
      due: Number(card.due) || 0,
      lg: Array.isArray(card.lg) ? card.lg.slice() : []
    };
  }

  function migrateStore(raw) {
    var out = {
      cards: {},
      streak: { last: null, count: 0 },
      libOpen: {},
      goal: DEFAULT_GOAL,
      newToday: { date: null, slugs: [] }
    };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;

    if (raw.cards && typeof raw.cards === "object" && !Array.isArray(raw.cards)) {
      Object.keys(raw.cards).forEach(function (slug) {
        var c = raw.cards[slug];
        if (!c || typeof c !== "object") {
          out.cards[slug] = emptyCard();
          return;
        }
        var next = Object.assign({}, c);
        if (!Array.isArray(next.lg)) next.lg = [];
        out.cards[slug] = next;
      });
    }

    if (raw.streak && typeof raw.streak === "object") {
      out.streak = {
        last: raw.streak.last == null ? null : raw.streak.last,
        count: Number(raw.streak.count) || 0
      };
    }
    if (raw.libOpen && typeof raw.libOpen === "object" && !Array.isArray(raw.libOpen)) {
      out.libOpen = Object.assign({}, raw.libOpen);
    }
    if (GOAL_CHOICES.indexOf(raw.goal) !== -1) out.goal = raw.goal;
    if (raw.newToday && typeof raw.newToday === "object") {
      out.newToday = {
        date: raw.newToday.date == null ? null : raw.newToday.date,
        slugs: Array.isArray(raw.newToday.slugs) ? raw.newToday.slugs.slice() : []
      };
    }
    return out;
  }

  function isSkipped(card) {
    return !!(card && card.st === "known");
  }

  function isNew(card) {
    return !card || ((Number(card.reps) || 0) === 0 && !isSkipped(card));
  }

  function isDue(card, now) {
    if (!card || isSkipped(card)) return false;
    return ((Number(card.reps) || 0) > 0 || card.st === "unknown") && card.due <= now;
  }

  function isFluent(card) {
    if (!card || isSkipped(card)) return false;
    if ((Number(card.int) || 0) < FLUENT_INTERVAL) return false;
    var lg = Array.isArray(card.lg) ? card.lg : [];
    if (lg.length < 2) return false;
    return lg[lg.length - 2] >= 2 && lg[lg.length - 1] >= 2;
  }

  function isLearning(card, now) {
    return !isSkipped(card) && !isNew(card) && !isFluent(card);
  }

  function scheduledDays(int, ease, grade) {
    if (grade === 0) return 0;
    if (grade === 1) return int === 0 ? 1 : Math.max(int + 1, Math.round(int * 1.2));
    if (grade === 2) return int === 0 ? 2 : Math.round(int * ease);
    var easyEase = Math.min(3.0, ease + 0.15);
    return int === 0 ? 4 : Math.round(int * easyEase * 1.3);
  }

  function applyGrade(card, grade, now) {
    var next = cloneCard(card);
    var wasFluent = isFluent(next);
    var oldInt = next.int;
    var intervalDays = scheduledDays(oldInt, next.ease, grade);

    next.lg.push(grade);
    if (next.lg.length > 4) next.lg = next.lg.slice(-4);
    next.reps += 1;

    if (grade === 0) {
      next.ease = Math.max(1.3, next.ease - 0.2);
      next.int = 0;
      next.due = now;
      next.st = "unknown";
      intervalDays = 0;
    } else {
      if (grade === 1) next.ease = Math.max(1.3, next.ease - 0.15);
      else if (grade === 3) next.ease = Math.min(3.0, next.ease + 0.15);
      next.int = Math.min(intervalDays, 365);
      intervalDays = next.int;
      next.due = now + next.int * DAY;
      if (next.st === "unknown" && grade >= 2) next.st = null;
    }

    return {
      card: next,
      becameFluent: !wasFluent && isFluent(next),
      intervalDays: intervalDays
    };
  }

  function previewIntervalDays(card, grade) {
    var c = cloneCard(card);
    return Math.min(scheduledDays(c.int, c.ease, grade), grade === 0 ? 0 : 365);
  }

  function previewIntervalLabel(days) {
    if (days === 1) return "1 day";
    if (days < 30) return days + " days";
    return Math.round(days / 30) + " mo";
  }

  function takenNewSlugs(store, today) {
    var nt = store && store.newToday;
    if (!nt || nt.date !== today || !Array.isArray(nt.slugs)) return [];
    var seen = {};
    var out = [];
    nt.slugs.forEach(function (s) {
      if (s != null && s !== "" && !seen[s]) {
        seen[s] = true;
        out.push(s);
      }
    });
    return out;
  }

  function newBudgetRemaining(store, today) {
    return Math.max(0, NEW_PER_DAY - takenNewSlugs(store, today).length);
  }

  function buildQueue(opts) {
    opts = opts || {};
    var slugsDue = Array.isArray(opts.slugsDue) ? opts.slugsDue : [];
    var slugsNew = Array.isArray(opts.slugsNew) ? opts.slugsNew : [];
    var due = slugsDue.slice(0, SESSION_CAP);
    var room = SESSION_CAP - due.length;
    var take = Math.min(newBudgetRemaining(opts.store, opts.today), Math.max(0, room));
    var dueSet = {};
    due.forEach(function (s) { dueSet[s] = true; });
    var introduced = [];
    for (var i = 0; i < slugsNew.length && introduced.length < take; i++) {
      var slug = slugsNew[i];
      if (!dueSet[slug]) introduced.push(slug);
    }
    return { queue: due.concat(introduced), introduced: introduced };
  }

  function recordIntroduced(store, slugs, today) {
    var prev = takenNewSlugs(store, today);
    var seen = {};
    prev.forEach(function (s) { seen[s] = true; });
    var next = prev.slice();
    (slugs || []).forEach(function (s) {
      if (s != null && s !== "" && !seen[s]) {
        seen[s] = true;
        next.push(s);
      }
    });
    store.newToday = { date: today, slugs: next };
    return store;
  }

  function sessionMissRate(counts) {
    counts = counts || {};
    var again = Number(counts.again) || 0;
    var hard = Number(counts.hard) || 0;
    var good = Number(counts.good) || 0;
    var easy = Number(counts.easy) || 0;
    var total = again + hard + good + easy;
    return total ? (again + hard) / total : 0;
  }

  function missBand(rate) {
    if (rate < 0.12) return "easy";
    if (rate <= 0.25) return "zone";
    if (rate <= 0.35) return "hard";
    return "over";
  }

  function missCopy(band) {
    if (band === "easy") return "Too easy. Add a weaker section next, or stop for today.";
    if (band === "zone") return "In the bitter zone. This is the useful difficulty.";
    if (band === "hard") return "Challenging. Stay on due cards tomorrow.";
    return "Overloaded. Cut new cards to 0 tomorrow. Stay on leaking + due.";
  }

  function prevDayKey(key) {
    var parts = String(key).split("-").map(Number);
    return todayKey(new Date(parts[0], parts[1] - 1, parts[2] - 1));
  }

  function bumpReviewStreak(streak, today) {
    var s = streak && typeof streak === "object" ? streak : { last: null, count: 0 };
    if (s.last === today) {
      if (!s.count) s.count = 0;
      return s;
    }
    s.count = s.last === prevDayKey(today) ? (Number(s.count) || 0) + 1 : 1;
    s.last = today;
    return s;
  }

  function goalProgress(todayReviews, goal) {
    var g = GOAL_CHOICES.indexOf(goal) !== -1 ? goal : DEFAULT_GOAL;
    var done = Math.max(0, Number(todayReviews) || 0);
    return { goal: g, done: done, met: done >= g };
  }

  var WikiLearning = {
    NEW_PER_DAY: NEW_PER_DAY,
    SESSION_CAP: SESSION_CAP,
    FLUENT_INTERVAL: FLUENT_INTERVAL,
    GOAL_CHOICES: GOAL_CHOICES,
    DEFAULT_GOAL: DEFAULT_GOAL,
    todayKey: todayKey,
    migrateStore: migrateStore,
    emptyCard: emptyCard,
    isSkipped: isSkipped,
    isNew: isNew,
    isDue: isDue,
    isFluent: isFluent,
    isLearning: isLearning,
    applyGrade: applyGrade,
    previewIntervalDays: previewIntervalDays,
    previewIntervalLabel: previewIntervalLabel,
    newBudgetRemaining: newBudgetRemaining,
    buildQueue: buildQueue,
    recordIntroduced: recordIntroduced,
    sessionMissRate: sessionMissRate,
    missBand: missBand,
    missCopy: missCopy,
    bumpReviewStreak: bumpReviewStreak,
    goalProgress: goalProgress
  };

  root.WikiLearning = WikiLearning;
  if (typeof module !== "undefined" && module.exports) module.exports = WikiLearning;
})(typeof globalThis !== "undefined" ? globalThis : this);
