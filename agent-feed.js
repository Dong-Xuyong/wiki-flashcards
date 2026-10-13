/**
 * Read-only view of wiki-flashcards-agent.json.
 * Entries are append-only and unioned by id. This file never writes the sidecar.
 * New concepts and Q&A become review cards only when they carry a question and
 * answer and the concept is not already in the deck. Everything else is listed.
 */
(function (global) {
  "use strict";

  var APP = "wiki-flashcards-agent";
  var KINDS = { new_concept: 1, updated_concept: 1, qa_added: 1, note: 1 };
  var CARD_KINDS = { new_concept: 1, qa_added: 1 };
  var AGENT_SECTION = { id: "from-agent", title: "Added by agent", color: "#c4a574" };
  var KIND_LABELS = {
    new_concept: "New concept",
    updated_concept: "Updated",
    qa_added: "Q&A",
    note: "Note",
  };

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function strList(value) {
    var i, out;
    if (Array.isArray(value)) {
      out = [];
      for (i = 0; i < value.length; i++) {
        if (value[i] == null) continue;
        var item = String(value[i]).trim();
        if (item) out.push(item);
      }
      return out;
    }
    if (typeof value === "string" && value.trim()) {
      return value.split(",").map(function (part) { return part.trim(); }).filter(Boolean);
    }
    return [];
  }

  function pair(entry) {
    var q = text(entry.q || entry.question);
    var a = text(entry.a || entry.answer);
    var qa, i, item, qq, aa;
    if (q && a) return { q: q, a: a };
    qa = Array.isArray(entry.qa) ? entry.qa : (Array.isArray(entry.cards) ? entry.cards : null);
    if (!qa) return null;
    for (i = 0; i < qa.length; i++) {
      item = qa[i];
      if (!item) continue;
      qq = text(item.q || item.question);
      aa = text(item.a || item.answer);
      if (qq && aa) return { q: qq, a: aa };
    }
    return null;
  }

  function safeLinks(links) {
    var out = [], i, link, url, label;
    if (!Array.isArray(links)) return out;
    for (i = 0; i < links.length; i++) {
      link = links[i];
      if (!link || typeof link.url !== "string") continue;
      url = link.url.trim();
      if (!/^https?:\/\//i.test(url)) continue;
      label = typeof link.label === "string" && link.label.trim() ? link.label.trim() : url;
      out.push({ label: label, url: url });
    }
    return out;
  }

  function sameConcept(entry, concept) {
    var slug = text(entry.conceptSlug || entry.slug);
    var cid = text(entry.conceptId);
    if (slug && (slug === concept.slug || slug === concept.id)) return true;
    if (cid && (cid === concept.slug || cid === concept.id)) return true;
    if (entry.id && (entry.id === concept.slug || entry.id === concept.id)) return true;
    return false;
  }

  function findConcept(entry, concepts) {
    var i;
    for (i = 0; i < concepts.length; i++) {
      if (sameConcept(entry, concepts[i])) return concepts[i];
    }
    return null;
  }

  function toConcept(entry, slug, title, qa, known) {
    var section = text(entry.section);
    return {
      slug: slug,
      title: title,
      e: text(entry.e || entry.emoji),
      x: text(entry.x || entry.example),
      q: qa.q,
      a: qa.a,
      definition: text(entry.definition),
      keywords: strList(entry.keywords),
      section: section && known.has(section) ? section : AGENT_SECTION.id,
      related: strList(entry.related),
      videos: strList(entry.videoSlugs != null ? entry.videoSlugs : entry.videos),
      sources: [],
      fromAgent: true,
    };
  }

  /** Append-only union. Returns the same array when the file adds nothing. */
  function unionEntries(prev, file) {
    var base = Array.isArray(prev) ? prev : [];
    var seen, i, entry, out;
    if (!file || typeof file !== "object" || file.app !== APP) return base;
    if (!Array.isArray(file.entries) || file.entries.length === 0) return base;
    seen = new Set();
    for (i = 0; i < base.length; i++) {
      if (base[i] && base[i].id) seen.add(base[i].id);
    }
    out = null;
    for (i = 0; i < file.entries.length; i++) {
      entry = file.entries[i];
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) continue;
      if (!out) out = base.slice();
      seen.add(entry.id);
      out.push(entry);
    }
    return out || base;
  }

  /**
   * Split unioned entries into review cards and list rows.
   * deckConcepts: existing cards ({slug, id?}).
   * knownSectionIds: section ids the deck already has.
   */
  function surface(deckConcepts, entries, knownSectionIds) {
    var deck = Array.isArray(deckConcepts) ? deckConcepts.slice() : [];
    var known = knownSectionIds instanceof Set ? knownSectionIds : new Set(knownSectionIds || []);
    var cards = [];
    var list = [];
    var rows = Array.isArray(entries) ? entries : [];
    var i, entry, kind, slug, title, qa, hit, concept;

    for (i = 0; i < rows.length; i++) {
      entry = rows[i];
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) continue;
      kind = text(entry.kind);
      if (!KINDS[kind]) continue;
      slug = text(entry.conceptSlug || entry.slug);
      title = text(entry.title);
      qa = pair(entry);
      hit = findConcept(entry, deck);
      if (CARD_KINDS[kind] && slug && title && qa && !hit) {
        concept = toConcept(entry, slug, title, qa, known);
        cards.push(concept);
        deck.push(concept);
        continue;
      }
      list.push({
        id: entry.id,
        kind: kind,
        title: title || slug || entry.id,
        note: typeof entry.note === "string" ? entry.note : "",
        conceptSlug: slug,
        q: qa ? qa.q : "",
        a: qa ? qa.a : "",
        links: safeLinks(entry.links),
        openSlug: hit ? hit.slug : "",
      });
    }
    return { cards: cards, list: list };
  }

  global.WikiAgent = {
    APP: APP,
    AGENT_SECTION: AGENT_SECTION,
    KIND_LABELS: KIND_LABELS,
    unionEntries: unionEntries,
    surface: surface,
  };
})(typeof window !== "undefined" ? window : globalThis);
