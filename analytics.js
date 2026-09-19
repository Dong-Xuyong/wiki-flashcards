/* Wiki Flashcards — local analytics + game progress. */
(() => {
  "use strict";

  const STORE_KEY = "wiki-flashcards-analytics-v1";
  const MAX_EVENTS = 2000;
  const MAX_DAYS = 180;
  const XP_PER_LEVEL = 100;
  const GRADE_KEYS = ["again", "hard", "good", "easy"];
  const GRADE_INDEX = { 0: "again", 1: "hard", 2: "good", 3: "easy" };

  function localDateKey(value = Date.now()) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function shiftDateKey(key, days) {
    const [y, m, d] = String(key).split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }
  function todayKey() { return localDateKey(); }
  function parseDay(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function emptyDay() {
    return { reviews: 0, known: 0, unknown: 0, again: 0, hard: 0, good: 0, easy: 0 };
  }
  function emptyStore() {
    return {
      events: [],
      days: {},
      dailyGoalDays: 0,
      sessionsCompleted: 0,
      earnedBadges: [],
      seenBadges: [],
      bootstrapped: false,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return emptyStore();
      if (!Array.isArray(data.events)) data.events = [];
      if (!data.days || typeof data.days !== "object") data.days = {};
      data.dailyGoalDays = Number(data.dailyGoalDays) || 0;
      data.sessionsCompleted = Number(data.sessionsCompleted) || 0;
      if (!Array.isArray(data.earnedBadges)) data.earnedBadges = [];
      if (!Array.isArray(data.seenBadges)) data.seenBadges = [];
      data.bootstrapped = data.bootstrapped === true;
      return data;
    } catch (e) {
      return emptyStore();
    }
  }
  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
  }
  function prune(data) {
    if (data.events.length > MAX_EVENTS) data.events = data.events.slice(-MAX_EVENTS);
    const cutoff = shiftDateKey(todayKey(), -(MAX_DAYS - 1));
    const next = {};
    for (const [k, v] of Object.entries(data.days)) if (k >= cutoff) next[k] = v;
    data.days = next;
    return data;
  }
  function ensureDay(data, key) {
    if (!data.days[key]) data.days[key] = emptyDay();
    return data.days[key];
  }
  function persistNum(entry, event, key) {
    if (event[key] != null && Number.isFinite(Number(event[key]))) entry[key] = Number(event[key]);
  }

  function record(event) {
    if (!event || typeof event !== "object" || !event.type) return null;
    const data = load();
    const t = typeof event.t === "number" ? event.t : Date.now();
    const type = String(event.type);
    const entry = { t, type };
    if (event.slug != null) entry.slug = String(event.slug);
    if (event.sectionId != null) entry.sectionId = String(event.sectionId);
    if (event.videoSlug != null) entry.videoSlug = String(event.videoSlug);
    persistNum(entry, event, "cards");
    persistNum(entry, event, "goal");
    persistNum(entry, event, "queueLen");
    for (const k of GRADE_KEYS) persistNum(entry, event, k);
    if (event.grade != null && Number.isFinite(Number(event.grade))) {
      const g = Number(event.grade);
      if (g >= 0 && g <= 3) entry.grade = g;
    }

    if (type === "daily_goal_met") {
      const day = localDateKey(t);
      const already = data.events.some((e) => e.type === "daily_goal_met" && localDateKey(e.t) === day);
      if (!already) data.dailyGoalDays += 1;
    }
    if (type === "session_end" && (entry.cards || 0) >= 5) data.sessionsCompleted += 1;

    data.events.push(entry);
    const d = ensureDay(data, localDateKey(t));
    if (type === "review") {
      d.reviews += 1;
      if (entry.grade != null && GRADE_INDEX[entry.grade]) d[GRADE_INDEX[entry.grade]] += 1;
    } else if (type === "known") d.known += 1;
    else if (type === "unknown") d.unknown += 1;
    prune(data);
    save(data);
    return entry;
  }

  function dayIsActive(d) {
    return !!d && (d.reviews || 0) + (d.known || 0) + (d.unknown || 0) > 0;
  }
  function dayStreakStudy(data) {
    const today = todayKey();
    const has = (k) => dayIsActive(data.days[k]);
    let cursor = today;
    if (!has(today)) {
      const yesterday = shiftDateKey(today, -1);
      if (!has(yesterday)) return 0;
      cursor = yesterday;
    }
    let streak = 0;
    while (has(cursor)) {
      streak += 1;
      cursor = shiftDateKey(cursor, -1);
    }
    return streak;
  }

  function getSummary() {
    const data = load();
    const today = todayKey();
    const start30 = shiftDateKey(today, -29);
    let totalReviews = 0, knownMarks = 0, last30Reviews = 0, activeDays30 = 0;
    const todayRoll = data.days[today] || emptyDay();
    for (const [k, d] of Object.entries(data.days)) {
      totalReviews += d.reviews || 0;
      knownMarks += d.known || 0;
      if (k >= start30 && k <= today) {
        last30Reviews += d.reviews || 0;
        if (dayIsActive(d)) activeDays30 += 1;
      }
    }
    return {
      totalReviews,
      knownMarks,
      todayReviews: todayRoll.reviews || 0,
      dayStreakStudy: dayStreakStudy(data),
      last30Reviews,
      activeDays30,
      today: {
        date: today,
        reviews: todayRoll.reviews || 0,
        known: todayRoll.known || 0,
        unknown: todayRoll.unknown || 0,
        again: todayRoll.again || 0,
        hard: todayRoll.hard || 0,
        good: todayRoll.good || 0,
        easy: todayRoll.easy || 0,
      },
    };
  }

  function getTimeline(days) {
    const n = Math.max(1, Math.min(MAX_DAYS, Number(days) || 30));
    const data = load();
    const today = todayKey();
    const start = shiftDateKey(today, -(n - 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const date = shiftDateKey(start, i);
      const d = data.days[date] || emptyDay();
      out.push({
        date,
        reviews: d.reviews || 0,
        known: d.known || 0,
        unknown: d.unknown || 0,
        grades: { again: d.again || 0, hard: d.hard || 0, good: d.good || 0, easy: d.easy || 0 },
      });
    }
    return out;
  }

  function getKnownProgress(days, getKnownCountFn) {
    const n = Math.max(1, Math.min(MAX_DAYS, Number(days) || 30));
    const today = todayKey();
    const start = shiftDateKey(today, -(n - 1));
    const series = [];
    if (typeof getKnownCountFn === "function") {
      let current;
      try { current = Number(getKnownCountFn(today)); } catch (e) { current = Number(getKnownCountFn()); }
      if (!Number.isFinite(current)) current = 0;
      for (let i = 0; i < n; i++) {
        const date = shiftDateKey(start, i);
        let value = current;
        try {
          const v = Number(getKnownCountFn(date));
          if (Number.isFinite(v)) value = v;
        } catch (e) { /* keep */ }
        series.push({ date, known: value });
      }
      return series;
    }
    const data = load();
    const knownEvents = data.events.filter((e) => e.type === "known" && typeof e.t === "number").sort((a, b) => a.t - b.t);
    let idx = 0, cum = 0;
    const startMs = parseDay(start);
    while (idx < knownEvents.length && knownEvents[idx].t < startMs) { cum += 1; idx += 1; }
    for (let i = 0; i < n; i++) {
      const date = shiftDateKey(start, i);
      const endMs = parseDay(shiftDateKey(date, 1));
      while (idx < knownEvents.length && knownEvents[idx].t < endMs) { cum += 1; idx += 1; }
      series.push({ date, known: cum });
    }
    return series;
  }

  function sumDays(data) {
    let totalReviews = 0, good = 0, easy = 0;
    for (const d of Object.values(data.days || {})) {
      totalReviews += d.reviews || 0;
      good += d.good || 0;
      easy += d.easy || 0;
    }
    return { totalReviews, good, easy };
  }
  function computeXp(data, totals) {
    const t = totals || sumDays(data);
    return t.totalReviews + (t.good + t.easy) + 5 * (data.sessionsCompleted || 0) + 10 * (data.dailyGoalDays || 0);
  }
  function helperDueCount(helpers) {
    if (!helpers) return undefined;
    if (helpers.dueCount != null && Number.isFinite(Number(helpers.dueCount))) return Number(helpers.dueCount);
    if (typeof helpers.stats === "function") {
      try {
        const ss = helpers.stats(null) || {};
        if (ss.due != null && Number.isFinite(Number(ss.due))) return Number(ss.due);
      } catch (e) { /* ignore */ }
    }
    return undefined;
  }

  function buildAchievements(data, helpers) {
    const totals = sumDays(data);
    const streak = dayStreakStudy(data);
    const dueCount = helperDueCount(helpers);
    const earned = Array.isArray(data.earnedBadges) ? data.earnedBadges : [];
    const defs = [
      { id: "first-review", icon: "★", title: "First review", description: "Grade your first card", current: totals.totalReviews, goal: 1 },
      { id: "first-session", icon: "✓", title: "First session", description: "Finish a session of 5+ cards", current: data.sessionsCompleted || 0, goal: 1 },
      { id: "three-day-rhythm", icon: "3", title: "Three-day rhythm", description: "Study three days in a row", current: streak, goal: 3 },
      { id: "caught-up", icon: "◇", title: "Caught up", description: "Finish a day with no cards due", current: dueCount === 0 && totals.totalReviews > 0 ? 1 : 0, goal: 1 },
      { id: "seven-day-streak", icon: "7", title: "Seven-day streak", description: "Study seven days in a row", current: streak, goal: 7 },
    ];
    return defs.map((badge) => {
      const qualified = badge.current >= badge.goal;
      return { ...badge, current: Math.min(badge.current, badge.goal), qualified, unlocked: qualified || earned.includes(badge.id) };
    });
  }

  function getProgress(helpers) {
    const data = load();
    const totals = sumDays(data);
    const xp = computeXp(data, totals);
    const badges = buildAchievements(data, helpers);
    const todayRoll = data.days[todayKey()] || emptyDay();
    return {
      xp,
      level: Math.floor(xp / XP_PER_LEVEL) + 1,
      levelXp: xp % XP_PER_LEVEL,
      xpPerLevel: XP_PER_LEVEL,
      streak: dayStreakStudy(data),
      todayReviews: todayRoll.reviews || 0,
      totalReviews: totals.totalReviews,
      sessionsCompleted: data.sessionsCompleted || 0,
      dailyGoalDays: data.dailyGoalDays || 0,
      badges,
      nextBadge: badges.find((b) => !b.unlocked) || null,
    };
  }
  function achievements(helpers) { return buildAchievements(load(), helpers); }

  function bootstrapGamification(helpers) {
    const data = load();
    if (data.bootstrapped) return;
    const ids = buildAchievements(data, helpers).filter((b) => b.qualified).map((b) => b.id);
    data.bootstrapped = true;
    data.earnedBadges = ids;
    data.seenBadges = ids;
    save(data);
  }

  function toast(msg) {
    if (typeof document === "undefined") return;
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function celebrateNewAchievements(helpers) {
    const data = load();
    if (!data.bootstrapped) {
      bootstrapGamification(helpers);
      return;
    }
    const fresh = buildAchievements(data, helpers).filter((b) => b.qualified && !data.earnedBadges.includes(b.id));
    if (!fresh.length) return;
    data.earnedBadges = [...new Set([...data.earnedBadges, ...fresh.map((b) => b.id)])];
    data.seenBadges = [...new Set([...(data.seenBadges || []), ...fresh.map((b) => b.id)])];
    save(data);
    toast(`Achievement unlocked: ${fresh[0].title}${fresh.length > 1 ? ` +${fresh.length - 1} more` : ""}`);
  }

  function formatShortDate(key) {
    return new Date(key + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function weekInsight(timeline) {
    const last7 = timeline.slice(-7);
    const reviews = last7.reduce((s, d) => s + d.reviews, 0);
    const active = last7.filter((d) => d.reviews + d.known + d.unknown > 0).length;
    return `${reviews} review${reviews === 1 ? "" : "s"} this week · ${active} active day${active === 1 ? "" : "s"}`;
  }
  function bestDay(timeline) {
    let best = null;
    for (const d of timeline) if (!best || d.reviews > best.reviews) best = d;
    if (!best || best.reviews === 0) return { label: "—", reviews: 0 };
    return { label: formatShortDate(best.date), reviews: best.reviews };
  }
  function xpBar(pct, label, esc) {
    return `<div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(label)}"><span class="progress-fill" style="width:${pct}%"></span></div>`;
  }
  function deckStats(helpers) {
    if (typeof helpers.stats === "function") {
      try { return helpers.stats(null) || {}; } catch (e) { return {}; }
    }
    return {};
  }
  function knownCount(helpers, deck) {
    if (deck && deck.known != null) return Number(deck.known) || 0;
    const DATA = helpers.DATA, isKnown = helpers.isKnown;
    if (DATA && Array.isArray(DATA.concepts) && typeof isKnown === "function") {
      let n = 0;
      for (const c of DATA.concepts) { try { if (isKnown(c.slug)) n += 1; } catch (e) { /* skip */ } }
      return n;
    }
    return 0;
  }

  function render(container, helpers) {
    if (!container) return;
    helpers = helpers || {};
    const esc = helpers.esc || ((s) => String(s));
    const statsFn = helpers.stats;
    const DATA = helpers.DATA;
    const sectionOf = helpers.sectionOf;
    const isKnown = helpers.isKnown;

    const deck = deckStats(helpers);
    const progressHelpers = Object.assign({}, helpers, {
      dueCount: helpers.dueCount != null && Number.isFinite(Number(helpers.dueCount))
        ? Number(helpers.dueCount)
        : (deck.due != null ? Number(deck.due) : undefined),
    });
    if (!load().bootstrapped) bootstrapGamification(progressHelpers);

    const summary = getSummary();
    const timeline = getTimeline(30);
    const progress = getProgress(progressHelpers);
    const knownCurrent = knownCount(helpers, deck);
    const insight = weekInsight(timeline);
    const best = bestDay(timeline);
    const maxReviews = Math.max(1, ...timeline.map((d) => d.reviews));
    const today = todayKey();
    const levelPct = Math.round((progress.levelXp / XP_PER_LEVEL) * 100);
    const nextBadge = progress.nextBadge;
    const hasActivity = timeline.some((d) => d.reviews + d.known + d.unknown > 0);

    const bars = timeline.map((d) => {
      const pct = Math.round((d.reviews / maxReviews) * 100);
      const h = d.reviews === 0 ? 3 : Math.max(10, pct);
      const cls = ["progress-chart-bar", d.reviews === 0 ? "is-empty" : "", d.date === today ? "is-today" : ""].filter(Boolean).join(" ");
      return `<div class="${cls}" style="height:${h}%" title="${esc(d.date + ": " + d.reviews + " reviews")}" aria-label="${esc(formatShortDate(d.date) + ": " + d.reviews + " reviews")}" role="img"></div>`;
    }).join("");

    const heat = timeline.map((d) => {
      const n = d.reviews || 0;
      let lvl = 0;
      if (n >= 20) lvl = 4;
      else if (n >= 10) lvl = 3;
      else if (n >= 4) lvl = 2;
      else if (n >= 1) lvl = 1;
      return `<span class="heatmap-cell l${lvl}" title="${esc(d.date + ": " + n)}" aria-hidden="true"></span>`;
    }).join("");

    const recentDays = [...timeline].reverse().filter((d) => d.reviews + d.known + d.unknown > 0).slice(0, 14);
    let timelineHtml;
    if (!hasActivity) {
      timelineHtml = `<div class="timeline-empty" role="status"><p>No study activity yet.</p><p>Grade a few cards in Study — the timeline lights up here.</p></div>`;
    } else {
      timelineHtml = `<div class="timeline" aria-label="Recent study days"><div class="timeline-head">Activity</div>${
        recentDays.map((d) => {
          const fill = Math.max(d.reviews ? 12 : 0, Math.round(Math.min(1, d.reviews / maxReviews) * 100));
          const parts = [];
          if (d.reviews) parts.push(`${d.reviews} review${d.reviews === 1 ? "" : "s"}`);
          if (d.known) parts.push(`${d.known} known`);
          if (d.unknown) parts.push(`${d.unknown} unknown`);
          const gradeBits = GRADE_KEYS.filter((k) => d.grades[k] > 0).map((k) => `${d.grades[k]} ${k}`).join(", ");
          const detail = gradeBits ? ` · ${gradeBits}` : "";
          return `<div class="timeline-day timeline-day-wide">
            <span class="day-label">${esc(formatShortDate(d.date))}</span>
            <div class="timeline-bar" title="${esc(parts.join(" · ") + detail)}"><span style="width:${fill}%"></span></div>
            <span class="day-count">${esc(String(d.reviews))}</span>
            <span class="timeline-counts">${esc(parts.join(" · ") + detail)}</span>
          </div>`;
        }).join("")
      }</div>`;
    }

    let sectionsHtml = "";
    if (DATA && Array.isArray(DATA.sections)) {
      const rows = DATA.sections.map((s) => {
        let known = 0, total = 0;
        if (typeof statsFn === "function") {
          try {
            const ss = statsFn(s.id) || {};
            total = ss.total || 0;
            known = ss.known || 0;
          } catch (e) { /* skip */ }
        }
        if (!total && DATA.concepts && typeof isKnown === "function") {
          const inSection = DATA.concepts.filter((c) => c.section === s.id);
          total = inSection.length;
          for (const c of inSection) { try { if (isKnown(c.slug)) known += 1; } catch (e) { /* skip */ } }
        }
        if (!total) return "";
        const pct = Math.round((known / total) * 100);
        const title = typeof sectionOf === "function" ? (sectionOf(s.id) || s).title || s.id : s.title || s.id;
        const color = (s && s.color) || "#3ecfbf";
        return `<div class="timeline-day timeline-day-wide">
          <span class="day-label" style="color:${esc(color)}">${esc(title)}</span>
          <div class="timeline-bar"><span style="width:${pct}%;background:${esc(color)}"></span></div>
          <span class="day-count">${esc(String(pct))}%</span>
          <span class="timeline-counts">${esc(`${known} known`)}</span>
        </div>`;
      }).filter(Boolean).join("");
      if (rows) {
        sectionsHtml = `<h2 class="head">By section</h2><div class="timeline" aria-label="Known progress by section"><div class="timeline-head">Known</div>${rows}</div>`;
      }
    }

    const unlockedN = progress.badges.filter((b) => b.unlocked).length;
    container.innerHTML = `
      <div class="analytics-view">
        <section class="level-card" aria-labelledby="level-title">
          <div class="level-orb" aria-hidden="true">${esc(String(progress.level))}</div>
          <div class="level-main">
            <span class="eyebrow">Current level</span>
            <h2 id="level-title">Level ${esc(String(progress.level))}</h2>
            <p>${esc(String(progress.levelXp))} / ${XP_PER_LEVEL} XP to level ${esc(String(progress.level + 1))}</p>
            ${xpBar(levelPct, `${progress.levelXp} of ${XP_PER_LEVEL} XP toward next level`, esc)}
          </div>
          <strong>${esc(String(progress.xp))} XP</strong>
        </section>
        ${nextBadge ? `<section class="next-badge">
          <span class="milestone-icon" aria-hidden="true">${esc(nextBadge.icon)}</span>
          <div><span class="eyebrow">Next achievement</span><h2>${esc(nextBadge.title)}</h2>
          <p>${esc(nextBadge.description)} · ${esc(String(nextBadge.current))}/${esc(String(nextBadge.goal))}</p></div>
        </section>` : ""}
        <section class="home-section" aria-labelledby="badges-title">
          <div class="section-heading">
            <div><span class="eyebrow">Milestones</span><h2 id="badges-title">Achievements</h2></div>
            <span class="achievement-total">${unlockedN}/${progress.badges.length}</span>
          </div>
          <div class="achievement-grid">
            ${progress.badges.map((badge) => `
              <article class="achievement-card ${badge.unlocked ? "unlocked" : "locked"}">
                <div class="achievement-icon" aria-hidden="true">${esc(badge.icon)}</div>
                <h3>${esc(badge.title)}</h3>
                <p>${esc(badge.description)}</p>
                <span>${badge.unlocked ? "Unlocked" : `${esc(String(badge.current))}/${esc(String(badge.goal))}`}</span>
              </article>`).join("")}
          </div>
        </section>
        <p class="local-note">Progress, XP, streaks, and badges are stored only in this browser.</p>
        <header class="analytics-hero">
          <h2>Progress</h2>
          <p>${esc(insight)}</p>
          <div class="hero-meta">
            <span class="hero-chip">${esc(summary.dayStreakStudy || 0)} day study streak</span>
            <span class="hero-chip">${esc(summary.totalReviews || 0)} lifetime reviews</span>
          </div>
        </header>
        <div class="analytics-kpis" role="group" aria-label="Key stats">
          <div class="kpi accent"><div class="kpi-value">${esc(summary.last30Reviews)}</div><div class="kpi-label">Reviews (30d)</div></div>
          <div class="kpi good"><div class="kpi-value">${esc(knownCurrent)}</div><div class="kpi-label">Known</div></div>
          <div class="kpi"><div class="kpi-value">${esc(summary.activeDays30)}</div><div class="kpi-label">Active days</div></div>
          <div class="kpi warn"><div class="kpi-value">${esc(best.reviews ? best.label : "—")}</div><div class="kpi-label">Best day${best.reviews ? esc(` · ${best.reviews}`) : ""}</div></div>
        </div>
        <div class="progress-chart" role="img" aria-label="Bar chart of reviews over the last 30 days">
          <div class="chart-head">
            <span class="chart-title">Reviews · 30 days</span>
            <span class="chart-value">${esc(summary.last30Reviews)}</span>
          </div>
          <div class="progress-chart-track">${bars}</div>
          <div class="heatmap" aria-hidden="true">${heat}</div>
        </div>
        <h2 class="head">Recent activity</h2>
        ${timelineHtml}
        ${sectionsHtml}
      </div>`;
  }

  window.WikiAnalytics = {
    record,
    getSummary,
    getTimeline,
    getKnownProgress,
    render,
    localDateKey,
    getProgress,
    achievements,
    bootstrapGamification,
    celebrateNewAchievements,
    toast,
    XP_PER_LEVEL,
  };
})();
