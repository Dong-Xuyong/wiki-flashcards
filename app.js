/* Wiki Flashcards — vanilla JS, no dependencies. */
(() => {
  "use strict";

  const STORE_KEY = "wiki-flashcards-v1";
  const DAY = 24 * 60 * 60 * 1000;
  const GRADE_KEYS = ["again", "hard", "good", "easy"];
  const GRADE_LABELS = ["Again", "Hard", "Good", "Easy"];
  const ROUTE_TITLES = {
    home: "Home · Wiki Review Cards",
    library: "Library · Wiki Review Cards",
    study: "Study · Wiki Review Cards",
    analytics: "Progress · Wiki Review Cards",
    aws: "AWS Cloud Practitioner",
    concept: "Concept · Wiki Review Cards",
    video: "Video · Wiki Review Cards",
  };

  // Insights is a sub-folder of this app. Relative so it resolves on every host.
  const INSIGHTS_URL = "insights/";

  let DATA = null; // { sections, videos, concepts }
  let bySlug = {};
  let session = null; // { queue, idx, flipped, hint, total, sectionId, videoSlug, done, goal, grades }
  let sessionPaused = false;
  let studyFocusExit = true;
  let undoTimer = null;
  let undoState = null;
  const PLACE_KEY = "wiki-study-place-v1";
  let resumeLock = 0;
  let blockClick = false;
  let swipePointer = null;
  let browserFullscreen = false;
  let practiceFocus = false;
  let pendingCombo = null;
  let placeClear = false;
  const bootHash = location.hash || "";
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
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
    let data = { cards: {}, streak: { last: null, count: 0 }, libOpen: {}, retired: [] };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") Object.assign(data, parsed);
      }
    } catch (e) { /* corrupted store -> start fresh */ }
    data.retired = normalizeRetired(data.retired);
    session = hydrateSession(data.session);
    sessionPaused = !!session;
    return data;
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    if (!applyingRemote) queueMicrotask(scheduleIfChanged);
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
    savePlace();
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
  const isNew = (s) => {
    if (isRetired(s)) return false;
    return !store.cards[s] || (store.cards[s].reps === 0 && !store.cards[s].st);
  };
  const isDue = (s) => {
    const c = store.cards[s];
    if (!c || isKnown(s) || isRetired(s)) return false;
    return (c.reps > 0 || c.st === "unknown") && c.due <= Date.now();
  };

  function markKnown(slug) {
    const c = card(slug);
    c.st = "known";
    c.last = Date.now();
    save();
    window.WikiAnalytics?.record({ type: "known", slug });
  }
  function clearMark(slug) {
    const c = card(slug);
    c.st = null;
    c.last = Date.now();
    save();
  }

  /** Retired ids sync inside wiki-flashcards.json. Newer `t` wins; `on: false` is an unhide. */
  function normalizeRetired(raw) {
    const map = new Map();
    const list = Array.isArray(raw) ? raw : [];
    list.forEach((item) => {
      let rec = null;
      if (typeof item === "string" && item) rec = { id: item, t: 0, on: true };
      else if (item && typeof item === "object" && item.id) {
        rec = { id: String(item.id), t: Number(item.t) || 0, on: item.on !== false };
      }
      if (!rec || !rec.id) return;
      const prev = map.get(rec.id);
      if (!prev || rec.t >= prev.t) map.set(rec.id, rec);
    });
    return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  function mergeRetired(a, b) {
    return normalizeRetired([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
  }
  function isRetired(slug) {
    return normalizeRetired(store.retired).some((rec) => rec.on && rec.id === slug);
  }
  function isLibraryKnown(slug) {
    return isRetired(slug) || isKnown(slug);
  }
  function retireSlug(slug) {
    const next = normalizeRetired(store.retired).filter((rec) => rec.id !== slug);
    next.push({ id: slug, t: Date.now(), on: true });
    store.retired = normalizeRetired(next);
    markKnown(slug);
  }
  function unhideSlug(slug) {
    const wasRetired = isRetired(slug);
    const next = normalizeRetired(store.retired).filter((rec) => rec.id !== slug);
    if (wasRetired) next.push({ id: slug, t: Date.now(), on: false });
    store.retired = normalizeRetired(next);
    if ((store.cards[slug] || {}).st === "known") clearMark(slug);
    else save();
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
    c.last = Date.now();
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
  function hasReviewText(c) {
    return !!(c && String(c.q || "").trim() && String(c.a || "").trim());
  }
  function poolFor(opts) {
    const { sectionId, videoSlug } = opts || {};
    return DATA.concepts.filter(
      (c) =>
        hasReviewText(c) &&
        (!sectionId || c.section === sectionId) &&
        (!videoSlug || (c.videos || []).includes(videoSlug))
    );
  }

  function buildQueue(opts) {
    const pool = poolFor(opts).filter((c) => !isRetired(c.slug));
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
      if (isLibraryKnown(c.slug)) known++;
      else if (isDue(c.slug)) due++;
      if (isUnknown(c.slug) && !isRetired(c.slug)) unknown++;
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
      if (/wiki-insights|\/wiki-flashcards\/insights\//i.test(ref)) sessionStorage.setItem("wiki-flashcards-return", ref);
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
  function isAgentSection(id) {
    return !!(window.WikiAgent && id === WikiAgent.AGENT_SECTION.id);
  }
  /** Section name shown on a concept. The agent bucket is not a library section. */
  function sectionLabel(id) {
    if (isAgentSection(id)) return "Library";
    return sectionOf(id).title;
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
    if (left > 0 && goalRoom() > 0) {
      return `<button type="button" class="primary-action" id="${id}">
        <span><small>Continue</small><strong>Resume ${Math.min(left, goalRoom())} left</strong></span>
        <span class="primary-arrow" aria-hidden="true">→</span>
      </button>`;
    }
    return startStudyBtn(id, queued);
  }

  function startStudyBtn(id, queued) {
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
    if (sessionLeft() > 0 && capSessionToGoal()) {
      const wasPaused = sessionPaused || studyFocusExit;
      sessionPaused = false;
      studyFocusExit = false;
      if (wasPaused) {
        window.WikiAnalytics?.record({
          type: "session_resume",
          sectionId: session.sectionId,
          videoSlug: session.videoSlug,
        });
      }
      enterPracticeFocus();
      saveSession();
      go("#/study");
      return;
    }
    startSession(null);
  }

  function maybePauseSession(routeName) {
    if (routeName !== "study") {
      studyFocusExit = true;
      closeStudyFocus();
    }
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
  const TAB_ROUTES = { home: "#/", library: "#/library", study: "#/study", analytics: "#/analytics", aws: "#/aws" };
  // Detail views live under the Library tab.
  const TAB_FOR = { home: "home", library: "library", study: "study", analytics: "analytics", aws: "aws", concept: "library", video: "library" };

  function parseRoute() {
    const h = (location.hash || "#/").replace(/^#/, "");
    let m = h.match(/^\/c\/([^/?#]+)/);
    if (m) return { name: "concept", slug: decodeURIComponent(m[1]) };
    m = h.match(/^\/v\/([^/?#]+)/);
    if (m) return { name: "video", slug: decodeURIComponent(m[1]) };
    if (h.startsWith("/library")) return { name: "library" };
    if (h.startsWith("/study")) return { name: "study" };
    if (h.startsWith("/analytics")) return { name: "analytics" };
    if (h.startsWith("/aws")) return { name: "aws" };
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
    document.title = ROUTE_TITLES[r.name] || "Wiki Review Cards";
    tabs.forEach((b) => {
      const on = b.dataset.tab === TAB_FOR[r.name];
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    const suiteCurrent = r.name === "aws" ? "aws" : "cards";
    document.querySelectorAll(".suite-nav a").forEach((a) => {
      if (a.dataset.suite === suiteCurrent) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (r.name === "concept") renderDetail(r.slug);
    else if (r.name === "video") renderVideo(r.slug);
    else if (r.name === "library") renderLibrary();
    else if (r.name === "study") renderStudy();
    else if (r.name === "analytics") renderAnalytics();
    else if (r.name === "aws") {
      if (window.AwsStudy && typeof window.AwsStudy.render === "function") window.AwsStudy.render(root);
      else root.textContent = "AWS study failed to load.";
    } else renderHome();
    if (!resumeLock) savePlace();
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

  // ---------- automatic GitHub sync ----------
  const BACKUP_APP = "wiki-flashcards";
  const AGENT_APP = "wiki-flashcards-agent";
  const SAVE_DELAY = 2500;
  const syncLabel = document.getElementById("sync-label");
  const connectEl = document.getElementById("connect");
  const connectBtn = document.getElementById("btn-connect");
  let saveTimer = null;
  let saving = false;
  let loadingSync = false;
  let saveAgain = false;
  let retried = false;
  let applyingRemote = false;
  let syncedSnapshot = null;
  let agentUnion = [];
  let agentList = [];
  let agentViewDirty = false;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function hhmm() {
    const now = new Date();
    return pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }
  function hasToken() {
    try {
      const cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
      return !!(cfg && cfg.token);
    } catch (e) {
      return false;
    }
  }
  function setSyncStatus(text) {
    if (!syncLabel) return;
    syncLabel.textContent = text || "";
    syncLabel.title = text || "";
  }
  function showConnect() {
    if (connectEl) connectEl.hidden = hasToken();
  }
  function progressSnapshot() {
    return JSON.stringify({
      cards: store.cards,
      analytics: window.WikiAnalytics?.load?.() || null,
      retired: normalizeRetired(store.retired),
    });
  }
  function failSync(err) {
    setSyncStatus(err && err.message ? err.message : String(err));
    showConnect();
  }
  function refreshIfProgressChanged(before) {
    if (!DATA || progressSnapshot() === before) return;
    if (document.querySelector("#study-session, .done-panel")) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    render();
  }
  function refreshAgentView() {
    if (!DATA || !agentViewDirty) return;
    agentViewDirty = false;
    if (document.querySelector("#study-session, .done-panel")) return;
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
    render();
  }
  function projectAgentEntries() {
    if (!DATA || !window.WikiAgent) return;
    const sectionId = WikiAgent.AGENT_SECTION.id;
    DATA.concepts = DATA.concepts.filter((c) => !c.fromAgent);
    DATA.sections = DATA.sections.filter((s) => s.id !== sectionId);
    bySlug = {};
    for (const c of DATA.concepts) bySlug[c.slug] = c;
    const surface = WikiAgent.surface(DATA.concepts, agentUnion, DATA.sections.map((s) => s.id));
    if (surface.cards.some((c) => c.section === sectionId)) DATA.sections.push(WikiAgent.AGENT_SECTION);
    for (const card of surface.cards) {
      DATA.concepts.push(card);
      bySlug[card.slug] = card;
    }
    agentList = surface.list;
  }
  function applyAgentFile(data) {
    if (!window.WikiAgent) return;
    const next = WikiAgent.unionEntries(agentUnion, data);
    if (next === agentUnion) return;
    agentUnion = next;
    if (DATA) projectAgentEntries();
    agentViewDirty = true;
  }
  function loadAgentSideFile() {
    if (!window.GhSync || !window.WikiAgent || !hasToken()) return Promise.resolve();
    let run;
    try {
      run = GhSync.load(AGENT_APP, applyAgentFile);
    } catch (e) {
      return Promise.resolve();
    }
    return run.then(() => {
      refreshAgentView();
    }, () => {
      agentViewDirty = false;
    });
  }
  function visibleAgentItems() {
    if (!agentList.length) return [];
    if (libSearch) {
      const q = libSearch.toLowerCase();
      return agentList.filter((item) =>
        `${item.title} ${item.note} ${item.conceptSlug} ${item.q} ${item.a}`.toLowerCase().includes(q)
      );
    }
    return libFilter === "all" ? agentList : [];
  }
  function isCommitLink(link) {
    const label = String((link && link.label) || "").trim().toLowerCase();
    const url = String((link && link.url) || "");
    return label === "commit" || /github\.com\/[^/]+\/[^/]+\/commit\//i.test(url);
  }
  function agentListHtml(items) {
    if (!items || !items.length) return "";
    const rows = items.map((item) => {
      const kind = (window.WikiAgent && WikiAgent.KIND_LABELS[item.kind]) || item.kind;
      const open = item.openSlug
        ? `<button type="button" class="agent-open" data-slug="${esc(item.openSlug)}">Open card</button>`
        : "";
      const links = (item.links || []).filter((link) => !isCommitLink(link)).map((link) =>
        `<a class="agent-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)}</a>`
      ).join("");
      const note = item.note ? `<div class="row-author">${esc(item.note)}</div>` : "";
      const question = item.q ? `<div class="row-author">Q: ${esc(item.q)}</div>` : "";
      const actions = open || links ? `<div class="agent-actions">${open}${links}</div>` : "";
      return `<div class="agent-row">
        <div class="t"><span>${esc(item.title)}</span><span class="badge agent">${esc(kind)}</span></div>
        ${note}${question}${actions}
      </div>`;
    }).join("");
    return `<section class="home-section" aria-labelledby="agent-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">From the agent log</span>
          <h2 id="agent-title">Added by agent</h2>
        </div>
      </div>
      ${rows}
    </section>`;
  }
  function bindAgentList(scope) {
    scope.querySelectorAll(".agent-open").forEach((btn) => {
      btn.onclick = () => go(`#/c/${encodeURIComponent(btn.dataset.slug)}`);
    });
  }
  function scheduleIfChanged() {
    if (progressSnapshot() === syncedSnapshot) return;
    scheduleSync();
  }
  function scheduleSync() {
    if (!window.GhSync || !hasToken()) {
      showConnect();
      if (!hasToken()) setSyncStatus("Not synced");
      return;
    }
    retried = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushNow, SAVE_DELAY);
  }
  function progressPayload() {
    return {
      app: BACKUP_APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: store.cards,
      analytics: window.WikiAnalytics?.load?.() || null,
      retired: normalizeRetired(store.retired),
    };
  }
  function applyProgress(data) {
    if (!data || data.app !== BACKUP_APP || !data.cards || typeof data.cards !== "object") {
      throw new Error("This file is not a Wiki Flashcards backup");
    }
    const preKey = `${STORE_KEY}-pre-import`;
    if (localStorage.getItem(preKey) == null) {
      localStorage.setItem(preKey, JSON.stringify({
        cards: store.cards,
        analytics: window.WikiAnalytics?.load?.(),
        retired: normalizeRetired(store.retired),
      }));
    }
    applyingRemote = true;
    try {
      store.cards = WikiAnalytics.mergeCards(store.cards, data.cards);
      if (data.retired != null) store.retired = mergeRetired(store.retired, data.retired);
      save();
      if (data.analytics) WikiAnalytics.mergeFrom(data.analytics);
    } finally {
      applyingRemote = false;
    }
  }
  function pushNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!window.GhSync || !hasToken()) {
      showConnect();
      if (!hasToken()) setSyncStatus("Not synced");
      return Promise.resolve();
    }
    if (saving || loadingSync) {
      saveAgain = true;
      return Promise.resolve();
    }
    saving = true;
    setSyncStatus("Syncing…");
    const before = progressSnapshot();
    let run;
    try {
      run = GhSync.save(BACKUP_APP, progressPayload, applyProgress, { quiet: true });
    } catch (e) {
      saving = false;
      failSync(e);
      return Promise.resolve();
    }
    return run.then(() => {
      saving = false;
      retried = false;
      syncedSnapshot = progressSnapshot();
      setSyncStatus("Synced " + hhmm());
      showConnect();
      refreshIfProgressChanged(before);
      if (saveAgain) {
        saveAgain = false;
        return pushNow();
      }
    }, (err) => {
      saving = false;
      showConnect();
      if (!retried && /another device/.test(String(err && err.message))) {
        retried = true;
        setSyncStatus("Syncing…");
        saveTimer = setTimeout(pushNow, 1000);
        return;
      }
      failSync(err);
    });
  }
  function pull() {
    if (!window.GhSync) {
      setSyncStatus("GitHub sync failed to load.");
      return Promise.resolve();
    }
    if (saving) {
      saveAgain = true;
      return Promise.resolve();
    }
    if (loadingSync) return Promise.resolve();
    loadingSync = true;
    setSyncStatus("Syncing…");
    const before = progressSnapshot();
    let run;
    try {
      run = GhSync.load(BACKUP_APP, applyProgress);
    } catch (e) {
      loadingSync = false;
      failSync(e);
      return Promise.resolve();
    }
    return run.then(() => {
      loadingSync = false;
      showConnect();
      refreshIfProgressChanged(before);
      return loadAgentSideFile().then(() => pushNow());
    }, (err) => {
      loadingSync = false;
      failSync(err);
    });
  }
  function autoLoad() {
    showConnect();
    if (!window.GhSync) {
      setSyncStatus("GitHub sync failed to load.");
      return;
    }
    if (!hasToken()) {
      setSyncStatus("Not synced");
      return;
    }
    if (loadingSync || saving || saveTimer) return;
    pull();
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
      <button type="button" class="section-row dx-card" data-section="${s.id}">
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
    setChrome("Wiki Review Cards", studyChromeMeta(goal), false);
    let html = `
      <section class="learning-hero dx-card" aria-labelledby="learning-title">
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
      ${primaryStudyBtn("study-all", queued)}
      ${agentListHtml(agentList)}`;
    if (next && badgeTitle(next)) {
      html += `
        <button type="button" class="milestone-card dx-card" id="milestone-card">
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
    for (const s of DATA.sections) {
      if (isAgentSection(s.id)) continue;
      html += sectionRowHtml(s, stats(s.id));
    }
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
    bindAgentList(root);
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
    box.oninput = () => { libSearch = box.value; renderLibList(); savePlace(); };
    root.querySelectorAll(".filter-chip").forEach((b) => {
      b.onclick = () => { libFilter = b.dataset.f; savePlace(); renderLibrary(); };
    });
    renderLibList();
  }

  function conceptMatches(c) {
    if (libFilter === "known" && !isLibraryKnown(c.slug)) return false;
    if (libFilter === "unknown" && !isUnknown(c.slug)) return false;
    if (libFilter === "due" && !isDue(c.slug)) return false;
    if (libFilter === "new" && !isNew(c.slug)) return false;
    if (libSearch) {
      const q = libSearch.toLowerCase();
      const sources = (c.videos || [])
        .map((s) => { const v = videoOf(s); return v ? `${v.author || ""} ${v.title || ""}` : ""; })
        .join(" ");
      const hay = `${c.title} ${c.slug} ${(c.keywords || []).join(" ")} ${sources}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function conceptEmoji(c) {
    if (window.WikiAgent && typeof WikiAgent.emojiOf === "function") return WikiAgent.emojiOf(c);
    if (!c || typeof c !== "object") return "";
    const emoji = c.e == null ? "" : String(c.e).trim();
    return emoji || (c.emoji == null ? "" : String(c.emoji).trim());
  }
  /** Same markup older concepts use. A missing emoji leaves the slot empty. */
  function emojiTag(c, tag, className) {
    const emoji = conceptEmoji(c);
    if (!emoji) return "";
    return `<${tag} class="${className}">${esc(emoji)}</${tag}>`;
  }

  function conceptRow(c) {
    let badge = "";
    if (isLibraryKnown(c.slug)) badge = `<span class="badge known">Known</span>`;
    else if (isUnknown(c.slug)) badge = `<span class="badge unknown">Unknown</span>`;
    else if (isDue(c.slug)) badge = `<span class="badge due">Due</span>`;
    const kws = (c.keywords || []).slice(0, 4).map((k) => `<span class="kw">${esc(k)}</span>`).join("");
    const emoji = emojiTag(c, "span", "row-emoji");
    const authors = (c.videos || []).map((s) => (videoOf(s) || {}).author).filter(Boolean);
    const uniqAuthors = [...new Set(authors)].slice(0, 2);
    const authorLine = uniqAuthors.length
      ? `<span class="row-author">${esc(uniqAuthors.join(" · "))}</span>`
      : "";
    const body = `
        <span class="t">${emoji}<span>${esc(c.title)}</span>${badge}</span>
        ${authorLine}
        ${kws ? `<span class="kw-row">${kws}</span>` : ""}`;
    if (!isLibraryKnown(c.slug)) {
      return `<button type="button" class="concept-row dx-card" data-slug="${esc(c.slug)}">${body}</button>`;
    }
    return `
      <div class="concept-row dx-card is-known-row" data-slug="${esc(c.slug)}">
        <button type="button" class="concept-open" data-slug="${esc(c.slug)}">${body}</button>
        <button type="button" class="unhide-btn" data-slug="${esc(c.slug)}">Unhide</button>
      </div>`;
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
      const loose = DATA.concepts.filter((c) => isAgentSection(c.section) || !DATA.sections.some((s) => s.id === c.section));
      if (loose.length) html += loose.map(conceptRow).join("");
      for (const s of DATA.sections) {
        if (isAgentSection(s.id)) continue;
        const members = DATA.concepts.filter((c) => c.section === s.id);
        if (!members.length) continue;
        const open = !!store.libOpen[s.id];
        const bodyId = `lib-body-${s.id}`;
        html += `
          <div class="lib-group dx-card ${open ? "open" : ""}" data-section="${s.id}">
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
    scope.querySelectorAll("button.concept-row, .concept-open").forEach((r) => {
      r.onclick = () => go(`#/c/${encodeURIComponent(r.dataset.slug)}`);
    });
    scope.querySelectorAll(".unhide-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        unhideSlug(btn.dataset.slug);
        if (parseRoute().name === "library") renderLibrary();
        else render();
      };
    });
  }

  // ----- detail -----
  function renderDetail(slug) {
    const c = bySlug[slug];
    if (!c) return renderMissing("Concept not found.");
    setChrome(sectionLabel(c.section), "", true);
    if (detailReveal.slug !== slug) {
      detailReveal = { slug, on: false };
    }
    const revealed = detailReveal.on;
    const known = isLibraryKnown(slug);
    const emoji = emojiTag(c, "span", "detail-emoji");
    root.innerHTML = `
      <div class="detail-title">${emoji}${esc(c.title)}
        ${known ? '<span class="badge known">Known</span>' : isUnknown(slug) ? '<span class="badge unknown">Unknown</span>' : ""}
      </div>
      ${c.keywords.length ? `<div class="kw-row">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>` : ""}
      <div class="panel qa-block dx-card">
        <div class="q">Q: ${rich(c.q)}</div>
        ${revealed ? `<div class="a">A: ${rich(c.a)}</div>${c.x ? `<div class="x">Example: ${rich(c.x)}</div>` : ""}`
          : `<button type="button" class="reveal-answer" id="reveal-answer">Reveal answer</button>`}
      </div>
      ${c.definition ? `<div class="detail-def">${esc(c.definition)}</div>` : ""}
      ${(c.videos && c.videos.length) ? `<h2 class="head">From these videos</h2>${videoRowsHtml(c.videos, false)}` : ""}
      ${revealed ? `<button type="button" class="toggle-known-btn ${known ? "is-known" : ""}" id="toggle-known">
        ${known ? "Unhide" : "Mark as known"}
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
      if (known) unhideSlug(slug);
      else {
        retireSlug(slug);
        showKnownUndo(slug, null);
      }
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
  function reduceMotion() {
    return !!(reduceQuery && reduceQuery.matches);
  }
  function localDay(t) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function loadPlace() {
    try {
      const data = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }
  function snapshotPlace() {
    const prev = loadPlace();
    const routeName = DATA ? parseRoute().name : "home";
    const tab = TAB_FOR[routeName] || prev.tab || "home";
    const data = {
      v: 1,
      tab,
      search: libSearch,
      libFilter: libFilter || "all",
      deck: prev.deck || "",
      deckKind: prev.deckKind || "",
      index: Number(prev.index) || 0,
      cardId: prev.cardId || "",
      queueIds: Array.isArray(prev.queueIds) ? prev.queueIds.slice() : [],
      flipped: !!prev.flipped,
      active: !!prev.active,
      done: Number(prev.done) || 0,
      grades: prev.grades || emptyGrades(),
      goal: Number(prev.goal) || 0,
      combo: pendingCombo ? pendingCombo.combo : (Number(prev.combo) || 0),
      comboAt: pendingCombo ? pendingCombo.comboAt : (Number(prev.comboAt) || 0),
    };
    if (session && session.queue && session.queue.length && session.idx < session.queue.length) {
      data.index = session.idx || 0;
      data.flipped = !!session.flipped;
      data.queueIds = session.queue.slice();
      data.cardId = session.queue[session.idx] || "";
      data.done = Number(session.done) || 0;
      data.grades = session.grades || emptyGrades();
      data.goal = Number(session.goal) || 0;
      data.active = true;
      if (session.videoSlug) {
        data.deck = session.videoSlug;
        data.deckKind = "video";
      } else if (session.sectionId) {
        data.deck = session.sectionId;
        data.deckKind = "section";
      } else {
        data.deck = "";
        data.deckKind = "";
      }
    } else if (session || placeClear) {
      data.active = false;
      data.queueIds = [];
      data.cardId = "";
      data.index = 0;
      data.flipped = false;
      data.deck = "";
      data.deckKind = "";
      data.done = 0;
      placeClear = false;
    }
    return data;
  }
  function savePlace() {
    if (resumeLock || !DATA) return;
    try { localStorage.setItem(PLACE_KEY, JSON.stringify(snapshotPlace())); }
    catch (e) { /* private mode */ }
  }
  function goalRoom() {
    const goal = dailyGoal(null);
    const reviewed = todayReviews();
    if (typeof reviewed !== "number" || !isFinite(reviewed) || reviewed < 0) return goal > 0 ? goal : 0;
    return Math.max(0, goal - reviewed);
  }
  function capSessionToGoal() {
    if (!session || !session.queue || session.idx >= session.queue.length) return false;
    const room = goalRoom();
    if (room <= 0) return false;
    if (session.queue.length - session.idx > room) {
      session.queue = session.queue.slice(0, session.idx + room);
      session.total = session.queue.length;
    }
    return true;
  }
  function sessionFromPlace(data, room) {
    if (!data || !Array.isArray(data.queueIds) || !data.queueIds.length) return null;
    if (!(room > 0)) return null;
    const queue = [];
    data.queueIds.forEach((id) => {
      if (bySlug[id] && !isRetired(id)) queue.push(id);
    });
    if (!queue.length) return null;
    let idx = Number(data.index) || 0;
    if (data.cardId) {
      const at = queue.indexOf(data.cardId);
      if (at >= 0) idx = at;
    }
    if (idx < 0) idx = 0;
    if (idx >= queue.length) idx = queue.length - 1;
    let nextQueue = queue;
    if (nextQueue.length - idx > room) nextQueue = nextQueue.slice(0, idx + room);
    if (!nextQueue.length || idx >= nextQueue.length) return null;
    const g = data.grades || {};
    const scope = data.deckKind === "section"
      ? { sectionId: data.deck || null }
      : data.deckKind === "video"
        ? { videoSlug: data.deck || null }
        : null;
    return {
      queue: nextQueue,
      idx,
      flipped: !!data.flipped,
      hint: false,
      total: nextQueue.length,
      sectionId: data.deckKind === "section" ? (data.deck || null) : null,
      videoSlug: data.deckKind === "video" ? (data.deck || null) : null,
      done: Number(data.done) || 0,
      goal: Number(data.goal) || dailyGoal(scope),
      grades: {
        again: Number(g.again) || 0,
        hard: Number(g.hard) || 0,
        good: Number(g.good) || 0,
        easy: Number(g.easy) || 0,
      },
    };
  }
  function deckLabel(data) {
    if (!data || !data.deck) return "All topics";
    if (data.deckKind === "video") {
      const v = videoOf(data.deck);
      return v && v.title ? v.title : "Video";
    }
    if (data.deckKind === "section") return sectionLabel(data.deck);
    return "All topics";
  }
  function continueHtml() {
    const data = loadPlace();
    const room = goalRoom();
    const viable = sessionFromPlace(data, room);
    const busy = !!(session && !sessionPaused && !studyFocusExit && session.idx < (session.queue || []).length);
    const show = !!(viable && !busy);
    const idx = viable ? viable.idx : (Number(data.index) || 0);
    const total = viable ? viable.queue.length : ((data.queueIds && data.queueIds.length) || 0);
    const where = `${deckLabel(data)} · card ${idx + 1}${total ? ` of ${total}` : ""}`;
    return `<button type="button" id="ux-continue" class="ux-continue" ${show ? "" : "hidden"} aria-label="${esc(`Continue where I left off, ${where}`)}">
      <span><small>${esc(where)}</small><strong>Continue where I left off</strong></span>
      <span class="ux-continue-go" aria-hidden="true">→</span>
    </button>`;
  }
  function displayCombo() {
    const combo = pendingCombo ? pendingCombo.combo : (Number(loadPlace().combo) || 0);
    const at = pendingCombo ? pendingCombo.comboAt : loadPlace().comboAt;
    if (combo < 1 || !at) return 0;
    if (localDay(at) !== localDay(Date.now())) return 0;
    return combo;
  }
  function noteCombo(g) {
    const prev = loadPlace();
    const now = Date.now();
    const today = localDay(now);
    const prevCombo = pendingCombo ? pendingCombo.combo : (Number(prev.combo) || 0);
    const prevAt = pendingCombo ? pendingCombo.comboAt : prev.comboAt;
    const continuing = prevAt && localDay(prevAt) === today && prevCombo > 0;
    pendingCombo = {
      combo: g === 0 ? 0 : (continuing ? prevCombo + 1 : 1),
      comboAt: now,
    };
  }
  function resumeSessionFromPlace() {
    const room = goalRoom();
    const next = sessionFromPlace(loadPlace(), room);
    if (!next) return false;
    resumeLock += 1;
    try {
      session = next;
      sessionPaused = false;
      studyFocusExit = false;
    } finally {
      resumeLock -= 1;
    }
    enterPracticeFocus();
    saveSession();
    return true;
  }
  function explicitBootHash() {
    const hash = bootHash || "";
    return !!hash && hash !== "#" && hash !== "#/";
  }
  function applyBootPlace() {
    const data = loadPlace();
    if (typeof data.search === "string") libSearch = data.search;
    if (["all", "unknown", "known", "due", "new"].includes(data.libFilter)) libFilter = data.libFilter;
    if (!explicitBootHash() && data.tab && data.tab !== "home" && TAB_ROUTES[data.tab]) {
      history.replaceState(history.state || { d: 0 }, "", TAB_ROUTES[data.tab]);
    }
    if (parseRoute().name === "study" && data.active) resumeSessionFromPlace();
  }
  function fullscreenNode() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function requestStudyFullscreen() {
    const el = document.documentElement;
    if (!el || typeof el.requestFullscreen !== "function") return;
    if (fullscreenNode()) return;
    try {
      const pending = el.requestFullscreen();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch (e) { /* iOS Safari rejects or omits fullscreen on the document */ }
  }
  function exitStudyFullscreen() {
    if (!fullscreenNode() || typeof document.exitFullscreen !== "function") return;
    try {
      const pending = document.exitFullscreen();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch (e) { /* already left */ }
  }
  function syncExitButton() {
    const btn = document.getElementById("practice-focus-exit");
    if (!btn) return;
    btn.hidden = !practiceFocus;
    btn.setAttribute("aria-hidden", practiceFocus ? "false" : "true");
  }
  function closeStudyFocus() {
    practiceFocus = false;
    browserFullscreen = false;
    document.documentElement.classList.remove("practice-focus");
    document.body.classList.remove("study-focus");
    syncExitButton();
    exitStudyFullscreen();
  }
  function resetPracticeScroll() {
    const nodes = [document.scrollingElement, document.documentElement, document.body, root, document.getElementById("app")];
    nodes.forEach((node) => {
      if (!node) return;
      node.scrollTop = 0;
      node.scrollLeft = 0;
    });
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }
  function enterPracticeFocus() {
    const already = practiceFocus;
    practiceFocus = true;
    document.documentElement.classList.add("practice-focus");
    syncExitButton();
    resetPracticeScroll();
    if (!already) requestStudyFullscreen();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (!practiceFocus) return;
        resetPracticeScroll();
        requestAnimationFrame(() => { if (practiceFocus) resetPracticeScroll(); });
      });
    }
  }
  function exitPracticeFocus() {
    const was = practiceFocus || document.documentElement.classList.contains("practice-focus");
    practiceFocus = false;
    browserFullscreen = false;
    document.documentElement.classList.remove("practice-focus");
    syncExitButton();
    if (!was) return;
    exitStudyFullscreen();
  }
  function onFullscreenChange() {
    const active = fullscreenNode();
    if (active) {
      browserFullscreen = true;
      if (practiceFocus) resetPracticeScroll();
      return;
    }
    if (!browserFullscreen || !practiceFocus) return;
    browserFullscreen = false;
    practiceFocus = false;
    document.documentElement.classList.remove("practice-focus");
    syncExitButton();
  }
  function hideUndoToast() {
    clearTimeout(undoTimer);
    undoTimer = null;
    undoState = null;
    document.querySelectorAll(".undo-toast").forEach((node) => node.remove());
  }
  function showKnownUndo(slug, restore) {
    hideUndoToast();
    const el = document.createElement("div");
    el.className = "undo-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    const text = document.createElement("span");
    text.textContent = "Marked Known";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Undo";
    el.append(text, btn);
    document.body.appendChild(el);
    undoState = { slug, restore: restore || null };
    btn.addEventListener("click", () => {
      const state = undoState;
      hideUndoToast();
      if (!state) return;
      unhideSlug(state.slug);
      if (state.restore && session) {
        const at = Math.max(0, Math.min(state.restore.idx, session.queue.length));
        if (!session.queue.includes(state.slug)) session.queue.splice(at, 0, state.slug);
        session.total = session.queue.length;
        session.idx = Math.max(0, session.queue.indexOf(state.slug));
        session.flipped = !!state.restore.flipped;
        sessionPaused = false;
        studyFocusExit = false;
        enterPracticeFocus();
        saveSession();
      }
      if (DATA) render();
    });
    undoTimer = setTimeout(hideUndoToast, 4500);
  }
  function foldSection(id, label, body) {
    if (!body) return "";
    return `<section class="card-fold">
      <button type="button" class="card-fold-btn" aria-expanded="false" aria-controls="${id}">
        <span>${esc(label)}</span><span class="card-fold-chev" aria-hidden="true">&#8250;</span>
      </button>
      <div class="card-fold-panel" id="${id}" hidden>${body}</div>
    </section>`;
  }
  function cardFolds(c, opts) {
    const parts = [];
    if (opts.insight && c.x) {
      parts.push(foldSection("fold-insight", "Insight", `<div class="x-text">${rich(c.x)}</div>`));
    }
    if (opts.tags && c.keywords && c.keywords.length) {
      const chips = c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("");
      parts.push(foldSection("fold-tags", "Tags", `<div class="kw-row">${chips}</div>`));
    }
    if (opts.videos) {
      const videos = videoRowsHtml(opts.videos === "all" ? (c.videos || []) : (c.videos || []).slice(0, 2), true);
      if (videos) parts.push(foldSection("fold-videos", "Source videos", videos));
    }
    return parts.join("");
  }
  function bindFolds(scope) {
    scope.querySelectorAll(".card-fold-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const panel = document.getElementById(btn.getAttribute("aria-controls"));
        const open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        if (panel) panel.hidden = !open;
      });
    });
  }
  function skipRetiredInSession() {
    if (!session) return;
    let changed = false;
    while (session.idx < session.queue.length && isRetired(session.queue[session.idx])) {
      session.queue.splice(session.idx, 1);
      changed = true;
    }
    if (changed) {
      session.total = session.queue.length;
      saveSession();
    }
  }
  function retireCurrentCard() {
    if (!session || session.idx >= session.queue.length) return;
    const slug = session.queue[session.idx];
    const restore = { idx: session.idx, flipped: true };
    retireSlug(slug);
    const before = session.queue.slice(0, session.idx);
    const after = session.queue.slice(session.idx + 1).filter((id) => id !== slug);
    session.queue = before.concat(after);
    session.total = session.queue.length;
    session.flipped = false;
    session.hint = false;
    saveSession();
    setStudyStatus("Known — card hidden");
    showKnownUndo(slug, restore);
    render();
  }

  function startSession(opts) {
    const scope = typeof opts === "string" || !opts ? { sectionId: opts || null } : opts;
    const queue = buildQueue(scope);
    sessionPaused = false;
    studyFocusExit = queue.length === 0;
    if (queue.length) enterPracticeFocus();
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
    const goal = (session && session.goal) || dailyGoal(null);
    const reviews = todayReviews();
    const shown = Math.max(0, Number(reviews) || 0);
    const pct = goal ? Math.min(100, Math.round((shown / goal) * 100)) : 0;
    const combo = displayCombo();
    const now = Math.min(shown, goal || shown);
    return `<div class="study-progress-wrap dx-card">
      <div class="practice-session-row">
        <p id="study-progress" class="study-progress">${shown}/${goal}</p>
        <span id="practice-combo" class="practice-combo" ${combo ? "" : "hidden"}>Combo ×${combo}</span>
      </div>
      <div class="study-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${now}" aria-label="Today's reviews">
        <div id="study-progress-fill" class="study-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  }

  function studyCardOpen() {
    return !!(
      session &&
      !sessionPaused &&
      !studyFocusExit &&
      session.queue &&
      session.idx < session.queue.length &&
      parseRoute().name === "study" &&
      document.getElementById("flashcard")
    );
  }

  function revealCard() {
    if (!session || session.flipped || sessionPaused || studyFocusExit) return false;
    if (!session.queue || session.idx >= session.queue.length) return false;
    session.flipped = true;
    saveSession();
    setStudyStatus("Answer revealed");
    render();
    return true;
  }

  function stepCard(delta) {
    if (!session || session.flipped || sessionPaused || studyFocusExit) return false;
    if (!session.queue || session.queue.length < 2) return false;
    if (session.idx < 0 || session.idx >= session.queue.length) return false;
    if (session.queue.length - session.idx < 2) return false;
    if (delta > 0) session.queue.push(session.queue.splice(session.idx, 1)[0]);
    else if (delta < 0) session.queue.splice(session.idx, 0, session.queue.pop());
    else return false;
    session.flipped = false;
    saveSession();
    setStudyStatus(delta > 0 ? "Next card" : "Previous card");
    render();
    return true;
  }

  function renderStudy() {
    if (!session || session.idx >= session.queue.length || studyFocusExit || sessionPaused) {
      closeStudyFocus();
      return renderStudyEntryOrDone();
    }
    skipRetiredInSession();
    if (!session || session.idx >= session.queue.length) {
      closeStudyFocus();
      return renderStudyEntryOrDone();
    }
    const slug = session.queue[session.idx];
    const c = bySlug[slug];
    if (!c) {
      advance();
      return;
    }
    if (practiceFocus) document.documentElement.classList.add("practice-focus");
    else document.documentElement.classList.remove("practice-focus");
    syncExitButton();
    const sec = sectionOf(c.section);
    setChrome(studyScopeTitle(), studyChromeMeta(session.goal), false);
    const flipped = !!session.flipped;
    const hardL = previewInterval(slug, 1);
    const goodL = previewInterval(slug, 2);
    const easyL = previewInterval(slug, 3);
    root.innerHTML = `
      <div id="study-session" class="study-session">
        ${studyProgressHtml()}
        <div id="flashcard" class="flashcard dx-card${flipped ? " is-flipped" : ""}" role="button" tabindex="0" aria-label="Flashcard — tap to flip" aria-keyshortcuts="Space Enter ArrowUp">
          <div class="ux-swipe-label" aria-hidden="true"></div>
          <div id="flashcard-front" class="flashcard-face flashcard-front" ${flipped ? "hidden" : ""}>
            <div class="flashcard-hint" style="color:${sec.color}">${esc(sectionLabel(c.section))}</div>
            ${emojiTag(c, "div", "card-emoji")}
            <div class="q-text">${rich(c.q)}</div>
            <div class="flashcard-hint">Tap to reveal</div>
          </div>
          <div id="flashcard-back" class="flashcard-face flashcard-back" ${flipped ? "" : "hidden"}>
            <div class="flashcard-hint">Question</div>
            <div class="q-text q-compact">${rich(c.q)}</div>
            <div class="flashcard-hint">Answer</div>
            <div class="a-text">${rich(c.a)}</div>
            <div class="concept-name">${esc(c.title)}</div>
            ${cardFolds(c, { insight: true, tags: true, videos: "all" })}
          </div>
        </div>
        <button type="button" id="btn-reveal" class="btn btn-secondary btn-block" ${flipped ? "hidden" : ""} aria-keyshortcuts="Space Enter ArrowUp">Reveal answer</button>
        <div id="study-actions" class="study-actions" ${flipped ? "" : "hidden"}>
          <button type="button" id="btn-again" class="btn btn-rate btn-again" aria-keyshortcuts="1 ArrowLeft" aria-label="Again, repeat now"><span class="rate-key">1 ←</span>Again</button>
          <button type="button" id="btn-hard" class="btn btn-rate btn-hard" aria-keyshortcuts="2 ArrowDown" aria-label="Hard, ${esc(hardL)}"><span class="rate-key">2 ↓</span>Hard</button>
          <button type="button" id="btn-good" class="btn btn-rate btn-good" aria-keyshortcuts="3 ArrowUp" aria-label="Good, ${esc(goodL)}"><span class="rate-key">3 ↑</span>Good</button>
          <button type="button" id="btn-easy" class="btn btn-rate btn-easy" aria-keyshortcuts="4 ArrowRight" aria-label="Easy, ${esc(easyL)}"><span class="rate-key">4 →</span>Easy</button>
          <button type="button" id="mark-known-btn" class="btn btn-rate btn-known" aria-label="Known, retire this card"><span class="rate-key">hide</span>Known</button>
        </div>
        <p id="ux-keys" class="ux-keys">Space or Enter reveals. Arrows move, then grade. 1–4 grade. Swipe up to reveal.</p>
      </div>`;
    const card = root.querySelector("#flashcard");
    if (card) {
      card.addEventListener("click", (e) => {
        if (blockClick) return;
        if (e.target.closest && e.target.closest("button, a, .card-fold, .video-row")) return;
        if (!session.flipped) revealCard();
      });
    }
    const revealBtn = root.querySelector("#btn-reveal");
    if (revealBtn) revealBtn.addEventListener("click", (e) => { e.stopPropagation(); revealCard(); });
    [["#btn-again", 0], ["#btn-hard", 1], ["#btn-good", 2], ["#btn-easy", 3]].forEach(([sel, g]) => {
      const btn = root.querySelector(sel);
      if (btn) btn.addEventListener("click", () => applySessionGrade(g));
    });
    const knownBtn = root.querySelector("#mark-known-btn");
    if (knownBtn) knownBtn.addEventListener("click", (e) => { e.stopPropagation(); retireCurrentCard(); });
    bindFolds(root);
    if (card) {
      try { card.focus({ preventScroll: true }); }
      catch (e) { try { card.focus(); } catch (err) { /* focus is optional */ } }
    }
  }

  function applySessionGrade(g) {
    if (!session || !session.flipped || sessionPaused || studyFocusExit) return false;
    if (session.idx >= session.queue.length) return false;
    const slug = session.queue[session.idx];
    const when = g === 0 ? "repeat now" : `again in ${previewInterval(slug, g)}`;
    noteCombo(g);
    grade(slug, g);
    setStudyStatus(`${GRADE_LABELS[g]} — ${when}`);
    if (g === 0) {
      const pos = Math.min(session.queue.length, session.idx + 4);
      session.queue.splice(pos, 0, slug);
      session.total += 1;
    }
    saveSession();
    advance();
    return true;
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
      placeClear = true;
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
      <section class="learning-hero dx-card" aria-labelledby="study-title">
        <span class="eyebrow">Study queue</span>
        <h2 id="study-title">${st.due} due · ${st.fresh} new</h2>
        <div class="status-stats">
          <div><strong>${st.due}</strong><span>Due</span></div>
          <div><strong>${st.fresh}</strong><span>New</span></div>
          <div><strong>${st.known}</strong><span>Known</span></div>
        </div>
      </section>
      ${continueHtml()}
      ${startStudyBtn("study-all", queued)}
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
    const cont = root.querySelector("#ux-continue");
    if (cont) cont.onclick = () => { if (resumeSessionFromPlace()) go("#/study"); };
    root.querySelector("#study-all").onclick = () => startSession(null);
    root.querySelectorAll(".section-row").forEach((el) => {
      el.onclick = () => startSession(el.dataset.section);
    });
  }

  // ---------- boot ----------
  captureInsightsReturn();
  backBtn.onclick = goBack;
  const studyExitBtn = document.getElementById("practice-focus-exit");
  if (studyExitBtn) {
    studyExitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitPracticeFocus();
    });
  }
  tabs.forEach((b) => (b.onclick = () => {
    if (b.dataset.tab === "study" && sessionLeft() > 0 && capSessionToGoal()) {
      const wasPaused = sessionPaused || studyFocusExit;
      studyFocusExit = false;
      sessionPaused = false;
      if (wasPaused) {
        window.WikiAnalytics?.record({
          type: "session_resume",
          sectionId: session.sectionId,
          videoSlug: session.videoSlug,
        });
      }
      enterPracticeFocus();
      saveSession();
    }
    go(TAB_ROUTES[b.dataset.tab]);
  }));
  function typingTarget(target) {
    return !!(target && target.closest && target.closest("input, textarea, select, [contenteditable='true']"));
  }
  function onStudyKey(event) {
    if (!event || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (event.key === "Escape") {
      if (!practiceFocus) return;
      event.preventDefault();
      exitPracticeFocus();
      return;
    }
    if (!studyCardOpen() || event.repeat || typingTarget(event.target)) return;
    const key = event.key;
    const up = !!(session && session.flipped);
    const control = event.target && event.target.closest && event.target.closest("button, a");
    let acted = false;
    if ((key === " " || event.code === "Space" || key === "Enter") && !control) {
      if (!up) acted = revealCard();
      if (key === " " || event.code === "Space") acted = true;
    } else if (key === "1" || (up && key === "ArrowLeft")) acted = up ? applySessionGrade(0) : false;
    else if (key === "2" || (up && key === "ArrowDown")) acted = up ? applySessionGrade(1) : false;
    else if (key === "3" || (up && key === "ArrowUp")) acted = up ? applySessionGrade(2) : false;
    else if (key === "4" || (up && key === "ArrowRight")) acted = up ? applySessionGrade(3) : false;
    else if (!up && key === "ArrowLeft") acted = stepCard(-1);
    else if (!up && key === "ArrowRight") acted = stepCard(1);
    else if (!up && key === "ArrowUp") acted = revealCard();
    if (!acted) return;
    event.preventDefault();
    event.stopPropagation();
  }
  function scrollSnapshot() {
    const nodes = [document.scrollingElement, root];
    const saved = [];
    nodes.forEach((node) => {
      if (!node) return;
      saved.push({ node, top: node.scrollTop, left: node.scrollLeft });
    });
    return saved;
  }
  function restoreScroll(saved) {
    (saved || []).forEach((item) => {
      item.node.scrollTop = item.top;
      item.node.scrollLeft = item.left;
    });
  }
  function swipeLabel(text, kind) {
    const card = document.getElementById("flashcard");
    if (!card) return;
    const label = card.querySelector(".ux-swipe-label");
    if (!label) return;
    label.textContent = text;
    label.className = "ux-swipe-label is-on" + (kind ? " " + kind : "");
  }
  function clearDrag() {
    const card = document.getElementById("flashcard");
    if (!card) return;
    card.classList.remove("ux-dragging", "ux-left", "ux-right", "ux-up");
    if (reduceMotion()) card.style.transform = "";
    else {
      card.style.transition = "transform 0.18s var(--ease-out, ease)";
      card.style.transform = "";
      setTimeout(() => { card.style.transition = ""; }, 200);
    }
    const label = card.querySelector(".ux-swipe-label");
    if (label) {
      label.className = "ux-swipe-label";
      label.textContent = "";
    }
  }
  function applyDrag(dx, dy) {
    const card = document.getElementById("flashcard");
    if (!card) return;
    card.classList.add("ux-dragging");
    card.classList.remove("ux-left", "ux-right", "ux-up");
    const up = !!(session && session.flipped);
    if (Math.abs(dy) > Math.abs(dx) && dy < 0) {
      card.classList.add("ux-up");
      swipeLabel("Reveal", "is-reveal");
    } else if (dx < 0) {
      card.classList.add("ux-left");
      swipeLabel(up ? "Again" : "Previous", up ? "is-again" : "is-move");
    } else {
      card.classList.add("ux-right");
      swipeLabel(up ? "Good" : "Next", up ? "is-good" : "is-move");
    }
    if (!reduceMotion()) {
      const x = Math.max(-72, Math.min(72, dx));
      const y = Math.max(-64, Math.min(24, dy));
      card.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  }
  function pressGrade(id) {
    const wrap = document.getElementById("study-actions");
    if (!wrap || wrap.hidden) return false;
    const button = document.getElementById(id);
    if (!button || button.disabled || button.hidden) return false;
    button.click();
    return true;
  }
  function finishSwipe(dx, dy) {
    const distanceX = Math.abs(dx);
    const distanceY = Math.abs(dy);
    if (distanceX < 12 && distanceY < 12) return false;
    blockClick = true;
    const up = !!(session && session.flipped);
    if (distanceY > distanceX && dy < -48) {
      const revealBtn = document.getElementById("btn-reveal");
      if (revealBtn && !revealBtn.hidden) revealBtn.click();
      else revealCard();
      return true;
    }
    if (distanceX > distanceY && distanceX > 48) {
      if (dx < 0) {
        if (up) pressGrade("btn-again");
        else stepCard(-1);
      } else if (up) pressGrade("btn-good");
      else stepCard(1);
      return true;
    }
    return true;
  }
  function onPointerDown(event) {
    const card = event.target && event.target.closest && event.target.closest("#flashcard");
    if (!card || !studyCardOpen()) return;
    blockClick = false;
    if (swipePointer) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest && event.target.closest("button, a, input, select, textarea, .card-fold, .video-row")) return;
    swipePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      claimed: false,
      scroll: false,
      scrollPos: scrollSnapshot(),
    };
  }
  function onPointerMove(event) {
    if (!swipePointer || event.pointerId !== swipePointer.id) return;
    swipePointer.dx = event.clientX - swipePointer.x;
    swipePointer.dy = event.clientY - swipePointer.y;
    const distanceX = Math.abs(swipePointer.dx);
    const distanceY = Math.abs(swipePointer.dy);
    if (!swipePointer.claimed && !swipePointer.scroll) {
      if (distanceX < 8 && distanceY < 8) return;
      if (distanceY > distanceX && swipePointer.dy > 0) {
        swipePointer.scroll = true;
        return;
      }
      swipePointer.claimed = true;
      const card = document.getElementById("flashcard");
      if (card && card.setPointerCapture) {
        try { card.setPointerCapture(event.pointerId); }
        catch (e) { /* already released */ }
      }
    }
    if (!swipePointer.claimed || swipePointer.scroll) return;
    restoreScroll(swipePointer.scrollPos);
    applyDrag(swipePointer.dx, swipePointer.dy);
  }
  function endPointer(event, act) {
    if (!swipePointer || event.pointerId !== swipePointer.id) return;
    const dx = swipePointer.dx;
    const dy = swipePointer.dy;
    const claimed = swipePointer.claimed;
    const saved = swipePointer.scrollPos;
    swipePointer = null;
    clearDrag();
    if (!act || !claimed) return;
    restoreScroll(saved);
    finishSwipe(dx, dy);
  }
  document.addEventListener("keydown", onStudyKey, true);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", (event) => endPointer(event, true));
  document.addEventListener("pointercancel", (event) => endPointer(event, false));
  document.addEventListener("touchmove", (event) => {
    if (!swipePointer || !swipePointer.claimed) return;
    if (event.cancelable) event.preventDefault();
    restoreScroll(swipePointer.scrollPos);
  }, { passive: false });
  document.addEventListener("click", (event) => {
    if (!blockClick) return;
    if (!event.target.closest || !event.target.closest("#flashcard")) return;
    event.preventDefault();
    event.stopPropagation();
    blockClick = false;
  }, true);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
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
      if (!practiceFocus) root.focus();
    }
  });
  if (!history.state) history.replaceState({ d: 0 }, "");

  if (connectBtn) {
    connectBtn.addEventListener("click", () => {
      if (!loadingSync && !saving) pull();
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      savePlace();
      if (saveTimer) pushNow();
    }
    if (document.visibilityState === "visible") autoLoad();
  });
  window.addEventListener("pagehide", () => savePlace());
  showConnect();
  if (!window.GhSync) setSyncStatus("GitHub sync failed to load.");
  else setSyncStatus(hasToken() ? "Syncing…" : "Not synced");

  fetch("data/concepts.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      DATA = data;
      DATA.videos = DATA.videos || {};
      for (const c of data.concepts) {
        if (c) c.e = conceptEmoji(c);
        bySlug[c.slug] = c;
      }
      session = hydrateSession(store.session);
      sessionPaused = !!session;
      studyFocusExit = true;
      window.WikiAnalytics?.bootstrapGamification?.({ dueCount: stats(null).due });
      syncedSnapshot = progressSnapshot();
      if (session && !(loadPlace().queueIds || []).length) savePlace();
      applyBootPlace();
      render();
      if (window.GhSync) {
        setInterval(autoLoad, 60000);
        autoLoad();
      }
    })
    .catch((err) => {
      root.innerHTML = `<div class="empty-note">Failed to load data (${esc(err.message)}).<br>This app must be served over HTTP, not opened as a file.</div>`;
    });
})();
