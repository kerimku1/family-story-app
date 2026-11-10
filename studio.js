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
  let pollTimer = 0;

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
      clearTimeout(pollTimer);
      const drawing = data.storytellers.some(function (t) { return t.answers.some(function (a) { return a.comicStatus === "drawing"; }); });
      if (drawing) pollTimer = setTimeout(function () { if (!busy) load(); }, 6000);
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
      photosBlock(t),
      lifeCard(t.lifeCard),
      t.answers.length ? h("div", null, t.answers.map(function (a) { return renderAnswer(t, a); })) : h("p", { class: "meta", text: "No answers yet." }),
      mediaBlock(t, null, t.media.filter(function (m) { return !m.answerId && (m.kind === "comic" || m.kind === "video"); }), "General media (not tied to one story)"));
  }

  function photosBlock(t) {
    const photos = t.media.filter(function (m) { return m.kind === "photo" && m.url; });
    const who = h("input", { type: "text", placeholder: "Who and when, e.g. Мама, 1985" });
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
    const key = t.id + ":photo";
    return h("details", { open: true },
      h("summary", null, "Photos of " + t.name + " for drawing (" + photos.length + ")"),
      h("p", { class: "meta", text: "Used only so the AI draws a face that looks like them. The family never sees these. The newest 3 are used. Clear, front-facing photos work best." }),
      photos.length ? h("div", { class: "thumbs" }, photos.map(function (m) {
        return h("div", { class: "thumb" }, h("img", { src: m.url, alt: m.title || "photo" }),
          h("div", null, h("span", { text: m.title || "photo" }),
            h("button", { class: "btn btn-quiet danger", type: "button", onclick: function () { removeMedia(m, "Delete this photo?"); } }, "Delete")));
      })) : null,
      h("div", { class: "upload", style: "margin-top:10px" }, who, file,
        h("button", { class: "btn btn-primary", type: "button", disabled: busy === key, onclick: function () { uploadPhoto(t, file, who, key); } },
          busy === key ? "Uploading…" : "Add photo")));
  }

  async function uploadPhoto(t, fileInput, whoInput, key) {
    const f = fileInput.files && fileInput.files[0];
    if (!f) { alert("Choose a photo first."); return; }
    busy = key; render();
    try {
      const slot = await api("POST", { action: "media-upload-url", storytellerId: t.id, kind: "photo", mime: f.type, title: whoInput.value });
      const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": f.type, "x-upsert": "false" }, body: f });
      if (!put.ok) throw new Error("Upload failed: " + put.status);
      await api("POST", { action: "media-publish", mediaId: slot.mediaId });
    } catch (e) { alert(e.message); }
    busy = ""; load();
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
    const panelMedia = media.filter(function (m) { return m.kind === "panel"; });
    const otherMedia = media.filter(function (m) { return m.kind === "comic" || m.kind === "video"; });
    const head = h("div", { class: "toolbar" },
      h("h3", { text: "Q" + (a.questionIndex + 1) + ". " + (a.title || a.question) }),
      badge(a.status), badge(a.approval), a.typed ? badge("typed") : (a.allowVoice ? badge("voice allowed") : badge("no voice")),
      a.durationSec ? h("span", { class: "meta", text: a.durationSec + "s" }) : null,
      (a.status === "failed" || a.status === "ready") ? h("button", { class: "btn btn-quiet", type: "button", disabled: busy === a.id, onclick: function () { retry(a); } }, a.status === "failed" ? "Retry" : "Rewrite") : null);
    const parts = [head];
    if (a.error) parts.push(h("p", { class: "meta", text: "Error: " + a.error }));
    if (a.approval !== "approved") {
      parts.push(h("p", { class: "meta", text: a.status === "ready" ? "Waiting for the storyteller's approval." : "Not written yet." }));
      return h("details", null, h("summary", null, head), parts.slice(1));
    }
    parts.push(h("details", null, h("summary", null, "Story"), h("p", { class: "story-text", text: a.story || "" })));
    if (a.comicScript) parts.push(comicScript(t, a, panelMedia));
    parts.push(mediaBlock(t, a, otherMedia, "Optional: a finished film or one-page comic for this story"));
    return h("div", { class: "card", style: "margin-top:12px" }, parts);
  }

  function voiceLine(a, p) {
    if (a.typed) return "Typed answer: no voice";
    if (!p.voice_clip) return "Voice: sentence not found in the recording";
    const when = p.voice_clip.start.toFixed(1) + "–" + p.voice_clip.end.toFixed(1) + "s";
    if (!a.allowVoice) return "Voice " + when + " · storyteller has not allowed voice";
    return p.hasClip ? "Voice clip ready (" + when + ")" : "Voice " + when + " · clip is being cut…";
  }

  function comicScript(t, a, panelMedia) {
    const c = a.comicScript;
    const panels = c.panels || [];
    const uploaded = panelMedia.filter(function (m) { return m.status === "draft" || m.status === "published"; });
    const live = uploaded.some(function (m) { return m.status === "published"; });
    const drawing = a.comicStatus === "drawing";
    const hasPhotos = t.media.some(function (m) { return m.kind === "photo" && m.url; });
    const sheet = t.media.filter(function (m) { return m.kind === "sheet" && m.answerId === a.id && m.url; }).pop();
    return h("details", { open: true }, h("summary", null, "Comic: " + uploaded.length + " of " + panels.length + " panels" + (live ? " · on family page" : "")),
      drawStatus(a, uploaded.length, live, hasPhotos),
      data.aiDrawing ? h("div", { class: "toolbar" },
        h("button", { class: "btn btn-primary", type: "button", disabled: drawing || busy === a.id + ":draw",
          onclick: function () { drawComic(a, null, uploaded.length); } }, uploaded.length ? "Redraw whole comic with AI" : "Draw comic with AI"),
        sheet ? h("a", { class: "btn btn-quiet", href: sheet.url, target: "_blank", rel: "noopener" }, "View character sheet") : null) : null,
      h("p", { class: "meta", text: data.aiDrawing
        ? "Or draw panels yourself: copy a prompt, use it in Gemini, and upload the image. Images have no text; the app adds the captions."
        : "Automatic drawing is off (add GEMINI_API_KEY in Vercel). Copy a prompt per panel into Gemini and upload the image. The app adds the captions." }),
      h("p", { class: "meta", text: c.style_notes || "" }),
      c.characters && c.characters.length ? h("div", { class: "grid" }, c.characters.map(function (ch) {
        return h("div", { class: "panel" }, h("b", { text: "Character" }), h("span", { text: ch.name }), h("span", { class: "meta", text: ch.look }));
      })) : null,
      h("div", { class: "grid", style: "margin-top:12px" }, panels.map(function (p, i) {
        const image = panelMedia.filter(function (m) { return m.panelIndex === i && m.url; }).pop();
        const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", "aria-label": "Image for panel " + (i + 1) });
        const key = a.id + ":panel:" + i;
        return h("div", { class: "panel" },
          h("b", { text: "Panel " + (i + 1) }),
          image ? h("img", { class: "panel-thumb", src: image.url, alt: "Panel " + (i + 1) }) : null,
          h("span", { text: p.setting }),
          h("span", { text: p.action }),
          h("span", { text: "Caption: " + p.caption }),
          h("span", { class: "meta", text: "“" + p.quote + "”" }),
          h("span", { class: "meta", text: voiceLine(a, p) }),
          data.aiDrawing && image ? h("button", { class: "btn btn-secondary", type: "button", disabled: drawing, onclick: function () { drawComic(a, i); } }, "Redraw this panel with AI") : null,
          h("button", { class: "btn btn-quiet", type: "button", onclick: function (e) { copy(e.target, panelPrompt(c, i)); } }, "Copy prompt for this panel"),
          file,
          h("button", { class: "btn btn-primary", type: "button", disabled: busy === key, onclick: function () { uploadPanel(t, a, i, file, key); } },
            busy === key ? "Uploading…" : image ? "Replace image" : "Upload image"));
      })),
      h("div", { class: "toolbar", style: "margin-top:12px" },
        live
          ? h("button", { class: "btn btn-secondary", type: "button", disabled: busy === a.id + ":publish", onclick: function () { publishComic(a, false); } }, "Hide comic from family")
          : h("button", { class: "btn btn-primary", type: "button", disabled: !uploaded.length || busy === a.id + ":publish", onclick: function () { publishComic(a, true, uploaded.length, panels.length); } }, "Publish comic to family"),
        h("button", { class: "btn btn-quiet", type: "button", onclick: function (e) { copy(e.target, characterSheetPrompt(c)); } }, "Copy prompt for a character sheet")));
  }

  function drawStatus(a, have, live, hasPhotos) {
    const lines = [];
    if (a.comicStatus === "drawing") lines.push(h("div", { class: "notice good writing", text: "Drawing with AI… usually about a minute. This page refreshes by itself." }));
    else if (a.comicStatus === "ready" && !live) lines.push(h("div", { class: "notice good", text: "Drawn by AI. Check every panel, redraw any that look wrong, then publish." }));
    else if (a.comicStatus === "partial") lines.push(h("div", { class: "notice bad", text: "Some panels couldn't be drawn: " + (a.comicError || "") }));
    else if (a.comicStatus === "failed") lines.push(h("div", { class: "notice bad", text: "Drawing failed: " + (a.comicError || "") }));
    if (data.aiDrawing && !hasPhotos && !have) lines.push(h("p", { class: "meta", text: "Tip: add photos of the storyteller above before drawing, so the character looks like them." }));
    if (data.autoPublish) lines.push(h("p", { class: "meta", text: "Auto-publish is on: finished comics go to the family page without review." }));
    return lines.length ? h("div", { class: "draw-status" }, lines) : null;
  }

  async function drawComic(a, panelIndex, have) {
    if (panelIndex === null && have && !confirm("Redraw all panels? The current pictures will be replaced.")) return;
    busy = a.id + ":draw"; render();
    try { await api("POST", { action: "comic-draw", answerId: a.id, panelIndex: panelIndex }); }
    catch (e) { alert(e.message); }
    busy = ""; setTimeout(load, 800);
  }

  function styleLines(c) {
    const lines = [
      "Warm, hand-drawn illustrated comic style, soft colours, expressive faces.",
      "Era, place and mood: " + (c.style_notes || ""),
      "Characters (keep them looking exactly the same in every panel):"
    ];
    (c.characters || []).forEach(function (ch) { lines.push("- " + ch.name + ": " + ch.look); });
    return lines;
  }

  // One panel at a time, with no text, so the app can add correctly spelled captions.
  function panelPrompt(c, i) {
    const p = (c.panels || [])[i] || {};
    return styleLines(c).concat([
      "",
      "Draw ONE comic panel (panel " + (i + 1) + " of " + (c.panels || []).length + "), landscape 4:3.",
      "Scene: " + p.setting + ".",
      "What we see: " + p.action + ".",
      "",
      "IMPORTANT: no text of any kind in the image — no captions, no speech bubbles, no letters, no signs, no numbers.",
      "If I attached a photo of the person, base the character's face on it."
    ]).join("\n");
  }

  function characterSheetPrompt(c) {
    return styleLines(c).concat([
      "",
      "Draw a character sheet: each character above, full body, front and three-quarter view, on a plain background.",
      "No text in the image. I will use this sheet as a reference so every panel looks consistent."
    ]).join("\n");
  }

  function copy(button, text) {
    const done = function () { const old = button.textContent; button.textContent = "Copied"; setTimeout(function () { button.textContent = old; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt("Copy this:", text); });
    else prompt("Copy this:", text);
  }

  function mediaBlock(t, a, media, label) {
    const title = h("input", { type: "text", placeholder: "Title the family will see" });
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,video/mp4,video/webm" });
    const key = (a ? a.id : t.id) + ":upload";
    return h("details", { open: media.length > 0 }, h("summary", null, label + " (" + media.length + ")"),
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

  async function uploadPanel(t, a, index, fileInput, key) {
    const f = fileInput.files && fileInput.files[0];
    if (!f) { alert("Choose an image first."); return; }
    busy = key; render();
    try {
      const slot = await api("POST", { action: "media-upload-url", storytellerId: t.id, answerId: a.id, kind: "panel", panelIndex: index, mime: f.type });
      const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": f.type, "x-upsert": "false" }, body: f });
      if (!put.ok) throw new Error("Upload failed: " + put.status);
      await api("POST", { action: "media-publish", mediaId: slot.mediaId });
    } catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function publishComic(a, publish, have, total) {
    if (publish && have < total && !confirm(have + " of " + total + " panels have images. Publish anyway?")) return;
    busy = a.id + ":publish"; render();
    try { await api("POST", { action: "comic-publish", answerId: a.id, publish: publish }); } catch (e) { alert(e.message); }
    busy = ""; load();
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

  async function removeMedia(m, question) {
    if (!confirm(question || "Delete this from the family page?")) return;
    try { await api("POST", { action: "media-delete", mediaId: m.id }); } catch (e) { alert(e.message); }
    load();
  }

  render();
  if (password) load();
})();
