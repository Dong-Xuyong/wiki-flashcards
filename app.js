/* Wiki Flashcards — vanilla JS, no dependencies. */
(() => {
  "use strict";

  const STORE_KEY = "wiki-flashcards-v1";
  const DAY = 24 * 60 * 60 * 1000;
  const GRADE_KEYS = ["again", "hard", "good", "easy"];
  const GRADE_LABELS = ["Again", "Hard", "Good", "Easy"];
  const ROUTE_TITLES = {
    home: "Home · Wiki Flashcards",
    library: "Library · Wiki Flashcards",
    study: "Study · Wiki Flashcards",
    analytics: "Progress · Wiki Flashcards",
    concept: "Concept · Wiki Flashcards",
    video: "Video · Wiki Flashcards",
  };

  // Sibling app; relative when serving the repo root locally.
  const INSIGHTS_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "../wiki-insights/"
    : "https://dong-xuyong.github.io/wiki-insights/";

  let DATA = null; // { sections, videos, concepts }
  let bySlug = {};
  let session = null; // { queue, idx, flipped, hint, total, sectionId, videoSlug, done, goal, grades }
  let sessionPaused = false;
  let store = load();
  let pendingDepth = null; // history depth to stamp on the entry go() is creating
  let detailReveal = { slug: null, on: false };

  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const topMeta = document.getElementById("topbar-meta");
  const backBtn = document.getElementById("back-btn");
  const tabs = document.querySelectorAll("#tabbar .tab");

  // ---------- persistence ----------
  function emptyGrades() {
    return { again: 0, hard: 0, good: 0, easy: 0 };
  }

  function hydrateSession(raw) {
    if (!raw || !Array.isArray(raw.queue) || !raw.queue.length) return null;
    if ((Number(raw.idx) || 0) >= raw.queue.length) return null;
    const g = raw.grades || {};
    return {
      queue: raw.queue.slice(),
      idx: Number(raw.idx) || 0,
      flipped: !!raw.flipped,
      hint: !!raw.hint,
      total: Number(raw.total) || raw.queue.length,
      sectionId: raw.sectionId || null,
      videoSlug: raw.videoSlug || null,
      done: Number(raw.done) || 0,
      goal: Number(raw.goal) || 5,
      grades: {
        again: Number(g.again) || 0,
        hard: Number(g.hard) || 0,
        good: Number(g.good) || 0,
        easy: Number(g.easy) || 0,
      },
    };
  }

  function load() {
    let data = { cards: {}, streak: { last: null, count: 0 }, libOpen: {} };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") Object.assign(data, parsed);
      }
    } catch (e) { /* corrupted store -> start fresh */ }
    session = hydrateSession(data.session);
    sessionPaused = !!session;
    return data;
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }
  function saveSession() {
    if (!session) return;
    store.session = {
      queue: session.queue,
      idx: session.idx,
      flipped: session.flipped,
      hint: session.hint,
      total: session.total,
      sectionId: session.sectionId,
      videoSlug: session.videoSlug,
      done: session.done,
      goal: session.goal,
      grades: session.grades || emptyGrades(),
    };
    save();
  }
  function clearStoredSession() {
    delete store.session;
    save();
  }
  function card(slug) {
    if (!store.cards[slug]) store.cards[slug] = { st: null, reps: 0, int: 0, ease: 2.5, due: 0 };
    return store.cards[slug];
  }

  // ---------- card state helpers ----------
  const isKnown = (s) => (store.cards[s] || {}).st === "known";
  const isUnknown = (s) => (store.cards[s] || {}).st === "unknown";
  const isNew = (s) => !store.cards[s] || (store.cards[s].reps === 0 && !store.cards[s].st);
  const isDue = (s) => {
    const c = store.cards[s];
    if (!c || isKnown(s)) return false;
    return (c.reps > 0 || c.st === "unknown") && c.due <= Date.now();
  };

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

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function dailyGoal(scope) {
    const st = stats(scope);
    return clamp(st.due + Math.min(5, st.fresh), 5, 20);
  }

  function todayReviews() {
    return window.WikiAnalytics?.getSummary?.()?.today?.reviews || 0;
  }

  function studyStreak() {
    return window.WikiAnalytics?.getSummary?.()?.dayStreakStudy || 0;
  }

  function progressFor(dueCount) {
    return window.WikiAnalytics?.getProgress?.({ dueCount }) || {};
  }

  function sessionLeft() {
    if (!session || !session.queue) return 0;
    return Math.max(0, session.queue.length - session.idx);
  }

  // SM-2 lite. grade: 0 again, 1 hard, 2 good, 3 easy
  function grade(slug, g) {
    const c = card(slug);
    c.reps += 1;
    if (g === 0) {
      c.ease = Math.max(1.3, c.ease - 0.2);
      c.int = 0;
      c.due = Date.now(); // repeats within the session
      c.st = "unknown";
    } else {
      if (g === 1) {
        c.ease = Math.max(1.3, c.ease - 0.15);
        c.int = c.int === 0 ? 1 : Math.max(c.int + 1, Math.round(c.int * 1.2));
      } else if (g === 2) {
        c.int = c.int === 0 ? 1 : Math.round(c.int * c.ease);
      } else {
        c.ease = Math.min(3.0, c.ease + 0.15);
        c.int = c.int === 0 ? 3 : Math.round(c.int * c.ease * 1.3);
      }
      c.int = Math.min(c.int, 365);
      c.due = Date.now() + c.int * DAY;
      if (c.st === "unknown" && g >= 2) c.st = null;
    }
    if (session) {
      if (!session.grades) session.grades = emptyGrades();
      session.grades[GRADE_KEYS[g]] = (session.grades[GRADE_KEYS[g]] || 0) + 1;
    }
    save();
    const goal = (session && session.goal) || dailyGoal(null);
    const before = todayReviews();
    window.WikiAnalytics?.record({ type: "review", slug, grade: g });
    const after = window.WikiAnalytics?.getSummary?.()?.today?.reviews ?? (before + 1);
    if (before < goal && after >= goal) {
      window.WikiAnalytics?.record({ type: "daily_goal_met" });
    }
    window.WikiAnalytics?.celebrateNewAchievements?.({ dueCount: stats(null).due });
  }

  function bumpStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const s = store.streak;
    if (s.last === today) return;
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    s.count = s.last === yesterday ? s.count + 1 : 1;
    s.last = today;
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
    if (opts && opts.all) {
      const every = pool.map((c) => c.slug);
      shuffle(every);
      return every;
    }
    const due = pool.filter((c) => isDue(c.slug)).map((c) => c.slug);
    const fresh = pool.filter((c) => isNew(c.slug)).map((c) => c.slug);
    shuffle(due);
    shuffle(fresh);
    // A video session is a finite, named set — study all of it, not a slice.
    if (opts && opts.videoSlug) return due.concat(fresh);
    let queue = due.concat(fresh.slice(0, Math.min(10, fresh.length)));
    if (queue.length > 20) queue = due.concat(fresh).slice(0, 20);
    return queue;
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
    let due = 0, known = 0, unknown = 0, fresh = 0;
    for (const c of pool) {
      if (isKnown(c.slug)) known++;
      else if (isDue(c.slug)) due++;
      if (isUnknown(c.slug)) unknown++;
      if (isNew(c.slug)) fresh++;
    }
    return { total: pool.length, due, known, unknown, fresh };
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
  function watchLabel(url) {
    return /youtube\.com|youtu\.be/i.test(url || "") ? "YouTube" : "Watch";
  }
  function insightsReturnUrl() {
    try { return sessionStorage.getItem("wiki-flashcards-return") || ""; }
    catch (e) { return ""; }
  }
  function captureInsightsReturn() {
    try {
      const ref = document.referrer || "";
      if (/wiki-insights/i.test(ref)) sessionStorage.setItem("wiki-flashcards-return", ref);
    } catch (e) { /* private mode */ }
  }

  /** Source videos behind a concept. Compact drops thumbnails to keep study cards tight. */
  function videoRowsHtml(slugs, compact) {
    let list = (slugs || []).filter(videoOf);
    if (session && session.videoSlug) {
      list = list.filter((x) => x === session.videoSlug);
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
            <a class="video-act" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" aria-label="${esc(v.title)} (opens in new tab)">${watchLabel(v.url)}</a>
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

  function setStudyStatus(msg) {
    const el = document.getElementById("study-status");
    if (el) el.textContent = msg || "";
  }

  function studyChromeMeta(goal) {
    return `${todayReviews()}/${goal || dailyGoal(null)} today · streak ${studyStreak()}`;
  }

  function primaryStudyBtn(id, queued) {
    const left = sessionLeft();
    if (left > 0) {
      return `<button type="button" class="primary-action" id="${id}">
        <span><small>Continue</small><strong>Resume ${left} left</strong></span>
        <span class="primary-arrow" aria-hidden="true">→</span>
      </button>`;
    }
    const goal = dailyGoal(null);
    return `<button type="button" class="primary-action" id="${id}" ${queued === 0 ? "disabled" : ""}>
      <span>
        <small>${queued ? "Daily goal" : "You're caught up"}</small>
        <strong>${queued ? `Study today's ${goal}` : "No cards waiting"}</strong>
      </span>
      <span class="primary-arrow" aria-hidden="true">→</span>
    </button>`;
  }

  function resumeOrStart() {
    if (sessionLeft() > 0) {
      sessionPaused = false;
      window.WikiAnalytics?.record({
        type: "session_resume",
        sectionId: session.sectionId,
        videoSlug: session.videoSlug,
      });
      saveSession();
      go("#/study");
      return;
    }
    startSession(null);
  }

  function maybePauseSession(routeName) {
    if (routeName === "study") return;
    if (session && session.idx < session.queue.length && !sessionPaused) {
      sessionPaused = true;
      saveSession();
      window.WikiAnalytics?.record({
        type: "session_pause",
        sectionId: session.sectionId,
        videoSlug: session.videoSlug,
      });
    }
  }

  function badgeTitle(badge) {
    if (!badge) return "";
    if (typeof badge === "string") return badge;
    return badge.title || badge.name || badge.label || "";
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
    if (depth() > 0) history.back();
    else location.hash = "#/library";
  }

  function render() {
    const r = parseRoute();
    maybePauseSession(r.name);
    document.title = ROUTE_TITLES[r.name] || "Wiki Flashcards";
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
        isKnown,
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

  function sectionRowHtml(s, ss, mode) {
    const pct = ss.total ? Math.round((ss.known / ss.total) * 100) : 0;
    const counts = mode === "study"
      ? `${ss.due} due · ${ss.fresh} new`
      : `${ss.known}/${ss.total} known${ss.due ? ` · ${ss.due} due` : ""}`;
    return `
      <button type="button" class="section-row" data-section="${s.id}">
        <span class="section-dot" style="background:${s.color}"></span>
        <span class="section-row-main">
          <span class="name">${esc(s.title)}</span>
          <span class="counts">${counts}</span>
          ${completionBar(pct, `${s.title}: ${pct}% known`)}
        </span>
        <span class="section-chevron" aria-hidden="true">›</span>
      </button>`;
  }

  // ----- home -----
  function renderHome() {
    const st = stats(null);
    const goal = dailyGoal(null);
    const reviews = todayReviews();
    const pct = goal ? Math.round(Math.min(100, (reviews / goal) * 100)) : 0;
    const queued = st.due + st.fresh;
    const progress = progressFor(st.due);
    const xpLine = progress.level != null ? `Level ${progress.level}` : `${progress.xp || 0} XP`;
    const next = progress.nextBadge;
    setChrome("Wiki Flashcards", studyChromeMeta(goal), false);
    let html = `
      <section class="learning-hero" aria-labelledby="learning-title">
        <div class="hero-topline">
          <span class="eyebrow">Today</span>
          <span class="hero-xp">${esc(xpLine)}</span>
        </div>
        <h2 id="learning-title">Today · ${reviews} / ${goal} reviews</h2>
        ${completionBar(pct, `${reviews} of ${goal} reviews today`)}
        <div class="status-stats">
          <button type="button" id="stat-due"><strong>${st.due}</strong><span>Due</span></button>
          <button type="button" id="stat-today"><strong>${reviews}</strong><span>Today</span></button>
          <button type="button" id="stat-streak"><strong>${studyStreak()}</strong><span>Streak</span></button>
        </div>
      </section>
      ${primaryStudyBtn("study-all", queued)}`;
    if (next && badgeTitle(next)) {
      html += `
        <button type="button" class="milestone-card" id="milestone-card">
          <span class="milestone-icon" aria-hidden="true">★</span>
          <span>
            <span class="eyebrow">Next badge</span>
            <strong>${esc(badgeTitle(next))}</strong>
          </span>
        </button>`;
    }
    html += `
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
    root.querySelector("#study-all").onclick = resumeOrStart;
    const dueBtn = root.querySelector("#stat-due");
    if (dueBtn) dueBtn.onclick = () => { libFilter = "due"; go("#/library"); };
    const todayBtn = root.querySelector("#stat-today");
    if (todayBtn) todayBtn.onclick = () => go("#/study");
    const streakBtn = root.querySelector("#stat-streak");
    if (streakBtn) streakBtn.onclick = () => go("#/analytics");
    const mile = root.querySelector("#milestone-card");
    if (mile) mile.onclick = () => go("#/analytics");
    root.querySelectorAll(".section-row").forEach((el) => {
      el.onclick = () => {
        store.libOpen[el.dataset.section] = true;
        save();
        libFilter = "all";
        go("#/library");
      };
    });
  }

  // ----- library -----
  let libFilter = "all";
  let libSearch = "";

  function renderLibrary() {
    const st = stats(null);
    setChrome("Library", `${st.total} concepts`, false);
    root.innerHTML = `
      <label class="sr-only" for="search-box">Search concepts</label>
      <input id="search-box" type="search" placeholder="Search concepts or keywords&hellip;" value="${esc(libSearch)}" aria-label="Search concepts" />
      <div class="filter-row">
        ${["all", "unknown", "known", "due", "new"].map((f) =>
          `<button type="button" class="filter-chip ${libFilter === f ? "active" : ""}" data-f="${f}" aria-pressed="${libFilter === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
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
    if (isKnown(c.slug)) badge = `<span class="badge known">Known</span>`;
    else if (isUnknown(c.slug)) badge = `<span class="badge unknown">Unknown</span>`;
    else if (isDue(c.slug)) badge = `<span class="badge due">Due</span>`;
    const kws = c.keywords.slice(0, 4).map((k) => `<span class="kw">${esc(k)}</span>`).join("");
    const emoji = c.e ? `<span class="row-emoji">${esc(c.e)}</span>` : "";
    const authors = (c.videos || []).map((s) => (videoOf(s) || {}).author).filter(Boolean);
    const uniqAuthors = [...new Set(authors)].slice(0, 2);
    const authorLine = uniqAuthors.length
      ? `<span class="row-author">${esc(uniqAuthors.join(" · "))}</span>`
      : "";
    return `
      <button type="button" class="concept-row" data-slug="${c.slug}">
        <span class="t">${emoji}<span>${esc(c.title)}</span>${badge}</span>
        ${authorLine}
        ${kws ? `<span class="kw-row">${kws}</span>` : ""}
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
        const bodyId = `lib-body-${s.id}`;
        html += `
          <div class="lib-group ${open ? "open" : ""}" data-section="${s.id}">
            <button type="button" class="lib-group-head" aria-expanded="${open}" aria-controls="${bodyId}">
              <span class="section-dot" style="background:${s.color}"></span>
              <span class="name">${esc(s.title)}</span>
              <span class="cnt">${members.length}</span>
              <span class="chev">&#8250;</span>
            </button>
            <div class="lib-group-body ${open ? "" : "hidden"}" id="${bodyId}">
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
    if (detailReveal.slug !== slug) {
      detailReveal = { slug, on: false };
    }
    const revealed = detailReveal.on;
    const known = isKnown(slug);
    const emoji = c.e ? `<span class="detail-emoji">${esc(c.e)}</span>` : "";
    root.innerHTML = `
      <div class="detail-title">${emoji}${esc(c.title)}
        ${known ? '<span class="badge known">Known</span>' : isUnknown(slug) ? '<span class="badge unknown">Unknown</span>' : ""}
      </div>
      ${c.keywords.length ? `<div class="kw-row">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>` : ""}
      <div class="panel qa-block">
        <div class="q">Q: ${rich(c.q)}</div>
        ${revealed ? `<div class="a">A: ${rich(c.a)}</div>${c.x ? `<div class="x">Example: ${rich(c.x)}</div>` : ""}`
          : `<button type="button" class="reveal-answer" id="reveal-answer">Reveal answer</button>`}
      </div>
      ${c.definition ? `<div class="detail-def">${esc(c.definition)}</div>` : ""}
      ${(c.videos && c.videos.length) ? `<h2 class="head">From these videos</h2>${videoRowsHtml(c.videos, false)}` : ""}
      ${revealed ? `<button type="button" class="toggle-known-btn ${known ? "is-known" : ""}" id="toggle-known">
        ${known ? "&#10003; Marked as known — tap to unmark" : "Mark as known"}
      </button>` : ""}
      ${c.related.length ? `<h2 class="head">Related concepts</h2>
        <div class="related-list">
          ${c.related.map((r) => bySlug[r] ? `<button type="button" class="related-link" data-slug="${r}">${esc(bySlug[r].title)}</button>` : "").join("")}
        </div>` : ""}`;
    const revealBtn = root.querySelector("#reveal-answer");
    if (revealBtn) revealBtn.onclick = () => {
      detailReveal = { slug, on: true };
      render();
    };
    const toggle = root.querySelector("#toggle-known");
    if (toggle) toggle.onclick = () => {
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
      <button type="button" class="big-btn secondary" id="to-library">Browse the library</button>`;
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
          <a class="vid-act" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(v.title)} (opens in new tab)">${watchLabel(v.url)}</a>
        </div>
      </div>
      <div class="status-stats">
        <div><strong>${st.due}</strong><span>Due</span></div>
        <div><strong>${st.known}</strong><span>Known</span></div>
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
    sessionPaused = false;
    session = {
      queue,
      idx: 0,
      flipped: false,
      hint: false,
      total: queue.length,
      sectionId: scope.sectionId || null,
      videoSlug: scope.videoSlug || null,
      done: 0,
      goal: dailyGoal(scope),
      grades: emptyGrades(),
    };
    saveSession();
    window.WikiAnalytics?.record({
      type: "session_start",
      sectionId: session.sectionId,
      videoSlug: session.videoSlug,
    });
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

  function studyProgressHtml() {
    const n = session.done + 1;
    const pct = session.total ? Math.round((n / session.total) * 100) : 0;
    return `<div id="study-progress">${n} / ${session.total}
      ${completionBar(pct, `Card ${n} of ${session.total}`)}</div>`;
  }

  function bindFlipCard(el) {
    const flip = (e) => {
      if (e.target.closest && (e.target.closest("#hint-btn") || e.target.closest("a"))) return;
      session.flipped = true;
      saveSession();
      setStudyStatus("Answer revealed");
      render();
    };
    el.onclick = flip;
    el.onkeydown = (e) => {
      if (e.target !== el) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        flip(e);
      }
    };
  }

  function renderStudy() {
    if (!session || session.idx >= session.queue.length) return renderStudyEntryOrDone();
    if (sessionPaused) {
      sessionPaused = false;
      window.WikiAnalytics?.record({
        type: "session_resume",
        sectionId: session.sectionId,
        videoSlug: session.videoSlug,
      });
      saveSession();
    }
    const slug = session.queue[session.idx];
    const c = bySlug[slug];
    if (!c) {
      advance();
      return;
    }
    const sec = sectionOf(c.section);
    setChrome(studyScopeTitle(), studyChromeMeta(session.goal), false);

    if (!session.flipped) {
      root.innerHTML = `
        <div id="study-wrap">
          ${studyProgressHtml()}
          <button type="button" class="flashcard" id="card" aria-label="Reveal answer">
            <div class="side-label" style="color:${sec.color}">Question &middot; ${esc(sec.title)}</div>
            ${c.e ? `<div class="card-emoji">${esc(c.e)}</div>` : ""}
            <div class="q-text">${rich(c.q)}</div>
            <div class="tap-hint">Tap card to reveal answer</div>
          </button>
          ${session.hint
            ? `<div class="kw-row" style="margin-top:14px">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>`
            : `<button type="button" class="hint-btn" id="hint-btn">Show keywords hint</button>`}
        </div>`;
      root.querySelector("#card").onclick = () => {
        session.flipped = true;
        saveSession();
        setStudyStatus("Answer revealed");
        render();
      };
      const hb = root.querySelector("#hint-btn");
      if (hb) hb.onclick = () => {
        session.hint = true;
        saveSession();
        render();
      };
    } else {
      const hardL = previewInterval(slug, 1);
      const goodL = previewInterval(slug, 2);
      const easyL = previewInterval(slug, 3);
      root.innerHTML = `
        <div id="study-wrap">
          ${studyProgressHtml()}
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
            <button type="button" class="grade-btn grade-again" data-g="0" aria-label="Again, repeat now">Again<small>now</small></button>
            <button type="button" class="grade-btn grade-hard" data-g="1" aria-label="Hard, ${hardL}">Hard<small>${hardL}</small></button>
            <button type="button" class="grade-btn grade-good" data-g="2" aria-label="Good, ${goodL}">Good<small>${goodL}</small></button>
            <button type="button" class="grade-btn grade-easy" data-g="3" aria-label="Easy, ${easyL}">Easy<small>${easyL}</small></button>
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
    const when = g === 0 ? "repeat now" : `again in ${previewInterval(slug, g)}`;
    grade(slug, g);
    setStudyStatus(`${GRADE_LABELS[g]} — ${when}`);
    if (g === 0) {
      const pos = Math.min(session.queue.length, session.idx + 4);
      session.queue.splice(pos, 0, slug);
      session.total += 1;
    }
    saveSession();
    advance();
  }

  function previewInterval(slug, g) {
    const c = store.cards[slug] || { int: 0, ease: 2.5 };
    let d;
    if (g === 1) d = c.int === 0 ? 1 : Math.max(c.int + 1, Math.round(c.int * 1.2));
    else if (g === 2) d = c.int === 0 ? 1 : Math.round(c.int * c.ease);
    else d = c.int === 0 ? 3 : Math.round(c.int * c.ease * 1.3);
    d = Math.min(d, 365);
    return d === 1 ? "1 day" : d < 30 ? `${d} days` : `${Math.round(d / 30)} mo`;
  }

  function advance() {
    session.idx += 1;
    session.done += 1;
    session.flipped = false;
    session.hint = false;
    saveSession();
    render();
  }

  function renderStudyEntryOrDone() {
    const finished = session && session.idx >= session.queue.length && session.total > 0;
    const st = stats(null);
    const goal = (session && session.goal) || dailyGoal(null);
    setChrome("Study", studyChromeMeta(goal), false);
    if (finished) {
      const recap = session;
      const g = recap.grades || emptyGrades();
      if (recap.done >= 1) {
        window.WikiAnalytics?.record({
          type: "session_end",
          cards: recap.done,
          sectionId: recap.sectionId,
          videoSlug: recap.videoSlug,
          grades: recap.grades,
        });
      }
      const fromVideo = recap.videoSlug;
      const progress = progressFor(st.due);
      const reviews = todayReviews();
      const met = reviews >= (recap.goal || goal);
      const next = badgeTitle(progress.nextBadge);
      const xpLine = progress.level != null
        ? `Level ${progress.level} · ${progress.xp || 0} XP`
        : `${progress.xp || 0} XP`;
      session = null;
      sessionPaused = false;
      clearStoredSession();
      root.innerHTML = `
        <div class="done-panel">
          <span class="eyebrow">Session</span>
          <h3>Session complete</h3>
          <p>${recap.done} reviewed · ${g.again} again · ${g.hard} hard · ${g.good} good · ${g.easy} easy</p>
          <p>${st.due} still due · ${esc(xpLine)}${met ? " · Daily goal met" : ""}</p>
          ${next ? `<p>Next badge: ${esc(next)}</p>` : ""}
          <button type="button" class="primary-action" id="again-btn" ${st.due + st.fresh === 0 ? "disabled" : ""}>
            <span><small>Keep going</small><strong>Study more</strong></span>
            <span class="primary-arrow" aria-hidden="true">→</span>
          </button>
          ${fromVideo ? `<button type="button" class="big-btn secondary" id="video-btn">Back to the video</button>` : ""}
          ${insightsReturnUrl() ? `<a class="big-btn secondary" id="insights-btn" href="${esc(insightsReturnUrl())}">Back to Insights</a>` : ""}
          <button type="button" class="big-btn secondary" id="home-btn">Back to home</button>
        </div>`;
      root.querySelector("#again-btn").onclick = () => startSession(null);
      const videoBtn = root.querySelector("#video-btn");
      if (videoBtn) videoBtn.onclick = () => go(`#/v/${encodeURIComponent(fromVideo)}`);
      root.querySelector("#home-btn").onclick = () => go("#/");
      return;
    }
    const queued = st.due + st.fresh;
    let html = `
      <section class="learning-hero" aria-labelledby="study-title">
        <span class="eyebrow">Study queue</span>
        <h2 id="study-title">${st.due} due · ${st.fresh} new</h2>
        <div class="status-stats">
          <div><strong>${st.due}</strong><span>Due</span></div>
          <div><strong>${st.fresh}</strong><span>New</span></div>
          <div><strong>${st.known}</strong><span>Known</span></div>
        </div>
      </section>
      ${primaryStudyBtn("study-all", queued)}
      <section class="home-section" aria-labelledby="study-sections-title">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Narrow the queue</span>
            <h2 id="study-sections-title">Study one section</h2>
          </div>
        </div>`;
    for (const s of DATA.sections) html += sectionRowHtml(s, stats(s.id), "study");
    html += `</section>`;
    root.innerHTML = html;
    root.querySelector("#study-all").onclick = resumeOrStart;
    root.querySelectorAll(".section-row").forEach((el) => {
      el.onclick = () => startSession(el.dataset.section);
    });
  }

  // ---------- boot ----------
  captureInsightsReturn();
  backBtn.onclick = goBack;
  tabs.forEach((b) => (b.onclick = () => {
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
    if (DATA) {
      render();
      root.focus();
    }
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
      session = hydrateSession(store.session);
      sessionPaused = !!session;
      window.WikiAnalytics?.bootstrapGamification?.({ dueCount: stats(null).due });
      render();
    })
    .catch((err) => {
      root.innerHTML = `<div class="empty-note">Failed to load data (${esc(err.message)}).<br>This app must be served over HTTP, not opened as a file.</div>`;
    });
})();
