/* AWS Cloud Practitioner tab. Reads and writes aws-study.json only. */
(function () {
  "use strict";

  var APP_ID = "aws-study";
  var SCHEMA_VERSION = 1;
  var OWNER = "rayleigh";
  var PASS_PERCENT = 70;
  var SAVE_DELAY = 2500;
  var DOMAIN_IDS = ["d1", "d2", "d3", "d4"];
  var ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

  var SEED = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    owner: OWNER,
    updatedAt: null,
    exam: {
      code: "CLF-C02",
      date: null,
      time: null,
      booked: false,
      passScore: 700,
      updatedAt: null,
    },
    domains: [
      { id: "d1", name: "Cloud Concepts", weight: 24 },
      { id: "d2", name: "Security and Compliance", weight: 30 },
      { id: "d3", name: "Cloud Technology and Services", weight: 34 },
      { id: "d4", name: "Billing, Pricing, and Support", weight: 12 },
    ],
    topics: [],
    practiceTests: [],
  };

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function instant(value) {
    if (value == null || value === "") return NaN;
    var t = Date.parse(value);
    return typeof t === "number" ? t : NaN;
  }

  function pickNewer(local, remote) {
    var lt = instant(local && local.updatedAt);
    var rt = instant(remote && remote.updatedAt);
    var lOk = Number.isFinite(lt);
    var rOk = Number.isFinite(rt);
    if (lOk && rOk) return rt > lt ? "remote" : "local";
    if (rOk && !lOk) return "remote";
    return "local";
  }

  function versionOf(doc) {
    var n = Number(doc && doc.schemaVersion);
    return Number.isFinite(n) ? n : 0;
  }

  function isDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function isTime(value) {
    return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
  }

  function normalizeExam(raw) {
    var exam = Object.assign(
      {
        code: "CLF-C02",
        date: null,
        time: null,
        booked: false,
        passScore: 700,
        updatedAt: null,
      },
      raw && typeof raw === "object" ? clone(raw) : {}
    );
    exam.code = "CLF-C02";
    exam.booked = !!exam.booked;
    var pass = Number(exam.passScore);
    exam.passScore = Number.isFinite(pass) ? Math.round(pass) : 700;
    exam.date = isDate(exam.date) ? exam.date : null;
    exam.time = isTime(exam.time) ? exam.time : null;
    return exam;
  }

  function normalizeTopic(raw) {
    if (!raw || typeof raw !== "object" || raw.id == null || raw.id === "") return null;
    var topic = clone(raw);
    topic.id = String(topic.id);
    topic.domainId = DOMAIN_IDS.indexOf(topic.domainId) === -1 ? "d1" : topic.domainId;
    topic.title = topic.title == null ? "" : String(topic.title);
    if (topic.confidence == null || topic.confidence === "") topic.confidence = null;
    else {
      var n = Math.round(Number(topic.confidence));
      topic.confidence = Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : null;
    }
    if ("lastReviewed" in topic) topic.lastReviewed = isDate(topic.lastReviewed) ? topic.lastReviewed : null;
    topic.notes = topic.notes == null ? "" : String(topic.notes);
    var links = Array.isArray(topic.links) ? topic.links : [];
    topic.links = links
      .filter(function (link) { return link && typeof link === "object"; })
      .map(function (link) {
        var next = clone(link);
        next.label = link.label == null ? "" : String(link.label);
        next.url = link.url == null ? "" : String(link.url);
        return next;
      });
    if ("deleted" in raw) topic.deleted = !!raw.deleted;
    return topic;
  }

  function normalizeTest(raw) {
    if (!raw || typeof raw !== "object" || raw.id == null || raw.id === "") return null;
    var test = clone(raw);
    test.id = String(test.id);
    test.date = isDate(test.date) ? test.date : (test.date == null ? null : String(test.date));
    test.source = test.source == null ? null : String(test.source);
    var correct = Number(test.correct);
    var total = Number(test.total);
    test.correct = Number.isFinite(correct) ? Math.max(0, Math.round(correct)) : 0;
    test.total = Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
    test.notes = test.notes == null ? "" : String(test.notes);
    if (test.byDomain && typeof test.byDomain === "object" && !Array.isArray(test.byDomain)) {
      var byDomain = {};
      Object.keys(test.byDomain).forEach(function (key) {
        var value = test.byDomain[key];
        if (value && typeof value === "object") byDomain[key] = clone(value);
      });
      test.byDomain = byDomain;
    }
    if ("deleted" in raw) test.deleted = !!raw.deleted;
    return test;
  }

  function defaultDomain(id) {
    var found = SEED.domains.filter(function (domain) { return domain.id === id; })[0];
    return clone(found || { id: id, name: id, weight: 0 });
  }

  function normalizeDomains(list) {
    var incoming = Array.isArray(list) ? list : [];
    var byId = {};
    DOMAIN_IDS.forEach(function (id) { byId[id] = defaultDomain(id); });
    var extras = [];
    incoming.forEach(function (domain) {
      if (!domain || domain.id == null) return;
      var id = String(domain.id);
      if (byId[id]) byId[id] = Object.assign(byId[id], clone(domain), { id: id });
      else extras.push(Object.assign(clone(domain), { id: id }));
    });
    return DOMAIN_IDS.map(function (id) { return byId[id]; }).concat(extras);
  }

  function normalize(doc) {
    var src = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
    var out = clone(src);
    out.app = APP_ID;
    out.owner = src.owner ? String(src.owner) : OWNER;
    out.schemaVersion = Number.isFinite(Number(src.schemaVersion)) ? Number(src.schemaVersion) : SCHEMA_VERSION;
    if (!("updatedAt" in src)) out.updatedAt = null;
    out.exam = normalizeExam(src.exam);
    out.domains = normalizeDomains(src.domains);
    out.topics = (Array.isArray(src.topics) ? src.topics : []).map(normalizeTopic).filter(Boolean);
    out.practiceTests = (Array.isArray(src.practiceTests) ? src.practiceTests : []).map(normalizeTest).filter(Boolean);
    return out;
  }

  function mergeRecord(local, remote) {
    if (!local) return remote ? clone(remote) : null;
    if (!remote) return clone(local);
    var remoteWins = pickNewer(local, remote) === "remote";
    var primary = remoteWins ? remote : local;
    var secondary = remoteWins ? local : remote;
    return Object.assign(clone(secondary), clone(primary));
  }

  function mergeArray(localArr, remoteArr) {
    var out = [];
    var index = new Map();
    function add(item) {
      if (!item || typeof item !== "object") return;
      if (item.id == null || item.id === "") {
        out.push(clone(item));
        return;
      }
      var id = String(item.id);
      if (!index.has(id)) {
        index.set(id, out.length);
        out.push(clone(item));
        return;
      }
      var at = index.get(id);
      out[at] = mergeRecord(out[at], item);
    }
    (Array.isArray(localArr) ? localArr : []).forEach(add);
    (Array.isArray(remoteArr) ? remoteArr : []).forEach(add);
    return out;
  }

  function mergeDomains(localDomains, remoteDomains, remoteWins) {
    var ids = [];
    var localMap = new Map();
    var remoteMap = new Map();
    (localDomains || []).forEach(function (domain) {
      if (!domain || domain.id == null || localMap.has(domain.id)) return;
      localMap.set(domain.id, domain);
      ids.push(domain.id);
    });
    (remoteDomains || []).forEach(function (domain) {
      if (!domain || domain.id == null) return;
      if (!remoteMap.has(domain.id)) remoteMap.set(domain.id, domain);
      if (!localMap.has(domain.id)) ids.push(domain.id);
    });
    var ordered = DOMAIN_IDS.filter(function (id) { return ids.indexOf(id) !== -1; })
      .concat(ids.filter(function (id) { return DOMAIN_IDS.indexOf(id) === -1; }));
    return ordered.map(function (id) {
      var local = localMap.get(id);
      var remote = remoteMap.get(id);
      if (!local) return clone(remote);
      if (!remote) return clone(local);
      var primary = remoteWins ? remote : local;
      var secondary = remoteWins ? local : remote;
      return Object.assign(clone(secondary), clone(primary), { id: id });
    });
  }

  function merge(local, remote) {
    var left = normalize(local);
    var right = normalize(remote);
    var remoteWins = pickNewer(left, right) === "remote";
    var primary = remoteWins ? right : left;
    var secondary = remoteWins ? left : right;
    var out = Object.assign(clone(secondary), clone(primary));
    out.app = APP_ID;
    out.owner = OWNER;
    out.schemaVersion = Math.max(versionOf(left), versionOf(right));
    out.updatedAt = primary.updatedAt == null ? (secondary.updatedAt == null ? null : secondary.updatedAt) : primary.updatedAt;
    out.exam = mergeRecord(left.exam, right.exam);
    out.domains = mergeDomains(left.domains, right.domains, remoteWins);
    out.topics = mergeArray(left.topics, right.topics);
    out.practiceTests = mergeArray(left.practiceTests, right.practiceTests);
    return out;
  }

  function newId(prefix, taken) {
    var used = Array.isArray(taken) ? taken : [];
    var id = "";
    var guard = 0;
    do {
      id = String(prefix || "id") + "_";
      for (var i = 0; i < 6; i++) id += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
      guard += 1;
    } while (used.indexOf(id) !== -1 && guard < 50);
    return id;
  }

  function liveTopics(doc, domainId) {
    return (doc && doc.topics || []).filter(function (topic) {
      return topic && !topic.deleted && (!domainId || topic.domainId === domainId);
    });
  }

  function confidenceValue(topic) {
    if (!topic || topic.confidence == null || topic.confidence === "") return 1;
    var n = Number(topic.confidence);
    if (!Number.isFinite(n)) return 1;
    return Math.min(5, Math.max(1, n));
  }

  function domainConfidence(doc, domainId) {
    var topics = liveTopics(normalize(doc), domainId);
    if (!topics.length) return null;
    var sum = topics.reduce(function (total, topic) { return total + confidenceValue(topic); }, 0);
    return sum / topics.length;
  }

  function readiness(doc) {
    var normalized = normalize(doc);
    var weightSum = 0;
    var weighted = 0;
    (normalized.domains || []).forEach(function (domain) {
      if (!domain || domain.deleted) return;
      var weight = Number(domain.weight) || 0;
      if (weight <= 0) return;
      var confidence = domainConfidence(normalized, domain.id);
      var value = confidence == null ? 1 : confidence;
      weightSum += weight;
      weighted += value * weight;
    });
    if (weightSum <= 0) return 0;
    var mean = weighted / weightSum;
    return ((mean - 1) / 4) * 100;
  }

  function scorePct(test) {
    if (!test || test.deleted) return null;
    var total = Number(test.total);
    var correct = Number(test.correct);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(correct)) return null;
    return (correct / total) * 100;
  }

  function lisbonDate(now) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Lisbon",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now || new Date());
    } catch (e) {
      var date = now || new Date();
      var y = date.getUTCFullYear();
      var m = String(date.getUTCMonth() + 1).padStart(2, "0");
      var d = String(date.getUTCDate()).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }
  }

  function daysLeft(date, today) {
    if (!isDate(date)) return null;
    var base = isDate(today) ? today : lisbonDate(new Date());
    var examMs = Date.parse(date + "T00:00:00Z");
    var todayMs = Date.parse(base + "T00:00:00Z");
    if (!Number.isFinite(examMs) || !Number.isFinite(todayMs)) return null;
    return Math.round((examMs - todayMs) / 86400000);
  }

  var core = {
    normalize: normalize,
    merge: merge,
    newId: newId,
    readiness: readiness,
    domainConfidence: domainConfidence,
    scorePct: scorePct,
    daysLeft: daysLeft,
  };

  function saveWithRetry(sync, getDoc, onRemote) {
    var retried = false;
    function run() {
      return sync.save(APP_ID, getDoc, onRemote, { quiet: true });
    }
    return run().catch(function (err) {
      if (!retried && /another device/.test(String(err && err.message))) {
        retried = true;
        return run();
      }
      if (retried && err && typeof err === "object") err.retried = true;
      return Promise.reject(err);
    });
  }

  var doc = null;
  var mode = "unset";
  var readOnly = false;
  var statusText = "";
  var saveTimer = null;
  var saving = false;
  var loading = false;
  var saveAgain = false;
  var mounted = null;
  var booted = false;
  var ui = { open: { d1: true }, addingDomain: "", editingId: "", showScore: false, formError: "" };

  function hasToken() {
    try {
      if (typeof localStorage === "undefined") return false;
      var cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
      return !!(cfg && cfg.token);
    } catch (e) {
      return false;
    }
  }

  function demoDoc() {
    var sample = normalize(SEED);
    sample.updatedAt = "2026-01-15T00:00:00.000Z";
    var rows = [
      ["d1", "tp_exd1a1", "EXAMPLE Cloud benefits", 4, "2026-10-02", "Scale and pay for what you use.", "https://example.com/cloud-benefits"],
      ["d1", "tp_exd1a2", "EXAMPLE Shared responsibility", null, null, "", ""],
      ["d2", "tp_exd2a1", "EXAMPLE IAM users and roles", 2, "2026-09-12", "", ""],
      ["d2", "tp_exd2a2", "EXAMPLE Detective controls", null, "2026-08-01", "", ""],
      ["d3", "tp_exd3a1", "EXAMPLE EC2 and Lambda", 3, "2026-10-11", "", ""],
      ["d3", "tp_exd3a2", "EXAMPLE S3 storage classes", 5, "2026-10-14", "", ""],
      ["d4", "tp_exd4a1", "EXAMPLE Pricing models", 1, "2026-07-01", "", ""],
      ["d4", "tp_exd4a2", "EXAMPLE Support plans", 2, "2026-10-05", "", ""],
    ];
    sample.topics = rows.map(function (row) {
      var topic = {
        id: row[1],
        domainId: row[0],
        title: row[2],
        confidence: row[3],
        lastReviewed: row[4],
        notes: row[5],
        links: [],
        updatedAt: "2026-01-15T00:00:00.000Z",
      };
      if (row[6]) topic.links = [{ label: "EXAMPLE overview", url: row[6] }];
      return topic;
    });
    sample.practiceTests = [
      { id: "pt_examp1", date: "2026-09-01", source: "EXAMPLE Practice A", correct: 40, total: 65, notes: "", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "pt_examp2", date: "2026-09-20", source: "EXAMPLE Practice B", correct: 48, total: 65, notes: "", updatedAt: "2026-09-20T00:00:00.000Z" },
      { id: "pt_examp3", date: "2026-10-12", source: "EXAMPLE Practice C", correct: 52, total: 65, notes: "", updatedAt: "2026-10-12T00:00:00.000Z" },
    ];
    return sample;
  }

  function ensureDoc() {
    if (!hasToken()) {
      if (mode !== "demo" || !doc) {
        mode = "demo";
        doc = demoDoc();
        readOnly = false;
      }
      return doc;
    }
    if (mode !== "live" || !doc) {
      mode = "live";
      doc = normalize(SEED);
      readOnly = false;
    }
    return doc;
  }

  function updateStatus(text) {
    statusText = text || "";
    if (typeof document === "undefined") return;
    var el = document.getElementById("aws-sync-status");
    if (el) el.textContent = statusText;
  }

  function viewingAws() {
    return typeof location !== "undefined" && /^#\/aws(?:$|[/?#])/.test(location.hash || "");
  }

  function fieldFocused() {
    if (typeof document === "undefined") return false;
    var el = document.activeElement;
    if (!el || el === document.body) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
  }

  function renderMounted() {
    if (!mounted || (mounted.isConnected === false)) return;
    if (fieldFocused()) return;
    render(mounted);
  }

  function applyRemote(remote) {
    if (!remote || typeof remote !== "object") return;
    ensureDoc();
    doc = merge(doc, remote);
    readOnly = Number(remote.schemaVersion) > SCHEMA_VERSION;
  }

  function scheduleSave() {
    if (mode !== "live" || readOnly || !hasToken()) return;
    if (typeof window === "undefined" || !window.GhSync) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushNow, SAVE_DELAY);
  }

  function pushNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (mode !== "live" || readOnly || !hasToken() || typeof window === "undefined" || !window.GhSync) {
      return Promise.resolve();
    }
    if (saving || loading) {
      saveAgain = true;
      return Promise.resolve();
    }
    saving = true;
    updateStatus("Syncing…");
    return saveWithRetry(window.GhSync, function () { return doc; }, applyRemote).then(function () {
      saving = false;
      updateStatus("Synced " + hhmm());
      renderMounted();
      if (saveAgain) {
        saveAgain = false;
        return pushNow();
      }
    }, function (err) {
      saving = false;
      saveAgain = false;
      if (err && err.retried) updateStatus("⚠️ Not saved, reload");
      else updateStatus(err && err.message ? err.message : "⚠️ Not saved, reload");
    });
  }

  function autoLoad() {
    if (!hasToken()) {
      if (mode === "live") {
        mode = "demo";
        doc = demoDoc();
        readOnly = false;
        updateStatus("");
        if (viewingAws()) renderMounted();
      }
      return Promise.resolve();
    }
    if (mode !== "live" || !doc) {
      mode = "live";
      doc = normalize(SEED);
      readOnly = false;
    }
    if (typeof window === "undefined" || !window.GhSync) return Promise.resolve();
    if (saving || saveTimer || loading || fieldFocused()) return Promise.resolve();
    loading = true;
    updateStatus("Syncing…");
    var before = JSON.stringify(doc);
    var run;
    try {
      run = window.GhSync.load(APP_ID, applyRemote);
    } catch (e) {
      loading = false;
      updateStatus(e && e.message ? e.message : "Sync failed");
      return Promise.resolve();
    }
    return run.then(function (msg) {
      loading = false;
      updateStatus(msg === "Nothing saved on GitHub yet" ? "Not saved yet" : "Synced " + hhmm());
      if (JSON.stringify(doc) !== before && viewingAws()) renderMounted();
      if (saveAgain) {
        saveAgain = false;
        return pushNow();
      }
    }, function (err) {
      loading = false;
      updateStatus(err && err.message ? err.message : "Sync failed");
    });
  }

  function hhmm() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  function onVisibility() {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      if (saveTimer) pushNow();
      return;
    }
    autoLoad();
  }

  function boot() {
    if (booted || typeof document === "undefined") return;
    booted = true;
    document.addEventListener("visibilitychange", onVisibility);
    setInterval(autoLoad, 60000);
    autoLoad();
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function safeUrl(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    try {
      var parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch (e) {
      return "";
    }
  }

  function takenIds() {
    var ids = [];
    (doc.topics || []).forEach(function (topic) { if (topic && topic.id) ids.push(topic.id); });
    (doc.practiceTests || []).forEach(function (test) { if (test && test.id) ids.push(test.id); });
    return ids;
  }

  function stamp(record) {
    var now = new Date().toISOString();
    if (record) record.updatedAt = now;
    doc.updatedAt = now;
    return now;
  }

  function domainById(id) {
    return (doc.domains || []).filter(function (domain) { return domain.id === id; })[0] || { id: id, name: id, weight: 0 };
  }

  function countdown(date) {
    var left = daysLeft(date, lisbonDate(new Date()));
    if (left == null) return "Date not set";
    if (left === 0) return "today";
    if (left === 1) return "in 1 day";
    if (left > 1) return "in " + left + " days";
    if (left === -1) return "1 day ago";
    return Math.abs(left) + " days ago";
  }

  function liveTests() {
    return (doc.practiceTests || []).filter(function (test) { return test && !test.deleted; });
  }

  function newestTests() {
    return liveTests().slice().sort(function (a, b) {
      var ad = String(a.date || "");
      var bd = String(b.date || "");
      if (ad !== bd) return ad < bd ? 1 : -1;
      return (instant(b.updatedAt) || 0) - (instant(a.updatedAt) || 0);
    });
  }

  function weakestTopics() {
    return liveTopics(doc).slice().sort(function (a, b) {
      var aUnrated = a.confidence == null ? 0 : 1;
      var bUnrated = b.confidence == null ? 0 : 1;
      if (aUnrated !== bUnrated) return aUnrated - bUnrated;
      var aConf = aUnrated ? Number(a.confidence) : 0;
      var bConf = bUnrated ? Number(b.confidence) : 0;
      if (aConf !== bConf) return aConf - bConf;
      var aDate = isDate(a.lastReviewed) ? a.lastReviewed : "0000-00-00";
      var bDate = isDate(b.lastReviewed) ? b.lastReviewed : "0000-00-00";
      if (aDate !== bDate) return aDate < bDate ? -1 : 1;
      return String(a.title).localeCompare(String(b.title));
    }).slice(0, 5);
  }

  function chartSvg(tests) {
    var points = tests.filter(function (test) { return scorePct(test) != null; }).slice().sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
    if (!points.length) return "";
    var w = 320;
    var h = 96;
    var padX = 12;
    var padY = 14;
    var innerW = w - padX * 2;
    var innerH = h - padY * 2;
    function rx(n) { return Math.round(n * 10) / 10; }
    var coords = points.map(function (test, i) {
      var pct = Math.max(0, Math.min(100, scorePct(test)));
      var x = points.length === 1 ? w / 2 : padX + (innerW * i) / (points.length - 1);
      var y = padY + innerH * (1 - pct / 100);
      return { x: rx(x), y: rx(y) };
    });
    var y70 = rx(padY + innerH * (1 - PASS_PERCENT / 100));
    var line = coords.map(function (point) { return point.x + "," + point.y; }).join(" ");
    return '<svg class="aws-chart" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Practice scores over time">' +
      '<line x1="' + padX + '" y1="' + y70 + '" x2="' + (w - padX) + '" y2="' + y70 + '" class="aws-chart-ref"></line>' +
      '<text x="' + padX + '" y="' + Math.max(10, y70 - 3) + '" class="aws-chart-label">70%</text>' +
      '<polyline points="' + line + '" class="aws-chart-line"></polyline>' +
      coords.map(function (point) {
        return '<circle cx="' + point.x + '" cy="' + point.y + '" r="3.5" class="aws-chart-dot"></circle>';
      }).join("") +
      "</svg>";
  }

  function linksHtml(links) {
    if (!links || !links.length) return "";
    return '<div class="aws-links">' + links.map(function (link) {
      var label = link.label || link.url || "Link";
      var href = safeUrl(link.url);
      if (!href) return '<span class="aws-link-text">' + esc(label) + "</span>";
      return '<a class="aws-link" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
    }).join("") + "</div>";
  }

  function topicHtml(topic) {
    var pressed = function (n) { return String(topic.confidence) === String(n); };
    var buttons = [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" class="aws-seg-btn" data-action="confidence" data-id="' + esc(topic.id) +
        '" data-value="' + n + '" aria-pressed="' + (pressed(n) ? "true" : "false") + '"' +
        (readOnly ? " disabled" : "") + ">" + n + "</button>";
    }).join("");
    var editing = ui.editingId === topic.id;
    var form = "";
    if (editing && !readOnly) {
      var linkLabel = "";
      var linkUrl = "";
      form = '<form class="aws-form" data-form="edit-topic" data-id="' + esc(topic.id) + '">' +
        field("Title", '<input name="title" required maxlength="160" value="' + esc(topic.title) + '">') +
        field("Notes", '<textarea name="notes" rows="3">' + esc(topic.notes || "") + "</textarea>") +
        '<div class="aws-existing-links">' + (topic.links || []).map(function (link, index) {
          return '<div class="aws-link-row"><span>' + esc(link.label || link.url || "Link") + "</span>" +
            '<button type="button" class="aws-btn" data-action="remove-link" data-id="' + esc(topic.id) +
            '" data-index="' + index + '">Remove</button></div>';
        }).join("") + "</div>" +
        field("Link label", '<input name="linkLabel" maxlength="80" value="' + esc(linkLabel) + '">') +
        field("Link URL", '<input name="linkUrl" type="url" inputmode="url" placeholder="https://" value="' + esc(linkUrl) + '">') +
        '<div class="aws-actions">' +
          '<button type="submit" class="aws-btn primary">Save topic</button>' +
          '<button type="button" class="aws-btn" data-action="cancel">Cancel</button>' +
          '<button type="button" class="aws-btn danger" data-action="delete-topic" data-id="' + esc(topic.id) + '">Delete</button>' +
        "</div></form>";
    }
    return '<article class="aws-topic">' +
      '<div class="aws-topic-main">' +
        '<h3>' + esc(topic.title || "Untitled topic") + "</h3>" +
        (readOnly || editing ? "" : '<button type="button" class="aws-btn" data-action="edit-topic" data-id="' + esc(topic.id) + '">Edit</button>') +
      "</div>" +
      '<div class="aws-seg" role="group" aria-label="Confidence for ' + esc(topic.title || "topic") + '">' + buttons + "</div>" +
      (topic.notes ? '<p class="aws-notes">' + esc(topic.notes) + "</p>" : "") +
      linksHtml(topic.links) +
      (topic.lastReviewed ? '<p class="aws-reviewed">Reviewed ' + esc(topic.lastReviewed) + "</p>" : "") +
      form +
      "</article>";
  }

  function field(label, control) {
    return '<label class="aws-field"><span>' + esc(label) + "</span>" + control + "</label>";
  }

  function addTopicForm(domainId) {
    if (ui.addingDomain !== domainId || readOnly) return "";
    return '<form class="aws-form" data-form="add-topic" data-domain="' + esc(domainId) + '">' +
      field("Title", '<input name="title" required maxlength="160" placeholder="Topic title">') +
      field("Notes", '<textarea name="notes" rows="2" placeholder="Notes"></textarea>') +
      field("Link label", '<input name="linkLabel" maxlength="80">') +
      field("Link URL", '<input name="linkUrl" type="url" inputmode="url" placeholder="https://">') +
      '<div class="aws-actions">' +
        '<button type="submit" class="aws-btn primary">Add topic</button>' +
        '<button type="button" class="aws-btn" data-action="cancel">Cancel</button>' +
      "</div></form>";
  }

  function domainsHtml() {
    return (doc.domains || []).filter(function (domain) { return DOMAIN_IDS.indexOf(domain.id) !== -1; }).map(function (domain) {
      var open = !!ui.open[domain.id];
      var topics = liveTopics(doc, domain.id);
      var confidence = domainConfidence(doc, domain.id);
      var avg = confidence == null ? "no topics" : "avg " + (Math.round(confidence * 10) / 10);
      return '<section class="aws-domain">' +
        '<button type="button" class="aws-domain-head" data-action="toggle-domain" data-domain="' + esc(domain.id) +
          '" aria-expanded="' + (open ? "true" : "false") + '">' +
          '<span>' + esc(domain.name) + "</span>" +
          '<span class="aws-domain-meta">' + esc(String(domain.weight)) + "% · " + esc(avg) + "</span>" +
        "</button>" +
        '<div class="aws-domain-body"' + (open ? "" : " hidden") + ">" +
          (topics.length ? topics.map(topicHtml).join("") : '<p class="aws-empty">No topics yet.</p>') +
          (readOnly ? "" : '<button type="button" class="aws-btn" data-action="show-add-topic" data-domain="' + esc(domain.id) + '">+ Topic</button>') +
          addTopicForm(domain.id) +
        "</div></section>";
    }).join("");
  }

  function scoreForm() {
    if (!ui.showScore || readOnly) return "";
    var today = lisbonDate(new Date());
    var domainFields = DOMAIN_IDS.map(function (id) {
      var name = domainById(id).name;
      return '<div class="aws-pair"><span>' + esc(name) + "</span>" +
        '<input name="' + id + 'c" type="number" min="0" inputmode="numeric" aria-label="' + esc(name) + ' correct">' +
        '<input name="' + id + 't" type="number" min="1" inputmode="numeric" aria-label="' + esc(name) + ' total">' +
        "</div>";
    }).join("");
    return '<form class="aws-form" data-form="add-score">' +
      field("Date", '<input name="date" type="date" required value="' + esc(today) + '">') +
      field("Source", '<input name="source" maxlength="120" placeholder="Source">') +
      field("Correct", '<input name="correct" type="number" required min="0" inputmode="numeric">') +
      field("Total", '<input name="total" type="number" required min="1" inputmode="numeric">') +
      '<details class="aws-details"><summary>Per domain (optional)</summary>' + domainFields + "</details>" +
      '<div class="aws-actions">' +
        '<button type="submit" class="aws-btn primary">Add score</button>' +
        '<button type="button" class="aws-btn" data-action="cancel">Cancel</button>' +
      "</div></form>";
  }

  function scoresHtml() {
    var tests = newestTests();
    if (!tests.length) return '<p class="aws-empty">No practice scores yet.</p>';
    return '<ul class="aws-scores">' + tests.map(function (test) {
      var pct = scorePct(test);
      var rounded = pct == null ? "—" : Math.round(pct) + "%";
      var pass = pct != null && pct >= PASS_PERCENT;
      var byDomain = "";
      if (test.byDomain && typeof test.byDomain === "object") {
        var bits = DOMAIN_IDS.filter(function (id) { return test.byDomain[id]; }).map(function (id) {
          var part = test.byDomain[id];
          return id + " " + part.correct + "/" + part.total;
        });
        if (bits.length) byDomain = '<span class="aws-by-domain">' + esc(bits.join(" · ")) + "</span>";
      }
      return '<li class="aws-score">' +
        '<span>' + esc(test.date || "No date") + "</span>" +
        '<span class="aws-source">' + esc(test.source || "Source not set") + "</span>" +
        '<span>' + esc(String(test.correct)) + "/" + esc(String(test.total)) + "</span>" +
        '<strong class="' + (pass ? "aws-pass" : "aws-miss") + '">' + esc(rounded) + "</strong>" +
        byDomain +
        "</li>";
    }).join("") + "</ul>";
  }

  function weakestHtml() {
    var topics = weakestTopics();
    if (!topics.length) return '<p class="aws-empty">Rate a topic to see the weakest ones.</p>';
    return '<ol class="aws-weak">' + topics.map(function (topic) {
      var confidence = topic.confidence == null ? "Unrated" : String(topic.confidence) + "/5";
      var reviewed = topic.lastReviewed ? topic.lastReviewed : "not reviewed";
      return "<li><span>" + esc(topic.title || "Untitled topic") + "</span>" +
        '<span class="aws-domain-meta">' + esc(domainById(topic.domainId).name) + " · " + esc(confidence) + " · " + esc(reviewed) + "</span></li>";
    }).join("") + "</ol>";
  }

  function examHtml() {
    var exam = doc.exam || normalizeExam(null);
    var ready = Math.round(readiness(doc));
    var latest = newestTests()[0];
    var latestPct = latest ? scorePct(latest) : null;
    var latestText = latestPct == null
      ? "No practice score yet"
      : "Latest " + Math.round(latestPct) + "% · " + latest.correct + "/" + latest.total + " · pass at " + PASS_PERCENT + "%";
    var when = exam.date ? exam.date + " · " + countdown(exam.date) : countdown(null);
    if (exam.time) when += " · " + exam.time + " Lisbon";
    var editor = "";
    if (!readOnly) {
      editor = '<form class="aws-form" data-form="exam">' +
        field("Exam date", '<input name="date" type="date" value="' + esc(exam.date || "") + '">') +
        field("Time (Lisbon)", '<input name="time" type="time" value="' + esc(exam.time || "") + '">') +
        '<label class="aws-check"><input name="booked" type="checkbox"' + (exam.booked ? " checked" : "") + "> Booked</label>" +
        '<div class="aws-actions"><button type="submit" class="aws-btn primary">Save exam</button></div>' +
        "</form>";
    }
    return '<section class="aws-card" aria-labelledby="aws-exam-title">' +
      '<span class="eyebrow">Exam</span>' +
      '<h2 id="aws-exam-title">' + esc(exam.code || "CLF-C02") + "</h2>" +
      '<p class="aws-when">' + esc(when) + "</p>" +
      '<p><span class="aws-badge' + (exam.booked ? " on" : "") + '">' + (exam.booked ? "Booked" : "Not booked") + "</span></p>" +
      '<div class="aws-readiness"><div class="aws-meter-row"><span>Readiness</span><strong>' + ready + "%</strong></div>" +
        '<div class="aws-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + ready + '" aria-label="Readiness">' +
          '<span style="width:' + Math.max(0, Math.min(100, ready)) + '%"></span></div></div>' +
      '<p class="aws-latest' + (latestPct != null && latestPct >= PASS_PERCENT ? " aws-pass" : "") + '">' + esc(latestText) + "</p>" +
      editor +
      "</section>";
  }

  function pageHtml() {
    var banner = mode === "demo" ? '<p class="aws-banner">Demo data</p>' : "";
    var newer = readOnly ? '<p class="aws-banner aws-banner-warn">Newer data format, update the app</p>' : "";
    var error = ui.formError ? '<p class="aws-form-error">' + esc(ui.formError) + "</p>" : "";
    return '<div class="aws-study">' + banner + newer + error +
      '<p class="aws-status" id="aws-sync-status" role="status" aria-live="polite">' + esc(statusText) + "</p>" +
      examHtml() +
      '<section class="aws-card" aria-labelledby="aws-domains-title"><span class="eyebrow">CLF-C02</span><h2 id="aws-domains-title">Domains</h2>' +
        domainsHtml() + "</section>" +
      '<section class="aws-card" aria-labelledby="aws-scores-title"><span class="eyebrow">Scores</span><h2 id="aws-scores-title">Practice tests</h2>' +
        chartSvg(liveTests()) + scoresHtml() +
        (readOnly ? "" : '<button type="button" class="aws-btn" data-action="show-score">+ Add score</button>') +
        scoreForm() + "</section>" +
      '<section class="aws-card" aria-labelledby="aws-weak-title"><span class="eyebrow">Review next</span><h2 id="aws-weak-title">Weakest topics</h2>' +
        weakestHtml() + "</section></div>";
  }

  function setChrome() {
    if (typeof document === "undefined") return;
    var title = document.getElementById("topbar-title");
    var meta = document.getElementById("topbar-meta");
    var back = document.getElementById("back-btn");
    if (title) title.textContent = "AWS";
    if (meta) meta.textContent = "CLF-C02";
    if (back) back.classList.add("hidden");
  }

  function mutate(fn) {
    ensureDoc();
    if (mode === "live" && readOnly) return;
    fn(doc);
    ui.formError = "";
    if (mode === "live") scheduleSave();
    render(mounted);
  }

  function invalidLink(url) {
    var raw = String(url || "").trim();
    return raw && !safeUrl(raw);
  }

  function onSubmit(event) {
    var form = event.target;
    if (!form || !form.getAttribute || !form.getAttribute("data-form")) return;
    event.preventDefault();
    var kind = form.getAttribute("data-form");
    var data = new FormData(form);
    if (kind === "exam") {
      var date = String(data.get("date") || "");
      var time = String(data.get("time") || "");
      if (date && !isDate(date)) return;
      if (time && !isTime(time)) return;
      mutate(function (current) {
        current.exam.date = date || null;
        current.exam.time = time || null;
        current.exam.booked = data.get("booked") === "on";
        current.exam.code = "CLF-C02";
        stamp(current.exam);
      });
      return;
    }
    if (kind === "add-topic" || kind === "edit-topic") {
      var title = String(data.get("title") || "").trim();
      var notes = String(data.get("notes") || "").trim();
      var linkLabel = String(data.get("linkLabel") || "").trim();
      var linkUrl = String(data.get("linkUrl") || "").trim();
      if (!title) {
        ui.formError = "Title is required.";
        render(mounted);
        return;
      }
      if (invalidLink(linkUrl)) {
        ui.formError = "Link must be http or https.";
        render(mounted);
        return;
      }
      if (kind === "add-topic") {
        var domainId = form.getAttribute("data-domain");
        mutate(function (current) {
          var topic = {
            id: newId("tp", takenIds()),
            domainId: DOMAIN_IDS.indexOf(domainId) === -1 ? "d1" : domainId,
            title: title,
            confidence: null,
            lastReviewed: null,
            notes: notes,
            links: [],
          };
          if (linkUrl) topic.links.push({ label: linkLabel || linkUrl, url: safeUrl(linkUrl) });
          stamp(topic);
          current.topics.push(topic);
          ui.addingDomain = "";
        });
        return;
      }
      var topicId = form.getAttribute("data-id");
      mutate(function (current) {
        var topic = (current.topics || []).filter(function (item) { return item.id === topicId; })[0];
        if (!topic) return;
        topic.title = title;
        topic.notes = notes;
        if (linkUrl) {
          topic.links = topic.links || [];
          topic.links.push({ label: linkLabel || linkUrl, url: safeUrl(linkUrl) });
        }
        stamp(topic);
        ui.editingId = "";
      });
      return;
    }
    if (kind === "add-score") {
      var correct = Number(data.get("correct"));
      var total = Number(data.get("total"));
      var scoreDate = String(data.get("date") || "");
      var source = String(data.get("source") || "").trim();
      if (!isDate(scoreDate) || !Number.isFinite(correct) || !Number.isFinite(total) || total < 1 || correct < 0 || correct > total) {
        ui.formError = "Enter a date, correct, and a total greater than zero.";
        render(mounted);
        return;
      }
      var byDomain = {};
      var domainError = false;
      DOMAIN_IDS.forEach(function (id) {
        var cRaw = String(data.get(id + "c") || "").trim();
        var tRaw = String(data.get(id + "t") || "").trim();
        if (!cRaw && !tRaw) return;
        var c = Number(cRaw);
        var t = Number(tRaw);
        if (!Number.isFinite(c) || !Number.isFinite(t) || t < 1 || c < 0 || c > t) domainError = true;
        else byDomain[id] = { correct: Math.round(c), total: Math.round(t) };
      });
      if (domainError) {
        ui.formError = "Per-domain totals must be at least 1.";
        render(mounted);
        return;
      }
      mutate(function (current) {
        var test = {
          id: newId("pt", takenIds()),
          date: scoreDate,
          source: source || null,
          correct: Math.round(correct),
          total: Math.round(total),
          notes: "",
        };
        if (Object.keys(byDomain).length) test.byDomain = byDomain;
        stamp(test);
        current.practiceTests.push(test);
        ui.showScore = false;
      });
    }
  }

  function onClick(event) {
    var node = event.target;
    if (node && node.nodeType !== 1) node = node.parentElement;
    var button = node && node.closest ? node.closest("[data-action]") : null;
    if (!button || !event.currentTarget.contains(button)) return;
    var action = button.getAttribute("data-action");
    if (action === "toggle-domain") {
      var domainId = button.getAttribute("data-domain");
      ui.open[domainId] = !ui.open[domainId];
      render(mounted);
      return;
    }
    if (action === "show-add-topic") {
      var next = button.getAttribute("data-domain");
      ui.addingDomain = ui.addingDomain === next ? "" : next;
      ui.open[next] = true;
      ui.formError = "";
      render(mounted);
      return;
    }
    if (action === "show-score") {
      ui.showScore = !ui.showScore;
      ui.formError = "";
      render(mounted);
      return;
    }
    if (action === "cancel") {
      ui.addingDomain = "";
      ui.editingId = "";
      ui.showScore = false;
      ui.formError = "";
      render(mounted);
      return;
    }
    if (action === "edit-topic") {
      ui.editingId = button.getAttribute("data-id");
      ui.formError = "";
      render(mounted);
      return;
    }
    if (action === "confidence") {
      var id = button.getAttribute("data-id");
      var value = Number(button.getAttribute("data-value"));
      if (value < 1 || value > 5) return;
      mutate(function (current) {
        var topic = (current.topics || []).filter(function (item) { return item.id === id && !item.deleted; })[0];
        if (!topic) return;
        topic.confidence = value;
        topic.lastReviewed = lisbonDate(new Date());
        stamp(topic);
      });
      return;
    }
    if (action === "delete-topic") {
      var deleteId = button.getAttribute("data-id");
      mutate(function (current) {
        var topic = (current.topics || []).filter(function (item) { return item.id === deleteId; })[0];
        if (!topic) return;
        topic.deleted = true;
        stamp(topic);
        ui.editingId = "";
      });
      return;
    }
    if (action === "remove-link") {
      var linkId = button.getAttribute("data-id");
      var index = Number(button.getAttribute("data-index"));
      mutate(function (current) {
        var topic = (current.topics || []).filter(function (item) { return item.id === linkId; })[0];
        if (!topic || !topic.links || !topic.links[index]) return;
        topic.links.splice(index, 1);
        stamp(topic);
      });
    }
  }

  function render(rootEl) {
    if (!rootEl) return;
    mounted = rootEl;
    ensureDoc();
    setChrome();
    var keepScroll = !!rootEl.querySelector(".aws-study");
    var top = keepScroll ? rootEl.scrollTop : 0;
    rootEl.innerHTML = pageHtml();
    var page = rootEl.querySelector(".aws-study");
    if (page) {
      page.addEventListener("click", onClick);
      page.addEventListener("submit", onSubmit);
    }
    if (keepScroll) rootEl.scrollTop = top;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { render: render, core: core, saveWithRetry: saveWithRetry };
  }
  if (typeof window !== "undefined") {
    window.AwsStudy = { render: render, core: core };
    boot();
  }
})();
