// One entry per video id. Used by the Insights tab (catalog.json) and the Flashcards tab
// (data/concepts.json) so a video added twice under two slugs shows once with all concepts.
(function (global) {
  "use strict";

  function uniq(list, keyOf) {
    const seen = new Set();
    const out = [];
    for (const item of list || []) {
      const key = keyOf ? keyOf(item) : JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function minStr(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a < b ? a : b;
  }

  function maxStr(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  // catalog.json videos: [{slug, video_id, concepts:[{slug}], ...}]. The first entry wins;
  // later duplicates fold their concepts, tags, keywords and key insights into it and are
  // remembered in aliasSlugs (their insight packs are loaded too).
  function collapseCatalogVideos(videos) {
    const out = [];
    const byId = new Map();
    for (const v of videos || []) {
      const id = v && v.video_id;
      const keep = id ? byId.get(id) : null;
      if (!keep) {
        const copy = { ...v };
        if (id) byId.set(id, copy);
        out.push(copy);
        continue;
      }
      keep.concepts = uniq([...(keep.concepts || []), ...(v.concepts || [])], (c) => c && c.slug);
      keep.conceptCount = keep.concepts.length;
      for (const k of ["tags", "keywords", "key_insights"]) {
        if (Array.isArray(keep[k]) || Array.isArray(v[k])) keep[k] = uniq([...(keep[k] || []), ...(v[k] || [])]);
      }
      keep.has_insights = !!(keep.has_insights || v.has_insights);
      keep.created = minStr(keep.created, v.created);
      keep.added = minStr(keep.added, v.added);
      keep.updated = maxStr(keep.updated, v.updated);
      keep.aliasSlugs = uniq([...(keep.aliasSlugs || []), v.slug]);
    }
    return out;
  }

  // data/concepts.json: {videos:{slug:{id,...}}, concepts:[{videos:[slug]}]}. Returns
  // {dropped: kept} and rewrites the doc in place.
  function collapseConceptVideos(doc) {
    const alias = {};
    if (!doc || !doc.videos) return alias;
    const byId = new Map();
    for (const slug of Object.keys(doc.videos)) {
      const id = doc.videos[slug] && doc.videos[slug].id;
      if (!id) continue;
      if (byId.has(id)) alias[slug] = byId.get(id);
      else byId.set(id, slug);
    }
    if (!Object.keys(alias).length) return alias;
    for (const c of doc.concepts || []) {
      if (c && Array.isArray(c.videos) && c.videos.some((s) => alias[s])) {
        c.videos = uniq(c.videos.map((s) => alias[s] || s), (s) => s);
      }
    }
    for (const slug of Object.keys(alias)) delete doc.videos[slug];
    for (const kept of new Set(Object.values(alias))) {
      doc.videos[kept].n = (doc.concepts || []).filter((c) => c && (c.videos || []).includes(kept)).length;
    }
    doc.videoAlias = alias;
    return alias;
  }

  global.VideoDedupe = { collapseCatalogVideos, collapseConceptVideos };
})(typeof window !== "undefined" ? window : globalThis);
