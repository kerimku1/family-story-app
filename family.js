// Family page: finished comics and films only. Never story text or full recordings.
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
      h("div", { class: "panels" }, c.panels.map(function (p, pi) {
        return h("figure", { class: "panel-frame", id: "panel-" + ci + "-" + pi },
          h("img", { src: p.url, alt: p.caption || "", loading: pi < 2 ? "eager" : "lazy" }),
          h("figcaption", { class: "caption-box" },
            h("span", { class: "caption-text", text: p.caption }),
            p.clipUrl ? h("button", {
              class: "voice-btn", type: "button", "aria-label": t.playPanel + ": " + p.caption,
              onclick: function () {
                if (playing && !playing.all && playing.comic === ci && playing.panel === pi) stop();
                else playPanel(ci, pi, false);
              }
            }, icon(ICON_VOICE), t.playPanel) : null));
      })));
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
