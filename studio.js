// Story Studio: where comics and films are produced from approved stories.
// The studio never receives raw recordings or stories the storyteller did not approve.
(function () {
  "use strict";
  const app = document.getElementById("app");
  let password = "";
  try { password = sessionStorage.getItem("studio-password") || ""; } catch (e) { /* blocked */ }
  let data = null;
  let error = "";
  let busy = "";

  // Append only real nodes (DOM append would print "null" for empty slots).
  function add() {
    Array.prototype.slice.call(arguments).flat(Infinity).forEach(function (n) { if (n) app.append(n); });
  }

  function h(tag, props) {
    const node = document.createElement(tag);
    const kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (k) {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    });
    kids.flat(Infinity).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

  async function api(method, body) {
    const res = await fetch("/api/studio", {
      method: method,
      headers: Object.assign({ authorization: "Bearer " + password }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const out = await res.json().catch(function () { return null; });
    if (!res.ok) {
      const err = new Error((out && out.error) || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return out;
  }

  async function load() {
    error = "";
    try {
      data = await api("GET");
    } catch (e) {
      data = null;
      error = e.status === 401 ? "Wrong password." : "Could not load: " + e.message;
      if (e.status === 401) { password = ""; try { sessionStorage.removeItem("studio-password"); } catch (_) { /* */ } }
    }
    render();
  }

  function render() {
    app.replaceChildren(h("div", { class: "topbar" }, h("span", { class: "brand", text: "Story Studio" }),
      password ? h("button", { class: "btn btn-quiet", type: "button", onclick: load }, "Refresh") : null));
    if (!password) return renderLogin();
    if (error) add(h("div", { class: "notice bad", role: "alert", text: error }));
    if (!data) return add(h("p", { class: "lead", text: "Loading…" }));
    add(h("h1", { text: "Storytellers" }),
      h("p", { class: "meta", text: "Stories and comic scripts appear here only after the storyteller taps “OK to use”. Recordings are never shown." }));
    if (!data.storytellers.length) add(h("p", { class: "lead", text: "No storytellers yet. Create a link on the home page." }));
    data.storytellers.forEach(function (t) { add(renderTeller(t)); });
  }

  function renderLogin() {
    const input = h("input", { type: "password", id: "pw", autocomplete: "current-password" });
    add(h("h1", { text: "Studio sign-in" }),
      h("form", { class: "card", onsubmit: function (e) {
        e.preventDefault();
        password = input.value;
        try { sessionStorage.setItem("studio-password", password); } catch (_) { /* */ }
        load();
      } }, h("label", { for: "pw" }, "Studio password (STUDIO_PASSWORD in Vercel)", input),
        h("button", { class: "btn btn-primary", type: "submit" }, "Open studio")),
      error ? h("div", { class: "notice bad", text: error }) : null);
  }

  function badge(text) { return h("span", { class: "badge " + text, text: text }); }

  function renderTeller(t) {
    const familyUrl = location.origin + "/family.html?f=" + t.familyToken;
    const ready = t.answers.filter(function (a) { return a.status === "ready"; }).length;
    const approved = t.answers.filter(function (a) { return a.approval === "approved"; }).length;
    return h("section", { class: "card" },
      h("div", { class: "toolbar" }, h("h2", { text: t.name }), badge(t.lang)),
      h("p", { class: "meta", text: "Asked by " + t.from + " · " + t.answers.length + " answers · " + ready + " written · " + approved + " approved" }),
      h("div", { class: "toolbar" }, h("a", { class: "btn btn-secondary", href: familyUrl, target: "_blank", rel: "noopener" }, "Family page")),
      lifeCard(t.lifeCard),
      t.answers.length ? h("div", null, t.answers.map(function (a) { return renderAnswer(t, a); })) : h("p", { class: "meta", text: "No answers yet." }),
      mediaBlock(t, null, t.media.filter(function (m) { return !m.answerId; }), "General media (not tied to one story)"));
  }

  function lifeCard(card) {
    const keys = ["people", "places", "times", "objects", "appearance", "phrases", "traits"];
    const filled = keys.filter(function (k) { return card && card[k] && card[k].length; });
    if (!filled.length) return null;
    return h("details", null, h("summary", null, "Life card (from approved stories)"),
      h("div", { class: "grid" }, filled.map(function (k) {
        return h("div", { class: "panel" }, h("b", { text: k }), h("ul", null, card[k].map(function (item) {
          return h("li", { text: typeof item === "string" ? item : Object.values(item).filter(Boolean).join(" — ") });
        })));
      })));
  }

  function renderAnswer(t, a) {
    const media = t.media.filter(function (m) { return m.answerId === a.id; });
    const head = h("div", { class: "toolbar" },
      h("h3", { text: "Q" + (a.questionIndex + 1) + ". " + (a.title || a.question) }),
      badge(a.status), badge(a.approval),
      a.durationSec ? h("span", { class: "meta", text: a.durationSec + "s" }) : null,
      (a.status === "failed" || a.status === "ready") ? h("button", { class: "btn btn-quiet", type: "button", disabled: busy === a.id, onclick: function () { retry(a); } }, a.status === "failed" ? "Retry" : "Rewrite") : null);
    const parts = [head];
    if (a.error) parts.push(h("p", { class: "meta", text: "Error: " + a.error }));
    if (a.approval !== "approved") {
      parts.push(h("p", { class: "meta", text: a.status === "ready" ? "Waiting for the storyteller's approval." : "Not written yet." }));
      return h("details", null, h("summary", null, head), parts.slice(1));
    }
    parts.push(h("details", null, h("summary", null, "Story"), h("p", { class: "story-text", text: a.story || "" })));
    if (a.comicScript) parts.push(comicScript(a));
    parts.push(mediaBlock(t, a, media, "Comic pages / film for this story"));
    return h("div", { class: "card", style: "margin-top:12px" }, parts);
  }

  function comicScript(a) {
    const c = a.comicScript;
    const brief = briefFor(a);
    return h("details", { open: true }, h("summary", null, "Comic script"),
      h("p", { class: "meta", text: c.style_notes || "" }),
      c.characters && c.characters.length ? h("div", { class: "grid" }, c.characters.map(function (ch) {
        return h("div", { class: "panel" }, h("b", { text: "Character" }), h("span", { text: ch.name }), h("span", { class: "meta", text: ch.look }));
      })) : null,
      h("div", { class: "grid", style: "margin-top:12px" }, (c.panels || []).map(function (p, i) {
        const clip = p.voice_clip ? "Voice clip " + p.voice_clip.start.toFixed(1) + "–" + p.voice_clip.end.toFixed(1) + "s" : "Voice clip: not found in transcript";
        return h("div", { class: "panel" },
          h("b", { text: "Panel " + (i + 1) }),
          h("span", { text: p.setting }),
          h("span", { text: p.action }),
          h("span", { text: "Caption: " + p.caption }),
          h("span", { class: "meta", text: "“" + p.quote + "”" }),
          h("span", { class: "meta", text: clip }));
      })),
      h("div", { class: "toolbar", style: "margin-top:10px" },
        h("button", { class: "btn btn-secondary", type: "button", onclick: function (e) {
          navigator.clipboard.writeText(brief).then(function () { e.target.textContent = "Copied"; });
        } }, "Copy brief for image AI")));
  }

  function briefFor(a) {
    const c = a.comicScript || {};
    const lines = [
      "Create a " + (c.panels || []).length + "-panel comic page in a warm, hand-drawn illustrated style.",
      "Style and era: " + (c.style_notes || ""),
      "Keep each character consistent in every panel:"
    ];
    (c.characters || []).forEach(function (ch) { lines.push("- " + ch.name + ": " + ch.look); });
    (c.panels || []).forEach(function (p, i) {
      lines.push("Panel " + (i + 1) + ": " + p.setting + ". " + p.action + ". Caption text: \"" + p.caption + "\"");
    });
    lines.push("No other text in the image except the captions.");
    return lines.join("\n");
  }

  function mediaBlock(t, a, media, label) {
    const title = h("input", { type: "text", placeholder: "Title the family will see" });
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,video/mp4,video/webm" });
    const key = (a ? a.id : t.id) + ":upload";
    return h("details", { open: Boolean(a) || media.length > 0 }, h("summary", null, label + " (" + media.length + ")"),
      media.length ? h("div", { class: "thumbs" }, media.map(function (m) {
        return h("div", { class: "thumb" },
          m.url ? (m.kind === "video" ? h("video", { src: m.url, muted: true, preload: "metadata" }) : h("img", { src: m.url, alt: m.title || "" })) : null,
          h("div", null, h("span", { text: (m.title || m.kind) + (m.status !== "published" ? " (unfinished)" : "") }),
            h("button", { class: "btn btn-quiet danger", type: "button", onclick: function () { removeMedia(m); } }, "Delete")));
      })) : null,
      h("div", { class: "upload", style: "margin-top:10px" }, title, file,
        h("button", { class: "btn btn-primary", type: "button", disabled: busy === key, onclick: function () { upload(t, a, file, title, key); } },
          busy === key ? "Uploading…" : "Upload and publish to family")));
  }

  async function retry(a) {
    busy = a.id; render();
    try { await api("POST", { action: "retry", answerId: a.id }); } catch (e) { alert(e.message); }
    busy = ""; setTimeout(load, 1500);
  }

  async function upload(t, a, fileInput, titleInput, key) {
    const f = fileInput.files && fileInput.files[0];
    if (!f) { alert("Choose an image or video first."); return; }
    busy = key; render();
    try {
      const slot = await api("POST", {
        action: "media-upload-url", storytellerId: t.id, answerId: a ? a.id : null,
        kind: f.type.indexOf("video") === 0 ? "video" : "comic", mime: f.type, title: titleInput.value
      });
      const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": f.type, "x-upsert": "false" }, body: f });
      if (!put.ok) throw new Error("Upload failed: " + put.status);
      await api("POST", { action: "media-publish", mediaId: slot.mediaId });
    } catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function removeMedia(m) {
    if (!confirm("Delete this from the family page?")) return;
    try { await api("POST", { action: "media-delete", mediaId: m.id }); } catch (e) { alert(e.message); }
    load();
  }

  render();
  if (password) load();
})();
