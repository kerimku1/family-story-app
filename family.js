// Family page: finished comics and films only. Never story text or full recordings.
// It also lists the questions asked (with progress) and lets the family ask one more.
// A comic is a set of panels; captions are drawn by the app (always spelled right),
// and a short real-voice clip plays for a panel when the storyteller allowed it.
(function () {
  "use strict";
  const I18N = window.I18N;
  const ICON_FILM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  const ICON_VOICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const SILENT_PANEL_MS = 3000; // how long "listen" rests on a panel that has no voice clip

  const app = document.getElementById("app");
  const token = (new URLSearchParams(location.search).get("f") || "").trim();
  const audio = new Audio();
  let lang = "ru";
  let data = null;
  let error = "";
  // What is playing: { comic, panel, all }
  let playing = null;
  let restTimer = 0;
  // "Ask another question": { open, sel, sending, notice, added: {main, steps}, copied }
  const ask = { open: false, sel: { relationship: null, key: null, custom: "", showAll: false }, sending: false, notice: null, added: null, copied: false };

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
      else if (k === "svg") node.innerHTML = v; // only the fixed icons above
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    });
    kids.flat(Infinity).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }
  const icon = (svg) => h("span", { class: "icon", svg: svg });

  // ---------- Playback ----------
  function stop() {
    clearTimeout(restTimer);
    audio.pause();
    audio.removeAttribute("src");
    playing = null;
    markPlaying();
  }

  function playPanel(ci, pi, all) {
    clearTimeout(restTimer);
    const comic = data.comics[ci];
    const panel = comic && comic.panels[pi];
    if (!panel) return stop();
    playing = { comic: ci, panel: pi, all: all };
    markPlaying();
    const el = document.getElementById("panel-" + ci + "-" + pi);
    if (all && el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    if (panel.clipUrl) {
      audio.src = panel.clipUrl;
      audio.play().catch(function () { stop(); });
    } else if (all) {
      restTimer = setTimeout(next, SILENT_PANEL_MS);
    } else {
      stop();
    }
  }

  function next() {
    if (!playing) return;
    if (!playing.all) return stop();
    const comic = data.comics[playing.comic];
    if (playing.panel + 1 < comic.panels.length) playPanel(playing.comic, playing.panel + 1, true);
    else stop();
  }
  audio.addEventListener("ended", next);
  audio.addEventListener("error", function () { if (playing && playing.all) next(); else stop(); });

  // Update highlight and buttons without rebuilding the page (keeps scroll and audio steady).
  function markPlaying() {
    const t = I18N[lang].ui;
    document.querySelectorAll(".panel-frame").forEach(function (el) {
      const on = playing && el.id === "panel-" + playing.comic + "-" + playing.panel;
      el.classList.toggle("playing", Boolean(on));
    });
    document.querySelectorAll("[data-listen]").forEach(function (btn) {
      const ci = Number(btn.getAttribute("data-listen"));
      const on = playing && playing.all && playing.comic === ci;
      btn.replaceChildren(icon(on ? ICON_STOP : ICON_PLAY), on ? t.stopAll : t.listenAll);
      btn.setAttribute("aria-pressed", String(Boolean(on)));
    });
  }

  // ---------- Page ----------
  function render() {
    const t = I18N[lang].ui;
    document.documentElement.lang = lang;
    const bar = h("div", { class: "topbar" },
      h("span", { class: "brand", text: t.brand }),
      h("div", { class: "langs", role: "group", "aria-label": "Language" }, Object.keys(I18N).map(function (code) {
        return h("button", { type: "button", "aria-pressed": String(code === lang), onclick: function () { lang = code; render(); } }, I18N[code].label);
      })));
    app.replaceChildren(bar);
    if (error) return add(h("div", { class: "notice bad", role: "alert", text: error }));
    if (!data) return add(h("p", { class: "lead", text: t.loading }));

    document.title = t.familyTitle(data.name);
    add(
      h("h1", { text: t.familyTitle(data.name) }),
      h("p", { class: "lead", text: t.familyLead }),
      h("p", { class: "small", text: t.collected(data.collected) }));

    add(renderAsked(t));

    if (!data.comics.length && !data.media.length) {
      add(h("div", { class: "card empty" }, h("span", { class: "icon", svg: ICON_FILM }), h("p", { text: t.familyEmpty })));
      return;
    }

    add(h("div", { class: "gallery" },
      data.comics.map(function (c, ci) { return renderComic(c, ci, t); }),
      data.media.map(function (m) {
        const visual = m.kind === "video"
          ? h("video", { src: m.url, controls: true, playsinline: true, preload: "metadata" })
          : h("img", { src: m.url, alt: m.title || "", loading: "lazy" });
        return h("article", { class: "card media-item" }, visual, m.title ? h("h2", { text: m.title }) : null);
      })));
    markPlaying();
  }

  function renderComic(c, ci, t) {
    const hasVoice = c.panels.some(function (p) { return p.clipUrl; });
    return h("article", { class: "card comic" },
      h("div", { class: "comic-head" },
        h("p", { class: "small", text: t.comicFrom }),
        c.title ? h("h2", { text: c.title }) : null,
        hasVoice ? h("button", {
          class: "btn btn-primary listen-all", type: "button", "data-listen": String(ci), "aria-pressed": "false",
          onclick: function () { if (playing && playing.all && playing.comic === ci) stop(); else playPanel(ci, 0, true); }
        }, icon(ICON_PLAY), t.listenAll) : null),
      h("div", { class: "panels" }, window.ComicView.pages(h, c.panels, function (p, pi, solo) {
        return window.ComicView.panel(h, p, {
          id: "panel-" + ci + "-" + pi, solo: solo, eager: pi < 2,
          overlay: p.clipUrl ? h("button", {
            class: "cv-voice", type: "button", "aria-label": t.playPanel + (p.caption ? ": " + p.caption : ""),
            onclick: function () {
              if (playing && !playing.all && playing.comic === ci && playing.panel === pi) stop();
              else playPanel(ci, pi, false);
            }
          }, icon(ICON_VOICE), t.playPanel) : null
        });
      }, t.pageLabel)));
  }

  // ---------- The asker's questions and "ask another" ----------
  function stageText(t, q) {
    if (q.stage === "answering") return t.stageAnswering(q.answered, q.total);
    if (q.stage === "writing") return t.stageWriting;
    if (q.stage === "reviewing") return t.stageReviewing;
    if (q.stage === "approved") return t.stageApproved;
    return t.stagePrivate;
  }

  function renderAsked(t) {
    const asked = data.asked || [];
    const qlang = I18N[data.lang] ? data.lang : "ru";
    const parts = [h("h2", { text: t.askedTitle })];
    if (asked.length) {
      parts.push(h("ul", { class: "asked-list" }, asked.map(function (q) {
        return h("li", null, h("span", { class: "asked-main", text: q.main }), h("span", { class: "small", text: stageText(t, q) }));
      })));
    }
    if (ask.added) {
      const linkUi = I18N[qlang].ui;
      const msg = linkUi.shareMsg(data.name, ask.added.main);
      parts.push(
        h("div", { class: "notice good", role: "status", text: t.askAdded }),
        h("p", { class: "small", text: t.stepsPreview(data.name) }),
        h("ol", { class: "steps-preview" }, ask.added.steps.map(function (s) { return h("li", { text: s }); })));
      const tellerUrl = savedTellerLink();
      if (!tellerUrl) parts.push(h("p", { class: "small", text: t.askRemind(data.name) }));
      else parts.push(
        h("p", { class: "small", text: t.tellerLink }),
        h("div", { class: "link-box", text: tellerUrl }),
        h("a", { class: "btn btn-primary", href: "https://wa.me/?text=" + encodeURIComponent(msg + " " + tellerUrl), target: "_blank", rel: "noopener" }, t.shareWa),
        h("a", { class: "btn btn-secondary", href: "https://t.me/share/url?url=" + encodeURIComponent(tellerUrl) + "&text=" + encodeURIComponent(msg), target: "_blank", rel: "noopener" }, t.shareTg),
        h("button", { class: "btn btn-quiet", type: "button", onclick: copyLink }, ask.copied ? t.copied : t.copy));
    }
    if (ask.open) {
      parts.push(window.Chooser.build(h, t, qlang, ask.sel, function (patch) {
        Object.assign(ask.sel, patch);
        ask.notice = null;
        render();
      }, { fixedRelationship: Boolean(data.relationship), hideKeys: asked.map(function (q) { return q.key; }).filter(Boolean) }));
      if (ask.notice) parts.push(h("div", { class: "notice bad", role: "alert", text: ask.notice }));
      parts.push(
        h("button", { class: "btn btn-primary", type: "button", disabled: ask.sending, onclick: sendAsk }, ask.sending ? t.preparing : t.askSend),
        h("button", { class: "btn btn-quiet", type: "button", disabled: ask.sending, onclick: function () { ask.open = false; ask.notice = null; render(); } }, t.cancel));
    } else {
      parts.push(h("button", { class: "btn btn-secondary", type: "button", onclick: openAsk }, t.askAnother));
    }
    return h("section", { class: "card asked" }, parts);
  }

  function openAsk() {
    ask.open = true;
    ask.added = null;
    ask.notice = null;
    ask.sel = { relationship: data.relationship || null, key: null, custom: "", showAll: false };
    render();
  }

  async function sendAsk() {
    const t = I18N[lang].ui;
    const qlang = I18N[data.lang] ? data.lang : "ru";
    if (!ask.sel.relationship) { ask.notice = t.needRelationship; return render(); }
    const mainQuestion = window.Chooser.mainText(ask.sel, qlang);
    if (!mainQuestion) { ask.notice = t.needQuestion; return render(); }
    ask.sending = true;
    ask.notice = null;
    render();
    try {
      const res = await fetch("/api/family", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ f: token, action: "ask", mainKey: ask.sel.key, mainQuestion: mainQuestion, relationship: ask.sel.relationship })
      });
      const body = await res.json().catch(function () { return null; });
      if (!res.ok || !body) throw new Error("ask failed");
      ask.added = { main: body.mainQuestion, steps: body.steps || [] };
      ask.open = false;
      ask.copied = false;
      if (!data.relationship) data.relationship = ask.sel.relationship;
      data.asked = (data.asked || []).concat({ main: body.mainQuestion, key: ask.sel.key === "custom" ? null : ask.sel.key, answered: 0, total: (body.steps || []).length, stage: "answering" });
    } catch (e) {
      ask.notice = t.createFail;
    }
    ask.sending = false;
    render();
  }

  // The storyteller's link is private to them. The family page shows it only on the device
  // where it was created (saved there when the links were made), never from the server.
  function savedTellerLink() {
    try { return localStorage.getItem("teller-link:" + token) || ""; } catch (e) { return ""; }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(savedTellerLink()); } catch (e) { /* the link is shown on the page */ }
    ask.copied = true;
    render();
  }

  async function load() {
    try {
      const res = await fetch("/api/family?f=" + encodeURIComponent(token));
      const body = await res.json().catch(function () { return null; });
      if (res.status === 404) error = I18N[lang].ui.linkNotFound;
      else if (!res.ok || !body) error = I18N[lang].ui.loadFail;
      else {
        data = { comics: [], media: [], ...body };
        if (I18N[body.lang]) lang = body.lang;
      }
    } catch (e) {
      error = I18N[lang].ui.loadFail;
    }
    render();
  }

  render();
  if (token) load();
  else { error = I18N[lang].ui.linkNotFound; render(); }
})();
