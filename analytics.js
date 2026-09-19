/* Wiki Flashcards — local learning analytics (timeline + KPIs). */
(() => {
  "use strict";

  const STORE_KEY = "wiki-flashcards-analytics-v1";
  const MAX_EVENTS = 2000;
  const MAX_DAYS = 180;
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
  function todayKey() {
    return localDateKey();
  }
  function parseDay(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  function addDays(key, n) {
    return shiftDateKey(key, n);
  }
  function emptyDay() {
    return { reviews: 0, known: 0, unknown: 0, fluent: 0, again: 0, hard: 0, good: 0, easy: 0 };
  }
  function emptyStore() {
    return { events: [], days: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return emptyStore();
      if (!Array.isArray(data.events)) data.events = [];
      if (!data.days || typeof data.days !== "object") data.days = {};
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
    const cutoff = addDays(todayKey(), -(MAX_DAYS - 1));
    const next = {};
    for (const [k, v] of Object.entries(data.days)) {
      if (k >= cutoff) next[k] = v;
    }
    data.days = next;
    return data;
  }
  function ensureDay(data, key) {
    if (!data.days[key]) data.days[key] = emptyDay();
    return data.days[key];
  }

  function record(event) {
    if (!event || typeof event !== "object" || !event.type) return null;
    const data = load();
    const t = typeof event.t === "number" ? event.t : Date.now();
    const type = String(event.type);
    const entry = { t, type };
    if (event.slug != null) entry.slug = String(event.slug);
    if (event.sectionId != null) entry.sectionId = String(event.sectionId);
    if (event.cards != null && Number.isFinite(Number(event.cards))) entry.cards = Number(event.cards);

    let grade = event.grade;
    if (type === "review" && grade != null) {
      grade = Number(grade);
      if (grade >= 0 && grade <= 3) entry.grade = grade;
      else grade = null;
    }

    data.events.push(entry);
    const d = ensureDay(data, localDateKey(t));
    if (type === "review") {
      d.reviews += 1;
      if (grade != null && GRADE_INDEX[grade]) d[GRADE_INDEX[grade]] += 1;
    } else if (type === "known") {
      d.known += 1;
    } else if (type === "unknown") {
      d.unknown += 1;
    } else if (type === "fluent") {
      d.fluent = (d.fluent || 0) + 1;
    }
    prune(data);
    save(data);
    return entry;
  }

  function dayStreakStudy(data) {
    const today = todayKey();
    const has = (k) => ((data.days[k] || {}).reviews || 0) > 0;
    let cursor = has(today) ? today : addDays(today, -1);
    if (!has(cursor)) return 0;
    let streak = 0;
    while (has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function getSummary() {
    const data = load();
    const today = todayKey();
    const start30 = addDays(today, -29);
    let totalReviews = 0;
    let knownMarks = 0;
    let fluentMarks = 0;
    let last30Reviews = 0;
    let activeDays30 = 0;
    const todayRoll = data.days[today] || emptyDay();
    for (const [k, d] of Object.entries(data.days)) {
      totalReviews += d.reviews || 0;
      knownMarks += d.known || 0;
      fluentMarks += d.fluent || 0;
      if (k >= start30 && k <= today) {
        last30Reviews += d.reviews || 0;
        if ((d.reviews || 0) > 0) activeDays30 += 1;
      }
    }
    if (!fluentMarks) {
      for (const e of data.events) {
        if (e.type === "fluent") fluentMarks += 1;
      }
    }
    return {
      totalReviews,
      knownMarks,
      fluentMarks,
      todayReviews: todayRoll.reviews || 0,
      dayStreakStudy: dayStreakStudy(data),
      last30Reviews,
      activeDays30,
      today: {
        date: today,
        reviews: todayRoll.reviews || 0,
        known: todayRoll.known || 0,
        unknown: todayRoll.unknown || 0,
        fluent: todayRoll.fluent || 0,
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
    const start = addDays(today, -(n - 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const date = addDays(start, i);
      const d = data.days[date] || emptyDay();
      out.push({
        date,
        reviews: d.reviews || 0,
        known: d.known || 0,
        unknown: d.unknown || 0,
        fluent: d.fluent || 0,
        grades: { again: d.again || 0, hard: d.hard || 0, good: d.good || 0, easy: d.easy || 0 },
      });
    }
    return out;
  }

  function getKnownProgress(days, getKnownCountFn) {
    const n = Math.max(1, Math.min(MAX_DAYS, Number(days) || 30));
    const today = todayKey();
    const start = addDays(today, -(n - 1));
    const series = [];
    if (typeof getKnownCountFn === "function") {
      let current;
      try { current = Number(getKnownCountFn(today)); } catch (e) { current = Number(getKnownCountFn()); }
      if (!Number.isFinite(current)) current = 0;
      for (let i = 0; i < n; i++) {
        const date = addDays(start, i);
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
    let idx = 0;
    let cum = 0;
    const startMs = parseDay(start);
    while (idx < knownEvents.length && knownEvents[idx].t < startMs) { cum += 1; idx += 1; }
    for (let i = 0; i < n; i++) {
      const date = addDays(start, i);
      const endMs = parseDay(addDays(date, 1));
      while (idx < knownEvents.length && knownEvents[idx].t < endMs) { cum += 1; idx += 1; }
      series.push({ date, known: cum });
    }
    return series;
  }

  function getRecentlyFluent(limit, helpers) {
    const n = Math.max(1, Math.min(50, Number(limit) || 8));
    const data = load();
    const seen = new Set();
    const out = [];
    const isSkipped = helpers && helpers.isSkipped;
    for (let i = data.events.length - 1; i >= 0 && out.length < n; i--) {
      const e = data.events[i];
      if (!e || e.type !== "fluent" || !e.slug) continue;
      const slug = String(e.slug);
      if (seen.has(slug)) continue;
      if (typeof isSkipped === "function") {
        try { if (isSkipped(slug)) continue; } catch (err) { /* keep */ }
      }
      seen.add(slug);
      out.push({ slug, t: e.t });
    }
    return out;
  }

  function formatShortDate(key) {
    return new Date(key + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function weekInsight(timeline) {
    const last7 = timeline.slice(-7);
    const reviews = last7.reduce((s, d) => s + d.reviews, 0);
    const active = last7.filter((d) => d.reviews > 0).length;
    return `${reviews} review${reviews === 1 ? "" : "s"} this week · ${active} active day${active === 1 ? "" : "s"}`;
  }
  function bestDay(timeline) {
    let best = null;
    for (const d of timeline) {
      if (!best || d.reviews > best.reviews) best = d;
    }
    if (!best || best.reviews === 0) return { label: "—", reviews: 0 };
    return { label: formatShortDate(best.date), reviews: best.reviews };
  }
  function titleForSlug(slug, DATA) {
    if (DATA && Array.isArray(DATA.concepts)) {
      const c = DATA.concepts.find((x) => x.slug === slug);
      if (c && c.title) return c.title;
    }
    return slug;
  }

  function render(container, helpers) {
    if (!container) return;
    helpers = helpers || {};
    const esc = helpers.esc || ((s) => String(s));
    const statsFn = helpers.stats;
    const DATA = helpers.DATA;
    const sectionOf = helpers.sectionOf;
    const isFluent = helpers.isFluent;
    const go = helpers.go;

    const summary = getSummary();
    const timeline = getTimeline(30);
    const hasActivity = timeline.some((d) => d.reviews > 0);
    const insight = weekInsight(timeline);
    const best = bestDay(timeline);
    const maxReviews = Math.max(1, ...timeline.map((d) => d.reviews));
    const recentFluent = getRecentlyFluent(8, helpers);

    let deck = {};
    if (typeof statsFn === "function") {
      try { deck = statsFn(null) || {}; } catch (e) { deck = {}; }
    }
    const fluentCurrent = deck.fluent || 0;
    const fluencyPct = deck.total ? Math.round((fluentCurrent / deck.total) * 100) : 0;

    const today = todayKey();
    const bars = timeline.map((d) => {
      const pct = Math.round((d.reviews / maxReviews) * 100);
      const h = d.reviews === 0 ? 3 : Math.max(10, pct);
      const cls = ["progress-chart-bar", d.reviews === 0 ? "is-empty" : "", d.date === today ? "is-today" : ""].filter(Boolean).join(" ");
      return `<div class="${cls}" style="height:${h}%" title="${esc(d.date + ": " + d.reviews + " reviews")}" aria-label="${esc(formatShortDate(d.date) + ": " + d.reviews + " reviews")}" role="img"></div>`;
    }).join("");

    const recentDays = [...timeline].reverse().filter((d) => d.reviews > 0).slice(0, 14);
    let timelineHtml;
    if (!hasActivity) {
      timelineHtml = `<div class="timeline-empty" role="status"><p>No study activity yet.</p><p>Grade a few cards in Study — the timeline lights up here.</p></div>`;
    } else {
      timelineHtml = `<div class="timeline" aria-label="Recent study days"><div class="timeline-head">Activity</div>${
        recentDays.map((d) => {
          const fill = Math.max(d.reviews ? 12 : 0, Math.round(Math.min(1, d.reviews / maxReviews) * 100));
          const parts = [];
          if (d.reviews) parts.push(`${d.reviews} review${d.reviews === 1 ? "" : "s"}`);
          if (d.fluent) parts.push(`${d.fluent} fluent`);
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
    if (DATA && Array.isArray(DATA.sections) && typeof statsFn === "function") {
      const rows = DATA.sections.map((s) => {
        let ss = {};
        try { ss = statsFn(s.id) || {}; } catch (e) { ss = {}; }
        const total = ss.total || 0;
        if (!total) return "";
        const fluent = ss.fluent || 0;
        const pct = Math.round((fluent / total) * 100);
        const title = typeof sectionOf === "function" ? (sectionOf(s.id) || s).title || s.id : s.title || s.id;
        const color = (s && s.color) || "#3ecfbf";
        return `<div class="timeline-day timeline-day-wide">
          <span class="day-label" style="color:${esc(color)}">${esc(title)}</span>
          <div class="timeline-bar"><span style="width:${pct}%;background:${esc(color)}"></span></div>
          <span class="day-count">${esc(String(pct))}%</span>
          <span class="timeline-counts">${esc(`${fluent} fluent`)}</span>
        </div>`;
      }).filter(Boolean).join("");
      if (rows) {
        sectionsHtml = `<h2 class="head">By section</h2><div class="timeline" aria-label="Fluent progress by section"><div class="timeline-head">Mastery</div>${rows}</div>`;
      }
    }

    const heat = timeline.map((d) => {
      const n = d.reviews || 0;
      let lvl = 0;
      if (n >= 20) lvl = 4;
      else if (n >= 10) lvl = 3;
      else if (n >= 4) lvl = 2;
      else if (n >= 1) lvl = 1;
      return `<span class="heatmap-cell l${lvl}" title="${esc(d.date + ": " + n)}" aria-hidden="true"></span>`;
    }).join("");

    const fluentChipsHtml = recentFluent.length
      ? `<h2 class="head">Recently fluent</h2><div class="hero-meta" style="margin-bottom:14px">${
          recentFluent.map((item) => `<button type="button" class="fluent-chip" data-slug="${esc(item.slug)}">${esc(titleForSlug(item.slug, DATA))}</button>`).join("")
        }</div>`
      : "";

    container.innerHTML = `
      <div class="analytics-view">
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
          <div class="kpi good"><div class="kpi-value">${esc(fluentCurrent)}</div><div class="kpi-label">Fluent</div></div>
          <div class="kpi"><div class="kpi-value">${esc(summary.activeDays30)}</div><div class="kpi-label">Active days</div></div>
          <div class="kpi warn"><div class="kpi-value">${esc(best.reviews ? best.label : "—")}</div><div class="kpi-label">Best day${best.reviews ? esc(` · ${best.reviews}`) : ""}</div></div>
        </div>
        <div class="srs-grid" role="group" aria-label="SRS buckets · ${fluencyPct}% fluent">
          <div><strong>${esc(String(deck.due || 0))}</strong><span>Due</span></div>
          <div><strong>${esc(String(deck.fresh || 0))}</strong><span>New</span></div>
          <div><strong>${esc(String(deck.learning || 0))}</strong><span>Learning</span></div>
          <div><strong>${esc(String(fluentCurrent))}</strong><span>Fluent</span></div>
        </div>
        ${fluentChipsHtml}
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
        <p class="local-note">Progress stays in this browser. Graded reviews only.</p>
      </div>`;

    container.querySelectorAll(".fluent-chip[data-slug]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const slug = btn.getAttribute("data-slug");
        if (!slug) return;
        const hash = "#/c/" + slug;
        if (typeof go === "function") go(hash);
        else location.hash = hash;
      });
    });
  }

  window.WikiAnalytics = { record, getSummary, getTimeline, getKnownProgress, getRecentlyFluent, render };
})();
