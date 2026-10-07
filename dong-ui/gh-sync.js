/**
 * dong-ui GitHub progress sync: one JSON file per app in a private repo.
 * The token lives in localStorage, shared by every app on this origin.
 *
 *   GhSync.save(appId, getPayload, applyPayload, { quiet }) -> Promise<message>
 *   GhSync.load(appId, applyPayload)                        -> Promise<message>
 *
 * quiet skips the confirm dialogs so an app can save on its own.
 * A quiet save still merges via applyPayload, sends the current sha,
 * and skips the PUT when the merged payload matches the remote file
 * (exportedAt is ignored). A 409 still rejects so the caller can retry once.
 */
(function (global) {
  "use strict";

  var CONFIG_KEY = "dong-gh-sync";
  var DEFAULT_REPO = "Dong-Xuyong/progress-sync";
  var API = "https://api.github.com/repos/";

  function getConfig() {
    var cfg = null;
    try {
      cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
    } catch (e) {}
    if (cfg && cfg.token) return cfg;
    var token = global.prompt(
      "Paste a GitHub fine-grained token with Contents read/write on " +
        DEFAULT_REPO +
        " only.\nIt is saved in this browser for all your apps."
    );
    if (!token || !token.trim()) throw new Error("No GitHub token, sync cancelled");
    cfg = { token: token.trim(), repo: DEFAULT_REPO };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fromBase64(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ""))));
  }

  function request(cfg, method, path, body) {
    return fetch(API + cfg.repo + "/contents/" + path, {
      method: method,
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + cfg.token,
        Accept: "application/vnd.github+json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      if (res.status === 401) {
        localStorage.removeItem(CONFIG_KEY);
        throw new Error("GitHub token rejected; you will be asked for a new one");
      }
      if (res.status === 404 && method === "GET") return null;
      if (res.status === 409) throw new Error("Saved from another device meanwhile; try again");
      if (!res.ok) throw new Error("GitHub error " + res.status);
      return res.json();
    });
  }

  function fetchRemote(cfg, appId) {
    return request(cfg, "GET", appId + ".json").then(function (file) {
      if (!file) return null;
      return { sha: file.sha, data: JSON.parse(fromBase64(file.content)) };
    });
  }

  function canonical(data) {
    function sortValue(value) {
      if (Array.isArray(value)) return value.map(sortValue);
      if (value && typeof value === "object") {
        var out = {};
        Object.keys(value).sort().forEach(function (key) {
          if (key === "exportedAt") return;
          out[key] = sortValue(value[key]);
        });
        return out;
      }
      return value;
    }
    return JSON.stringify(sortValue(data == null ? null : data));
  }

  function save(appId, getPayload, applyPayload, opts) {
    var cfg;
    var quiet = !!(opts && opts.quiet);
    if (
      !quiet &&
      (!global.confirm("Save " + appId + " progress to GitHub?") ||
        !global.confirm("Are you sure? This updates the copy your other devices load."))
    ) {
      return Promise.reject(new Error("Save cancelled"));
    }
    try {
      cfg = getConfig();
    } catch (e) {
      return Promise.reject(e);
    }
    return fetchRemote(cfg, appId).then(function (remote) {
      if (remote && applyPayload) applyPayload(remote.data);
      var payload = getPayload();
      if (remote && canonical(remote.data) === canonical(payload)) return "Already in sync";
      var body = {
        message: "Save " + appId + " progress",
        content: toBase64(JSON.stringify(payload)),
      };
      if (remote) body.sha = remote.sha;
      return request(cfg, "PUT", appId + ".json", body).then(function () {
        return "Saved to GitHub";
      });
    });
  }

  function load(appId, applyPayload) {
    var cfg;
    try {
      cfg = getConfig();
    } catch (e) {
      return Promise.reject(e);
    }
    return fetchRemote(cfg, appId).then(function (remote) {
      if (!remote) return "Nothing saved on GitHub yet";
      applyPayload(remote.data);
      return "Imported from GitHub";
    });
  }

  global.GhSync = { save: save, load: load };
})(typeof window !== "undefined" ? window : globalThis);
