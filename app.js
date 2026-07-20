/* Wiki Flashcards — vanilla JS, no dependencies. */
(() => {
  "use strict";

  const STORE_KEY = "wiki-flashcards-v1";
  const DAY = 24 * 60 * 60 * 1000;
  const NEW_PER_SESSION = 20;

  let DATA = null; // { sections, concepts }
  let bySlug = {};
  let store = load();
  let currentTab = "home";
  let detailStack = []; // slugs for detail navigation
  let session = null; // { queue: [slug], idx, flipped, total, sectionId }

  const root = document.getElementById("view-root");
  const topTitle = document.getElementById("topbar-title");
  const topMeta = document.getElementById("topbar-meta");
  const backBtn = document.getElementById("back-btn");
  const tabs = document.querySelectorAll("#tabbar .tab");

  // ---------- persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupted store -> start fresh */ }
    return { cards: {}, streak: { last: null, count: 0 }, libOpen: {} };
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
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
  }
  function markUnknown(slug) {
    const c = card(slug);
    c.st = "unknown";
    c.due = Date.now();
    save();
  }
  function clearMark(slug) {
    card(slug).st = null;
    save();
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
    bumpStreak();
    save();
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
  function buildQueue(sectionId) {
    const pool = DATA.concepts.filter((c) => !sectionId || c.section === sectionId);
    const due = pool.filter((c) => isDue(c.slug)).map((c) => c.slug);
    const fresh = pool.filter((c) => isNew(c.slug)).map((c) => c.slug);
    shuffle(due);
    shuffle(fresh);
    return due.concat(fresh.slice(0, NEW_PER_SESSION));
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  // ---------- stats ----------
  function stats(sectionId) {
    const pool = DATA.concepts.filter((c) => !sectionId || c.section === sectionId);
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
  function sectionOf(id) {
    return DATA.sections.find((s) => s.id === id) || { title: id, color: "#888" };
  }

  function setChrome(title, meta, showBack) {
    topTitle.textContent = title;
    topMeta.textContent = meta || "";
    backBtn.classList.toggle("hidden", !showBack);
  }

  function switchTab(tab) {
    currentTab = tab;
    detailStack = [];
    if (tab !== "study") session = null;
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    render();
  }

  function render() {
    if (detailStack.length) return renderDetail(detailStack[detailStack.length - 1]);
    if (currentTab === "home") return renderHome();
    if (currentTab === "library") return renderLibrary();
    if (currentTab === "study") return renderStudy();
  }

  // ----- home -----
  function renderHome() {
    const st = stats(null);
    setChrome("Wiki Flashcards", `${st.total} concepts`, false);
    let html = `
      <div class="stat-grid">
        <div class="stat due"><div class="num">${st.due}</div><div class="lbl">Due now</div></div>
        <div class="stat known"><div class="num">${st.known}</div><div class="lbl">Known</div></div>
        <div class="stat streak"><div class="num">${store.streak.count || 0}</div><div class="lbl">Day streak</div></div>
      </div>
      <button class="big-btn" id="study-all" ${st.due + st.fresh === 0 ? "disabled" : ""}>
        Study now${st.due ? ` (${st.due} due)` : ""}
      </button>
      <h2 class="head">Sections</h2>`;
    for (const s of DATA.sections) {
      const ss = stats(s.id);
      const pct = ss.total ? Math.round((ss.known / ss.total) * 100) : 0;
      html += `
        <div class="section-row" data-section="${s.id}">
          <span class="section-dot" style="background:${s.color}"></span>
          <span style="flex:1">
            <span class="name">${esc(s.title)}</span>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          </span>
          <span class="counts">${ss.known}/${ss.total} known${ss.due ? `<br>${ss.due} due` : ""}</span>
        </div>`;
    }
    root.innerHTML = html;
    root.querySelector("#study-all").onclick = () => startSession(null);
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
      <input id="search-box" type="search" placeholder="Search concepts or keywords&hellip;" value="${esc(libSearch)}" />
      <div class="filter-row">
        ${["all", "unknown", "known", "due", "new"].map((f) =>
          `<button class="filter-chip ${libFilter === f ? "active" : ""}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
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
      const hay = `${c.title} ${c.slug} ${c.keywords.join(" ")}`.toLowerCase();
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
    return `
      <div class="concept-row" data-slug="${c.slug}">
        <div class="t">${esc(c.title)}${badge}</div>
        ${kws ? `<div class="kw-row">${kws}</div>` : ""}
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
    list.querySelectorAll(".concept-row").forEach((r) => {
      r.onclick = () => { detailStack.push(r.dataset.slug); render(); };
    });
  }

  // ----- detail -----
  function renderDetail(slug) {
    const c = bySlug[slug];
    if (!c) { detailStack.pop(); return render(); }
    const sec = sectionOf(c.section);
    setChrome(sec.title, "", true);
    const known = isKnown(slug);
    root.innerHTML = `
      <div class="detail-title">${esc(c.title)}
        ${known ? '<span class="badge known">Known</span>' : isUnknown(slug) ? '<span class="badge unknown">Unknown</span>' : ""}
      </div>
      ${c.keywords.length ? `<div class="kw-row">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>` : ""}
      <div class="panel qa-block">
        <div class="q">Q: ${esc(c.q)}</div>
        <div class="a">A: ${esc(c.a)}</div>
      </div>
      ${c.definition ? `<div class="detail-def">${esc(c.definition)}</div>` : ""}
      <button class="toggle-known-btn ${known ? "is-known" : ""}" id="toggle-known">
        ${known ? "&#10003; Marked as known — tap to unmark" : "Mark as known"}
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
      b.onclick = () => { detailStack.push(b.dataset.slug); render(); };
    });
    root.scrollTop = 0;
  }

  // ----- study -----
  function startSession(sectionId) {
    const queue = buildQueue(sectionId);
    session = { queue, idx: 0, flipped: false, hint: false, total: queue.length, sectionId, done: 0 };
    currentTab = "study";
    detailStack = [];
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === "study"));
    render();
  }

  function renderStudy() {
    if (!session || session.idx >= session.queue.length) return renderStudyEntryOrDone();
    const slug = session.queue[session.idx];
    const c = bySlug[slug];
    const sec = sectionOf(c.section);
    setChrome(session.sectionId ? sec.title : "Study", `streak ${store.streak.count || 0}`, false);

    if (!session.flipped) {
      root.innerHTML = `
        <div id="study-wrap">
          <div id="study-progress">${session.done + 1} / ${session.total}</div>
          <div class="flashcard" id="card">
            <div class="side-label" style="color:${sec.color}">Question &middot; ${esc(sec.title)}</div>
            <div class="q-text">${esc(c.q)}</div>
            ${session.hint
              ? `<div class="kw-row" style="margin-top:14px">${c.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>`
              : `<button class="hint-btn" id="hint-btn">Show keywords hint</button>`}
            <div class="tap-hint">Tap card to reveal answer</div>
          </div>
        </div>`;
      root.querySelector("#card").onclick = (e) => {
        if (e.target.id === "hint-btn") return;
        session.flipped = true;
        render();
      };
      const hb = root.querySelector("#hint-btn");
      if (hb) hb.onclick = () => { session.hint = true; render(); };
    } else {
      root.innerHTML = `
        <div id="study-wrap">
          <div id="study-progress">${session.done + 1} / ${session.total}</div>
          <div class="flashcard">
            <div class="side-label" style="color:${sec.color}">Answer</div>
            <div class="a-text">${esc(c.a)}</div>
            <div class="concept-name">${esc(c.title)}</div>
            ${c.keywords.length ? `<div class="kw-row" style="margin-top:10px">${c.keywords.slice(0, 5).map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>` : ""}
          </div>
          <div class="known-row">
            <button class="known-btn mark-unknown" id="btn-unknown">&#10007; Don't know it</button>
            <button class="known-btn mark-known" id="btn-known">&#10003; I know this</button>
          </div>
          <div class="grade-row">
            <button class="grade-btn grade-again" data-g="0">Again<small>now</small></button>
            <button class="grade-btn grade-hard" data-g="1">Hard<small>${previewInterval(slug, 1)}</small></button>
            <button class="grade-btn grade-good" data-g="2">Good<small>${previewInterval(slug, 2)}</small></button>
            <button class="grade-btn grade-easy" data-g="3">Easy<small>${previewInterval(slug, 3)}</small></button>
          </div>
        </div>`;
      root.querySelectorAll(".grade-btn").forEach((b) => {
        b.onclick = () => {
          const g = Number(b.dataset.g);
          grade(slug, g);
          if (g === 0) {
            // reinsert a few cards later in this session
            const pos = Math.min(session.queue.length, session.idx + 4);
            session.queue.splice(pos, 0, slug);
            session.total += 1;
          }
          advance();
        };
      });
      root.querySelector("#btn-known").onclick = () => { markKnown(slug); bumpStreak(); save(); advance(); };
      root.querySelector("#btn-unknown").onclick = () => {
        markUnknown(slug);
        bumpStreak();
        const pos = Math.min(session.queue.length, session.idx + 4);
        session.queue.splice(pos, 0, slug);
        session.total += 1;
        save();
        advance();
      };
    }
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
    render();
  }

  function renderStudyEntryOrDone() {
    const finished = session && session.idx >= session.queue.length && session.total > 0;
    const st = stats(null);
    setChrome("Study", "", false);
    if (finished) {
      root.innerHTML = `
        <div class="done-panel">
          <div class="emoji">&#127881;</div>
          <h3>Session complete</h3>
          <p>${session.done} cards reviewed. ${st.due} still due today.</p>
          <button class="big-btn" id="again-btn" ${st.due + st.fresh === 0 ? "disabled" : ""}>Study more</button>
          <button class="big-btn secondary" id="home-btn">Back to home</button>
        </div>`;
      root.querySelector("#again-btn").onclick = () => startSession(null);
      root.querySelector("#home-btn").onclick = () => switchTab("home");
      session = null;
      return;
    }
    let html = `
      <div class="panel">
        <strong>${st.due}</strong> cards due &middot; <strong>${st.fresh}</strong> new &middot; <strong>${st.known}</strong> known
      </div>
      <button class="big-btn" id="study-all" ${st.due + st.fresh === 0 ? "disabled" : ""}>Study all due + new</button>
      <h2 class="head">Study one section</h2>`;
    for (const s of DATA.sections) {
      const ss = stats(s.id);
      html += `
        <div class="section-row" data-section="${s.id}">
          <span class="section-dot" style="background:${s.color}"></span>
          <span class="name">${esc(s.title)}</span>
          <span class="counts">${ss.due} due &middot; ${ss.fresh} new</span>
        </div>`;
    }
    root.innerHTML = html;
    root.querySelector("#study-all").onclick = () => startSession(null);
    root.querySelectorAll(".section-row").forEach((el) => {
      el.onclick = () => startSession(el.dataset.section);
    });
  }

  // ---------- boot ----------
  backBtn.onclick = () => { detailStack.pop(); render(); };
  tabs.forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

  fetch("data/concepts.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      DATA = data;
      for (const c of data.concepts) bySlug[c.slug] = c;
      render();
    })
    .catch((err) => {
      root.innerHTML = `<div class="empty-note">Failed to load data (${esc(err.message)}).<br>This app must be served over HTTP, not opened as a file.</div>`;
    });
})();
