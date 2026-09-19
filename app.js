/* Wiki Flashcards — vanilla JS, no dependencies. */
(() => {
  "use strict";

  const STORE_KEY = "wiki-flashcards-v1";
  const DAY = 24 * 60 * 60 * 1000;

  const fallbacks = {
    todayKey(date) {
      const d = date || new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    },
    emptyCard() {
      return { st: null, reps: 0, int: 0, ease: 2.5, due: 0, lg: [] };
    },
    migrateStore(raw) {
      const out = { cards: {}, streak: { last: null, count: 0 }, libOpen: {}, goal: 5, newToday: { date: null, slugs: [] } };
      if (!raw || typeof raw !== "object") return out;
      if (raw.cards && typeof raw.cards === "object") {
        for (const slug of Object.keys(raw.cards)) {
          const c = raw.cards[slug];
          if (!c || typeof c !== "object") { out.cards[slug] = fallbacks.emptyCard(); continue; }
          if (!Array.isArray(c.lg)) c.lg = [];
          out.cards[slug] = c;
        }
      }
      if (raw.streak && typeof raw.streak === "object") {
        out.streak = { last: raw.streak.last == null ? null : raw.streak.last, count: Number(raw.streak.count) || 0 };
      }
      if (raw.libOpen && typeof raw.libOpen === "object") out.libOpen = raw.libOpen;
      if ([5, 10, 20].includes(raw.goal)) out.goal = raw.goal;
      if (raw.newToday && typeof raw.newToday === "object") {
        out.newToday = {
          date: raw.newToday.date == null ? null : raw.newToday.date,
          slugs: Array.isArray(raw.newToday.slugs) ? raw.newToday.slugs.slice() : [],
        };
      }
      return out;
    },
    isSkipped(card) { return !!(card && card.st === "known"); },
    isNew(card) { return !card || ((Number(card.reps) || 0) === 0 && !fallbacks.isSkipped(card)); },
    isDue(card, now) {
      if (!card || fallbacks.isSkipped(card)) return false;
      return ((Number(card.reps) || 0) > 0 || card.st === "unknown") && card.due <= now;
    },
    isFluent(card) {
      if (!card || fallbacks.isSkipped(card) || (Number(card.int) || 0) < 21) return false;
      const lg = Array.isArray(card.lg) ? card.lg : [];
      return lg.length >= 2 && lg[lg.length - 2] >= 2 && lg[lg.length - 1] >= 2;
    },
    isLearning(card) { return !fallbacks.isSkipped(card) && !fallbacks.isNew(card) && !fallbacks.isFluent(card); },
    previewIntervalDays(card, grade) {
      const c = card || fallbacks.emptyCard();
      if (grade === 0) return 0;
      if (grade === 1) return Math.min(365, c.int === 0 ? 1 : Math.max(c.int + 1, Math.round(c.int * 1.2)));
      if (grade === 2) return Math.min(365, c.int === 0 ? 2 : Math.round(c.int * c.ease));
      return Math.min(365, c.int === 0 ? 4 : Math.round(c.int * Math.min(3.0, c.ease + 0.15) * 1.3));
    },
    previewIntervalLabel(days) {
      if (days === 1) return "1 day";
      if (days < 30) return `${days} days`;
      return `${Math.round(days / 30)} mo`;
    },
    applyGrade(card, grade, now) {
      const next = Object.assign(fallbacks.emptyCard(), card, { lg: ((card && card.lg) || []).slice() });
      const wasFluent = fallbacks.isFluent(next);
      const first = next.int === 0;
      next.lg.push(grade);
      if (next.lg.length > 4) next.lg = next.lg.slice(-4);
      next.reps += 1;
      let intervalDays = 0;
      if (grade === 0) {
        next.ease = Math.max(1.3, next.ease - 0.2);
        next.int = 0;
        next.due = now;
        next.st = "unknown";
      } else {
        if (grade === 1) {
          next.ease = Math.max(1.3, next.ease - 0.15);
          intervalDays = first ? 1 : Math.max(next.int + 1, Math.round(next.int * 1.2));
        } else if (grade === 2) {
          intervalDays = first ? 2 : Math.round(next.int * next.ease);
        } else {
          next.ease = Math.min(3.0, next.ease + 0.15);
          intervalDays = first ? 4 : Math.round(next.int * next.ease * 1.3);
        }
        next.int = Math.min(intervalDays, 365);
        intervalDays = next.int;
        next.due = now + next.int * DAY;
        if (next.st === "unknown" && grade >= 2) next.st = null;
      }
      return { card: next, becameFluent: !wasFluent && fallbacks.isFluent(next), intervalDays };
    },
    newBudgetRemaining(store, today) {
      const nt = store && store.newToday;
      const used = nt && nt.date === today && Array.isArray(nt.slugs) ? nt.slugs.length : 0;
      return Math.max(0, wlConst("NEW_PER_DAY", 8) - used);
    },
    buildQueue({ slugsDue, slugsNew, store, today }) {
      const cap = wlConst("SESSION_CAP", 20);
      const due = (slugsDue || []).slice(0, cap);
      const take = Math.min(fallbacks.newBudgetRemaining(store, today), Math.max(0, cap - due.length));
      const introduced = (slugsNew || []).filter((s) => !due.includes(s)).slice(0, take);
      return { queue: due.concat(introduced), introduced };
    },
    recordIntroduced(store, slugs, today) {
      if (!store) return store;
      const prev = store.newToday && store.newToday.date === today && Array.isArray(store.newToday.slugs)
        ? store.newToday.slugs.slice() : [];
      const seen = new Set(prev);
      for (const s of slugs || []) {
        if (s && !seen.has(s)) { seen.add(s); prev.push(s); }
      }
      store.newToday = { date: today, slugs: prev };
      return store;
    },
    sessionMissRate(counts) {
      const a = Number(counts && counts.again) || 0, h = Number(counts && counts.hard) || 0;
      const g = Number(counts && counts.good) || 0, e = Number(counts && counts.easy) || 0;
      const t = a + h + g + e;
      return t ? (a + h) / t : 0;
    },
    missBand(rate) {
      if (rate < 0.12) return "easy";
      if (rate <= 0.25) return "zone";
      if (rate <= 0.35) return "hard";
      return "over";
    },
    missCopy(band) {
      return {
        easy: "Too easy. Add a weaker section next, or stop for today.",
        zone: "In the bitter zone. This is the useful difficulty.",
        hard: "Challenging. Stay on due cards tomorrow.",
        over: "Overloaded. Cut new cards to 0 tomorrow. Stay on leaking + due.",
      }[band] || "Overloaded. Cut new cards to 0 tomorrow. Stay on leaking + due.";
    },
    bumpReviewStreak(streak, today) {
      const s = streak && typeof streak === "object" ? streak : { last: null, count: 0 };
      if (s.last === today) return s;
      const parts = String(today).split("-").map(Number);
      const yesterday = fallbacks.todayKey(new Date(parts[0], parts[1] - 1, parts[2] - 1));
      s.count = s.last === yesterday ? (Number(s.count) || 0) + 1 : 1;
      s.last = today;
      return s;
    },
    goalProgress(todayReviews, goal) {
      const choices = wlConst("GOAL_CHOICES", [5, 10, 20]);
      const g = choices.includes(goal) ? goal : wlConst("DEFAULT_GOAL", 5);
      const done = Math.max(0, Number(todayReviews) || 0);
      return { goal: g, done, met: done >= g };
    },
  };

  function wlConst(name, fallback) {
    const api = window.WikiLearning;
    return api && api[name] != null ? api[name] : fallback;
  }
  function wl(name, ...args) {
    const api = window.WikiLearning;
    const fn = api && typeof api[name] === "function" ? api[name] : fallbacks[name];
    return fn(...args);
  }
  function todayKey(date) { return wl("todayKey", date); }
  function emptyCard() { return wl("emptyCard"); }
  function insightsReturnUrl() {
    try { return sessionStorage.getItem("wiki-flashcards-return") || ""; }
    catch (e) { return ""; }
  }
  function captureInsightsReturn() {
    try {
      const ref = document.referrer || "";
      const params = new URLSearchParams(location.search);
      const fromParam = params.get("from") || params.get("ref") || "";
      if (/wiki-insights/i.test(ref) || /insight/i.test(fromParam) || params.has("insights")) {
        sessionStorage.setItem("wiki-flashcards-return", ref || INSIGHTS_URL);
      }
    } catch (e) { /* private mode */ }
  }
  function announce(msg) {
    const el = document.getElementById("live-status");
    if (el) el.textContent = msg;
  }
  function watchLabel(url) {
    return /youtube\.com|youtu\.be/i.test(url || "") ? "YouTube" : "Watch";
  }
  function analyticsSummary() {
    return (window.WikiAnalytics && typeof WikiAnalytics.getSummary === "function" && WikiAnalytics.getSummary()) || {};
  }
  function todayReviewsCount() {
    const s = analyticsSummary();
    if (s.today && s.today.reviews != null) return s.today.reviews;
    return s.todayReviews || 0;
  }
  function studyStreak() {
    const s = analyticsSummary();
    if (s.dayStreakStudy != null) return s.dayStreakStudy;
    return (store.streak && store.streak.count) || 0;
  }

  // Sibling app; relative when serving the repo root locally.
  const INSIGHTS_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "../wiki-insights/"
    : "https://dong-xuyong.github.io/wiki-insights/";

  let DATA = null; // { sections, videos, concepts }
  let bySlug = {};
  let store = load();
  let pendingDepth = null; // history depth to stamp on the entry go() is creating
  let session = null; // { queue, idx, flipped, total, sectionId, videoSlug, grades }

  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const topMeta = document.getElementById("topbar-meta");
  const backBtn = document.getElementById("back-btn");
  const tabs = document.querySelectorAll("#tabbar .tab");

  // ---------- persistence ----------
  function load() {
    let parsed = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (e) { /* corrupted store -> start fresh */ }
    return wl("migrateStore", parsed);
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }
  function card(slug) {
    if (!store.cards[slug]) store.cards[slug] = emptyCard();
    return store.cards[slug];
  }

  // ---------- card state helpers ----------
  const isSkipped = (s) => wl("isSkipped", store.cards[s]);
  const isKnown = (s) => isSkipped(s);
  const isUnknown = (s) => (store.cards[s] || {}).st === "unknown";
  const isNew = (s) => wl("isNew", store.cards[s]);
  const isDue = (s) => wl("isDue", store.cards[s], Date.now());
  const isFluent = (s) => wl("isFluent", store.cards[s]);
  const isLearning = (s) => wl("isLearning", store.cards[s], Date.now());

  function markKnown(slug) {
    const c = card(slug);
    c.st = "known";
    save();
    window.WikiAnalytics?.record({ type: "known", slug });
  }
  function markUnknown(slug) {
    const c = card(slug);
    c.st = "unknown";
    c.due = Date.now();
    save();
    window.WikiAnalytics?.record({ type: "unknown", slug });
  }
  function clearMark(slug) {
    card(slug).st = null;
    save();
  }

  function grade(slug, g) {
    const wasNew = isNew(slug);
    const result = wl("applyGrade", card(slug), g, Date.now());
    store.cards[slug] = result.card;
    if (wasNew) wl("recordIntroduced", store, [slug], todayKey());
    store.streak = wl("bumpReviewStreak", store.streak, todayKey()) || store.streak;
    save();
    window.WikiAnalytics?.record({ type: "review", slug, grade: g });
    if (result.becameFluent) window.WikiAnalytics?.record({ type: "fluent", slug });
    return result;
  }

  // ---------- queue building ----------
  /** Concepts matching a scope: whole deck, one section, or one source video. */
  function poolFor(opts) {
    const { sectionId, videoSlug } = opts || {};
    return DATA.concepts.filter(
      (c) =>
        (!sectionId || c.section === sectionId) &&
        (!videoSlug || (c.videos || []).includes(videoSlug))
    );
  }

  function buildQueue(opts) {
    const pool = poolFor(opts);
    const slugsDue = [];
    const slugsNew = [];
    const slugsKeep = [];
    for (const c of pool) {
      if (isSkipped(c.slug)) continue;
      slugsKeep.push(c.slug);
      if (isDue(c.slug)) slugsDue.push(c.slug);
      else if (isNew(c.slug)) slugsNew.push(c.slug);
    }
    if (opts && opts.all) {
      shuffle(slugsKeep);
      return slugsKeep;
    }
    shuffle(slugsDue);
    shuffle(slugsNew);
    const today = todayKey();
    const result = wl("buildQueue", { slugsDue, slugsNew, store, today, all: false });
    wl("recordIntroduced", store, (result && result.introduced) || [], today);
    save();
    return (result && result.queue) || [];
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  // ---------- stats ----------
  function stats(scope) {
    const pool = poolFor(typeof scope === "string" || !scope ? { sectionId: scope } : scope);
    let due = 0, known = 0, unknown = 0, fresh = 0, learning = 0, fluent = 0, skipped = 0;
    for (const c of pool) {
      if (isSkipped(c.slug)) { skipped++; known++; }
      else if (isDue(c.slug)) due++;
      if (isUnknown(c.slug)) unknown++;
      if (isNew(c.slug)) fresh++;
      if (isFluent(c.slug)) fluent++;
      if (isLearning(c.slug)) learning++;
    }
    return { total: pool.length, due, known, unknown, fresh, learning, fluent, skipped };
  }

  // ---------- rendering ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  /** Escape HTML, then turn **bold** into highlight spans. */
  function rich(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<mark class="hl">$1</mark>');
  }
  function videoOf(slug) {
    return (DATA.videos && DATA.videos[slug]) || null;
  }
  function thumbUrl(v) {
    if (v && v.thumbnail) return v.thumbnail;
    if (v && v.id && !String(v.id).startsWith("BV")) {
      return `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg`;
    }
    return "";
  }
  function insightsUrl(slug) {
    return `${INSIGHTS_URL}#/v/${encodeURIComponent(slug)}`;
  }
  function videoSubtitle(v) {
    return [v.author, v.min ? `${v.min} min` : "", v.n ? `${v.n} concepts` : ""].filter(Boolean).join(" · ");
  }

  /** Source videos behind a concept. Compact drops thumbnails to keep study cards tight. */
  function videoRowsHtml(slugs, compact) {
    let list = (slugs || []).filter(videoOf);
    if (session && session.videoSlug) {
      list = list.filter((s) => s === session.videoSlug);
      if (!list.length && videoOf(session.videoSlug)) list = [session.videoSlug];
    }
    if (!list.length) return "";
    return `<div class="video-list ${compact ? "compact" : ""}">
      ${list.map((slug) => {
        const v = videoOf(slug);
        const thumb = !compact && thumbUrl(v)
          ? `<img class="video-thumb" src="${esc(thumbUrl(v))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`
          : `<span class="video-yt">▶</span>`;
        const sub = videoSubtitle(v);
        const insights = v.insights
          ? `<a class="video-act primary" href="${esc(insightsUrl(slug))}" onclick="event.stopPropagation()">Insights</a>`
          : "";
        return `<div class="video-row" onclick="event.stopPropagation()">
          ${thumb}
          <span class="video-meta">
            <span class="video-title">${esc(v.title)}</span>
            ${sub ? `<span class="video-author">${esc(sub)}</span>` : ""}
          </span>
          <span class="video-actions">
            ${insights}
            <a class="video-act" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${watchLabel(v.url)}</a>
          </span>
        </div>`;
      }).join("")}
    </div>`;
  }
  function sectionOf(id) {
    return DATA.sections.find((s) => s.id === id) || { title: id, color: "#888" };
  }

  function setChrome(title, meta, showBack) {
    topTitle.textContent = title;
    topMeta.textContent = meta || "";
    backBtn.classList.toggle("hidden", !showBack);
  }

  // ---------- routing ----------
  const TAB_ROUTES = { home: "#/", library: "#/library", study: "#/study", analytics: "#/analytics" };
  // Detail views live under the Library tab.
  const TAB_FOR = { home: "home", library: "library", study: "study", analytics: "analytics", concept: "library", video: "library" };

  function parseRoute() {
    const h = (location.hash || "#/").replace(/^#/, "");
    let m = h.match(/^\/c\/([^/?#]+)/);
    if (m) return { name: "concept", slug: decodeURIComponent(m[1]) };
    m = h.match(/^\/v\/([^/?#]+)/);
    if (m) return { name: "video", slug: decodeURIComponent(m[1]) };
    if (h.startsWith("/library")) return { name: "library" };
    if (h.startsWith("/study")) return { name: "study" };
    if (h.startsWith("/analytics")) return { name: "analytics" };
    return { name: "home" };
  }

  /** How many in-app hops led to the current history entry. */
  function depth() {
    return (history.state && history.state.d) || 0;
  }

  function go(hash) {
    if (location.hash === hash || (hash === "#/" && !location.hash)) {
      render();
      return;
    }
    pendingDepth = depth() + 1;
    location.hash = hash;
  }

  function goBack() {
    const ret = insightsReturnUrl();
    const r = parseRoute();
    if (ret && (depth() === 0 || r.name === "video")) {
      location.href = ret;
      return;
    }
    // Depth lives on the history entry, so browser back/forward can't desync it.
    if (depth() > 0) history.back();
    else location.hash = "#/library"; // deep link straight in — nothing to pop
  }

  function render() {
    const r = parseRoute();
    tabs.forEach((b) => {
      const on = b.dataset.tab === TAB_FOR[r.name];
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (r.name === "concept") return renderDetail(r.slug);
    if (r.name === "video") return renderVideo(r.slug);
    if (r.name === "library") return renderLibrary();
    if (r.name === "study") return renderStudy();
    if (r.name === "analytics") return renderAnalytics();
    return renderHome();
  }

  function renderAnalytics() {
    setChrome("Analytics", "your progress", false);
    root.innerHTML = `<div id="analytics-root"></div>`;
    const el = root.querySelector("#analytics-root");
    if (window.WikiAnalytics && typeof WikiAnalytics.render === "function") {
      WikiAnalytics.render(el, {
        esc,
        stats,
        store,
        DATA,
        sectionOf,
        isFluent,
        isSkipped,
        go,
      });
    } else {
      el.innerHTML = `<div class="timeline-empty">Analytics module loading…</div>`;
    }
  }

  function completionBar(pct, label) {
    return `
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow="${pct}" aria-label="${esc(label)}">
        <span class="progress-fill" style="width:${pct}%"></span>
      </div>`;
  }

  function sectionRowHtml(s, ss) {
    const pct = ss.total ? Math.round((ss.fluent / ss.total) * 100) : 0;
    const counts = `${pct}% fluent · ${ss.due} due · ${ss.fresh} new`;
    return `
      <button type="button" class="section-row" data-section="${s.id}">
        <span class="section-dot" style="background:${s.color}"></span>
        <span class="section-row-main">
          <span class="name">${esc(s.title)}</span>
          <span class="counts">${counts}</span>
          ${completionBar(pct, `${s.title}: ${pct}% fluent`)}
        </span>
        <span class="section-chevron" aria-hidden="true">›</span>
      </button>`;
  }

  // ----- home -----
  function renderHome() {
    const st = stats(null);
    const goal = store.goal || wlConst("DEFAULT_GOAL", 5);
    const n = todayReviewsCount();
    const barPct = Math.min(100, goal ? Math.round((n / goal) * 100) : 0);
    const budget = wl("newBudgetRemaining", store, todayKey());
    const fluentPct = st.total ? Math.round((st.fluent / st.total) * 100) : 0;
    const canDue = st.due > 0;
    const canNew = st.fresh > 0 && budget > 0;
    const ctaDisabled = !canDue && !canNew;
    const ctaLabel = canDue ? `Study ${st.due} due` : canNew ? "Study new cards" : "You're caught up";
    const choices = wlConst("GOAL_CHOICES", [5, 10, 20]);
    setChrome("Wiki Flashcards", `${st.total} concepts`, false);
    let html = `
      <section class="learning-hero" aria-labelledby="learning-title">
        <div class="hero-topline">
          <span class="eyebrow">Today's goal</span>
          <span class="hero-xp">${st.total} cards</span>
        </div>
        <h2 id="learning-title">Today: ${n}/${goal} reviews</h2>
        ${completionBar(barPct, `Today: ${n} of ${goal} reviews`)}
        <div class="status-stats">
          <div><strong>${st.due}</strong><span>Due</span></div>
          <div><strong>${st.fluent}</strong><span>Fluent</span></div>
          <div><strong>${studyStreak()}</strong><span>Streak</span></div>
        </div>
        <div class="goal-row" role="group" aria-label="Daily review goal">
          ${choices.map((g) => `<button type="button" class="goal-chip ${g === goal ? "active" : ""}" data-goal="${g}">${g}</button>`).join("")}
        </div>
        <p class="hero-subtext">${fluentPct}% fluent</p>
      </section>
      <button type="button" class="primary-action" id="study-all" ${ctaDisabled ? "disabled" : ""}>
        <span>
          <small>${canDue ? "Due today" : canNew ? "New cards" : "Caught up"}</small>
          <strong>${ctaLabel}</strong>
        </span>
        <span class="primary-arrow" aria-hidden="true">→</span>
      </button>
      <section class="home-section" aria-labelledby="sections-title">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Explore your library</span>
            <h2 id="sections-title">Sections</h2>
          </div>
        </div>`;
    for (const s of DATA.sections) html += sectionRowHtml(s, stats(s.id));
    html += `</section>`;
    root.innerHTML = html;
    root.querySelector("#study-all").onclick = () => startSession(null);
    root.querySelectorAll(".goal-chip").forEach((b) => {
      b.onclick = () => {
        store.goal = Number(b.dataset.goal);
        save();
        renderHome();
      };
    });
    root.querySelectorAll(".section-row").forEach((el) => {
      el.onclick = () => startSession(el.dataset.section);
    });
  }

  // ----- library -----
  let libFilter = "all";
  let libSearch = "";

  function renderLibrary() {
    const st = stats(null);
    setChrome("Library", `${st.total} concepts`, false);
    root.innerHTML = `
      <input id="search-box" type="search" placeholder="Search concepts or keywords&hellip;" value="${esc(libSearch)}" aria-label="Search concepts or keywords" />
      <div class="filter-row">
        ${["all", "unknown", "known", "due", "new"].map((f) => {
          const label = f === "known" ? "Skipped" : f[0].toUpperCase() + f.slice(1);
          return `<button class="filter-chip ${libFilter === f ? "active" : ""}" data-f="${f}">${label}</button>`;
        }).join("")}
      </div>
      <div id="lib-list"></div>`;
    const box = root.querySelector("#search-box");
    box.oninput = () => { libSearch = box.value; renderLibList(); };
    root.querySelectorAll(".filter-chip").forEach((b) => {
      b.onclick = () => { libFilter = b.dataset.f; renderLibrary(); };
    });
    renderLibList();
  }

  function conceptMatches(c) {
    if (libFilter === "known" && !isKnown(c.slug)) return false;
    if (libFilter === "unknown" && !isUnknown(c.slug)) return false;
    if (libFilter === "due" && !isDue(c.slug)) return false;
    if (libFilter === "new" && !isNew(c.slug)) return false;
    if (libSearch) {
      const q = libSearch.toLowerCase();
      const sources = (c.videos || [])
        .map((s) => { const v = videoOf(s); return v ? `${v.author || ""} ${v.title || ""}` : ""; })
        .join(" ");
      const hay = `${c.title} ${c.slug} ${c.keywords.join(" ")} ${sources}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function conceptRow(c) {
    let badge = "";
    if (isKnown(c.slug)) badge = `<span class="badge known">Skipped</span>`;
    else if (isUnknown(c.slug)) badge = `<span class="badge unknown">Unknown</span>`;
    else if (isDue(c.slug)) badge = `<span class="badge due">Due</span>`;
    const kws = c.keywords.slice(0, 4).map((k) => `<span class="kw">${esc(k)}</span>`).join("");
    const emoji = c.e ? `<span class="row-emoji">${esc(c.e)}</span>` : "";
    const authors = (c.videos || []).map((s) => (videoOf(s) || {}).author).filter(Boolean);
    const uniqAuthors = [...new Set(authors)].slice(0, 2);
    const authorLine = uniqAuthors.length
      ? `<div class="row-author">${esc(uniqAuthors.join(" · "))}</div>`
      : "";
    return `
      <button type="button" class="concept-row" data-slug="${c.slug}">
        <div class="t">${emoji}<span>${esc(c.title)}</span>${badge}</div>
        ${authorLine}
        ${kws ? `<div class="kw-row">${kws}</div>` : ""}
      </button>`;
  }

  function renderLibList() {
    const list = root.querySelector("#lib-list");
    if (!list) return;
    const searching = !!libSearch || libFilter !== "all";
    let html = "";
    if (searching) {
      const matches = DATA.concepts.filter(conceptMatches).slice(0, 200);
      html = matches.length
        ? matches.map(conceptRow).join("")
        : `<div class="empty-note">No concepts match.</div>`;
    } else {
      for (const s of DATA.sections) {
        const members = DATA.concepts.filter((c) => c.section === s.id);
        if (!members.length) continue;
        const open = !!store.libOpen[s.id];
        html += `
          <div class="lib-group ${open ? "open" : ""}" data-section="${s.id}">
            <div class="lib-group-head">
              <span class="section-dot" style="background:${s.color}"></span>
              <span class="name">${esc(s.title)}</span>
              <span class="cnt">${members.length}</span>
              <span class="chev">&#8250;</span>
            </div>
            <div class="lib-group-body ${open ? "" : "hidden"}">
              ${open ? members.map(conceptRow).join("") : ""}
            </div>
          </div>`;
      }
    }
    list.innerHTML = html;
    list.querySelectorAll(".lib-group-head").forEach((h) => {
      h.onclick = () => {
        const g = h.closest(".lib-group");
        store.libOpen[g.dataset.section] = !store.libOpen[g.dataset.section];
        save();
        renderLibList();
      };
    });
    bindConceptRows(list);
  }

  function bindConceptRows(scope) {
    scope.querySelectorAll(".concept-row").forEach((r) => {
      r.onclick = () => go(`#/c/${encodeURIComponent(r.dataset.slug)}`);
    });
  }

  // ----- detail -----
  function renderDetail(slug) {
    const c = bySlug[slug];
    if (!c) return renderMissing("Concept not found.");
    const sec = sectionOf(c.section);
    setChrome(sec.title, "", true);
    const known = isKnown(slug);
    const emoji = c.e ? `<span class="detail-emoji">${esc(c.e)}</span>` : "";
    root.innerHTML = `
      <div class="detail-title">${emoji}${esc(c.title)}
        ${known ? '<span class="badge known">Skipped</span>' : isUnknown(slug) ? '<span class="badge unknown">Unknown</span>' : ""}
      </div>
      ${c.keywords.length ? `<div class="kw-row">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>` : ""}
      <div class="panel qa-block">
        <div class="q">Q: ${rich(c.q)}</div>
        <div class="a">A: ${rich(c.a)}</div>
        ${c.x ? `<div class="x">Example: ${rich(c.x)}</div>` : ""}
      </div>
      ${c.definition ? `<div class="detail-def">${esc(c.definition)}</div>` : ""}
      ${(c.videos && c.videos.length) ? `<h2 class="head">From these videos</h2>${videoRowsHtml(c.videos, false)}` : ""}
      <button class="toggle-known-btn ${known ? "is-known" : ""}" id="toggle-known">
        ${known ? "Skipped — tap to restore" : "Already know — skip this card"}
      </button>
      ${c.related.length ? `<h2 class="head">Related concepts</h2>
        <div class="related-list">
          ${c.related.map((r) => bySlug[r] ? `<button class="related-link" data-slug="${r}">${esc(bySlug[r].title)}</button>` : "").join("")}
        </div>` : ""}`;
    root.querySelector("#toggle-known").onclick = () => {
      known ? clearMark(slug) : markKnown(slug);
      render();
    };
    root.querySelectorAll(".related-link").forEach((b) => {
      b.onclick = () => go(`#/c/${encodeURIComponent(b.dataset.slug)}`);
    });
    root.scrollTop = 0;
  }

  function renderMissing(msg) {
    setChrome("Not found", "", true);
    root.innerHTML = `<div class="empty-note">${esc(msg)}</div>
      <button class="big-btn secondary" id="to-library">Browse the library</button>`;
    root.querySelector("#to-library").onclick = () => go("#/library");
  }

  // ----- one video's concepts (landing target from Wiki Insights) -----
  function renderVideo(slug) {
    const v = videoOf(slug);
    if (!v) return renderMissing("That video is not in this deck yet.");
    const members = poolFor({ videoSlug: slug });
    const st = stats({ videoSlug: slug });
    const queued = st.due + st.fresh;
    const thumb = thumbUrl(v);
    setChrome("From this video", `${members.length} concepts`, true);
    root.innerHTML = `
      <div class="vid-hero">
        ${thumb ? `<img class="vid-hero-thumb" src="${esc(thumb)}" alt="" loading="lazy" decoding="async" />` : ""}
        <div class="vid-hero-title">${esc(v.title)}</div>
        ${videoSubtitle(v) ? `<div class="vid-hero-meta">${esc(videoSubtitle(v))}</div>` : ""}
        <div class="vid-hero-actions">
          ${v.insights ? `<a class="vid-act primary" href="${esc(insightsUrl(slug))}">Open insights</a>` : ""}
          <a class="vid-act" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${watchLabel(v.url)}</a>
        </div>
      </div>
      <div class="status-stats">
        <div><strong>${st.due}</strong><span>Due</span></div>
        <div><strong>${st.fluent}</strong><span>Fluent</span></div>
        <div><strong>${st.fresh}</strong><span>New</span></div>
      </div>
      <button type="button" class="primary-action" id="study-video" ${members.length ? "" : "disabled"}>
        <span>
          <small>${queued ? "Study this video" : "Review this video"}</small>
          <strong>${queued ? `Study ${queued} concept${queued === 1 ? "" : "s"}` : `Review all ${members.length}`}</strong>
        </span>
        <span class="primary-arrow" aria-hidden="true">→</span>
      </button>
      <section class="home-section" aria-labelledby="vid-concepts-title">
        <div class="section-heading">
          <div>
            <span class="eyebrow">From this video</span>
            <h2 id="vid-concepts-title">Concepts</h2>
          </div>
        </div>
        <div id="vid-list">${members.map(conceptRow).join("") || `<div class="empty-note">No concepts linked yet.</div>`}</div>
      </section>`;
    root.querySelector("#study-video").onclick = () =>
      startSession({ videoSlug: slug, all: queued === 0 });
    bindConceptRows(root.querySelector("#vid-list"));
    root.scrollTop = 0;
  }

  // ----- study -----
  function startSession(opts) {
    const scope = typeof opts === "string" || !opts ? { sectionId: opts || null } : opts;
    const queue = buildQueue(scope);
    session = {
      queue,
      idx: 0,
      flipped: false,
      hint: false,
      total: queue.length,
      sectionId: scope.sectionId || null,
      videoSlug: scope.videoSlug || null,
      done: 0,
      grades: { again: 0, hard: 0, good: 0, easy: 0 },
    };
    window.WikiAnalytics?.record({ type: "session_start", sectionId: session.sectionId });
    go("#/study");
  }

  function studyScopeTitle() {
    if (!session) return "Study";
    if (session.videoSlug) {
      const v = videoOf(session.videoSlug);
      return v ? v.title : "Study";
    }
    return session.sectionId ? sectionOf(session.sectionId).title : "Study";
  }

  function renderStudy() {
    if (!session || session.idx >= session.queue.length) return renderStudyEntryOrDone();
    const slug = session.queue[session.idx];
    const c = bySlug[slug];
    if (!c) { advance(); return; }
    const sec = sectionOf(c.section);
    setChrome(studyScopeTitle(), `streak ${studyStreak()}`, depth() > 0 || !!session.videoSlug);

    const progressNow = session.done + 1;
    const progressHtml = `<div id="study-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${session.total}" aria-valuenow="${progressNow}">${progressNow} / ${session.total}${session.total ? ` · ${Math.round((progressNow / session.total) * 100)}%` : ""}</div>`;

    if (!session.flipped) {
      root.innerHTML = `
        <div id="study-wrap">
          ${progressHtml}
          <button type="button" class="flashcard" id="card">
            <div class="side-label" style="color:${sec.color}">Question &middot; ${esc(sec.title)}</div>
            ${c.e ? `<div class="card-emoji">${esc(c.e)}</div>` : ""}
            <div class="q-text">${rich(c.q)}</div>
            <div class="tap-hint">Tap card to reveal answer</div>
          </button>
          ${session.hint
            ? `<div class="kw-row" style="margin-top:14px">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>`
            : `<button type="button" class="hint-btn" id="hint-btn">Show keywords hint</button>`}
        </div>`;
      root.querySelector("#card").onclick = (e) => {
        if (e.target.closest("a")) return;
        session.flipped = true;
        render();
      };
      const hb = root.querySelector("#hint-btn");
      if (hb) hb.onclick = () => { session.hint = true; render(); };
    } else {
      announce("Answer revealed");
      root.innerHTML = `
        <div id="study-wrap">
          ${progressHtml}
          <div class="flashcard">
            <div class="side-label" style="color:${sec.color}">Answer</div>
            ${c.e ? `<div class="card-emoji small">${esc(c.e)}</div>` : ""}
            <div class="a-text">${rich(c.a)}</div>
            ${c.x ? `<div class="x-text"><span class="x-label">Example</span>${rich(c.x)}</div>` : ""}
            <div class="concept-name">${esc(c.title)}</div>
            ${c.keywords.length ? `<div class="kw-row" style="margin-top:10px">${c.keywords.slice(0, 5).map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>` : ""}
            ${videoRowsHtml((c.videos || []).slice(0, 2), true)}
          </div>
          <div class="grade-row">
            <button class="grade-btn grade-again" data-g="0">Again<small>now</small></button>
            <button class="grade-btn grade-hard" data-g="1">Hard<small>${previewInterval(slug, 1)}</small></button>
            <button class="grade-btn grade-good" data-g="2">Good<small>${previewInterval(slug, 2)}</small></button>
            <button class="grade-btn grade-easy" data-g="3">Easy<small>${previewInterval(slug, 3)}</small></button>
          </div>
        </div>`;
      root.querySelectorAll(".grade-btn").forEach((b) => {
        b.onclick = () => applySessionGrade(Number(b.dataset.g));
      });
    }
  }

  function applySessionGrade(g) {
    if (!session || !session.flipped || session.idx >= session.queue.length) return;
    const slug = session.queue[session.idx];
    const names = ["again", "hard", "good", "easy"];
    if (!session.grades) session.grades = { again: 0, hard: 0, good: 0, easy: 0 };
    session.grades[names[g]] += 1;
    grade(slug, g);
    if (g === 0) {
      const pos = Math.min(session.queue.length, session.idx + 4);
      session.queue.splice(pos, 0, slug);
      session.total += 1;
    }
    advance();
  }

  function previewInterval(slug, g) {
    const days = wl("previewIntervalDays", store.cards[slug] || emptyCard(), g);
    return wl("previewIntervalLabel", days);
  }

  function advance() {
    session.idx += 1;
    session.done += 1;
    session.flipped = false;
    session.hint = false;
    render();
  }

  function renderStudyEntryOrDone() {
    const finished = session && session.idx >= session.queue.length && session.total > 0;
    if (finished) {
      const fin = session;
      const scope = { sectionId: fin.sectionId || null, videoSlug: fin.videoSlug || null };
      window.WikiAnalytics?.record({
        type: "session_end",
        cards: fin.done,
        sectionId: fin.sectionId,
      });
      const stScope = stats(scope);
      const grades = fin.grades || { again: 0, hard: 0, good: 0, easy: 0 };
      const remembered = (grades.good || 0) + (grades.easy || 0);
      const relearning = (grades.again || 0) + (grades.hard || 0);
      const missRate = wl("sessionMissRate", grades);
      const missPct = Math.round(missRate * 100);
      const copy = wl("missCopy", wl("missBand", missRate));
      const gp = wl("goalProgress", todayReviewsCount(), store.goal || wlConst("DEFAULT_GOAL", 5));
      const goalLine = gp.met ? "Goal met" : `${gp.done}/${gp.goal}`;
      const budget = wl("newBudgetRemaining", store, todayKey());
      const canContinue = stScope.due > 0 || (stScope.fresh > 0 && budget > 0);
      const fromVideo = fin.videoSlug;
      const ret = insightsReturnUrl();
      setChrome("Study", "", !!(fromVideo || depth() > 0));
      root.innerHTML = `
        <div class="done-panel">
          <span class="eyebrow">Session</span>
          <div class="emoji">&#127881;</div>
          <h3>Session complete</h3>
          <p>${fin.done} cards reviewed. ${remembered} remembered. ${relearning} relearning.</p>
          <p>${missPct}% miss rate. ${esc(copy)}</p>
          <p>${esc(goalLine)}. ${stScope.due} still due.</p>
          <button type="button" class="primary-action" id="again-btn" ${canContinue ? "" : "disabled"}>
            <span><small>Same scope</small><strong>Continue</strong></span>
            <span class="primary-arrow" aria-hidden="true">→</span>
          </button>
          <button class="big-btn secondary" id="home-btn">Stop for today</button>
          ${fromVideo ? `<button class="big-btn secondary" id="video-btn">Back to this video</button>` : ""}
          ${ret ? `<a class="big-btn secondary" id="insights-btn" href="${esc(ret)}">Back to Insights</a>` : ""}
        </div>`;
      root.querySelector("#again-btn").onclick = () => startSession(scope);
      const videoBtn = root.querySelector("#video-btn");
      if (videoBtn) videoBtn.onclick = () => go(`#/v/${encodeURIComponent(fromVideo)}`);
      root.querySelector("#home-btn").onclick = () => go("#/");
      session = null;
      return;
    }
    const st = stats(null);
    const budget = wl("newBudgetRemaining", store, todayKey());
    const canStart = st.due > 0 || (st.fresh > 0 && budget > 0);
    setChrome("Study", "", false);
    let html = `
      <section class="learning-hero" aria-labelledby="study-title">
        <span class="eyebrow">Study queue</span>
        <h2 id="study-title">${st.due} due · ${st.fresh} new</h2>
        <div class="status-stats">
          <div><strong>${st.due}</strong><span>Due</span></div>
          <div><strong>${st.fresh}</strong><span>New</span></div>
          <div><strong>${st.fluent}</strong><span>Fluent</span></div>
        </div>
      </section>
      <button type="button" class="primary-action" id="study-all" ${canStart ? "" : "disabled"}>
        <span>
          <small>${canStart ? "Whole deck" : "You're caught up"}</small>
          <strong>${st.due > 0 ? `Study ${st.due} due` : canStart ? "Study new cards" : "You're caught up"}</strong>
        </span>
        <span class="primary-arrow" aria-hidden="true">→</span>
      </button>
      <section class="home-section" aria-labelledby="study-sections-title">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Narrow the queue</span>
            <h2 id="study-sections-title">Study one section</h2>
          </div>
        </div>`;
    for (const s of DATA.sections) html += sectionRowHtml(s, stats(s.id));
    html += `</section>`;
    root.innerHTML = html;
    root.querySelector("#study-all").onclick = () => startSession(null);
    root.querySelectorAll(".section-row").forEach((el) => {
      el.onclick = () => startSession(el.dataset.section);
    });
  }

  function sessionInProgress() {
    return !!(session && session.queue && session.idx < session.queue.length);
  }

  // ---------- boot ----------
  captureInsightsReturn();
  backBtn.onclick = goBack;
  tabs.forEach((b) => (b.onclick = () => {
    if (b.dataset.tab !== "study" && sessionInProgress()) {
      if (!confirm("Leave this session?")) return;
      session = null;
    } else if (b.dataset.tab !== "study") {
      session = null;
    }
    go(TAB_ROUTES[b.dataset.tab]);
  }));
  window.addEventListener("keydown", (e) => {
    if (!session || !session.flipped) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      e.preventDefault();
      applySessionGrade(n - 1);
    }
  });
  window.addEventListener("hashchange", () => {
    if (pendingDepth !== null) {
      history.replaceState({ d: pendingDepth }, "");
      pendingDepth = null;
    } else if (!history.state) {
      // Hash changed from outside the app (pasted link, external anchor).
      history.replaceState({ d: 0 }, "");
    }
    if (DATA) render();
  });
  if (!history.state) history.replaceState({ d: 0 }, "");

  fetch("data/concepts.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      DATA = data;
      DATA.videos = DATA.videos || {};
      for (const c of data.concepts) bySlug[c.slug] = c;
      render();
    })
    .catch((err) => {
      root.innerHTML = `<div class="empty-note">Failed to load data (${esc(err.message)}).<br>This app must be served over HTTP, not opened as a file.</div>`;
    });
})();
