// Family page: only finished comics and animated films. Never story text or raw recordings.
(function () {
  "use strict";
  const I18N = window.I18N;
  const ICON_FILM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>';
  const app = document.getElementById("app");
  const token = (new URLSearchParams(location.search).get("f") || "").trim();
  let lang = "ru";
  let data = null;
  let error = "";

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
      else if (k === "svg") node.innerHTML = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    });
    kids.flat(Infinity).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

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

    if (!data.media.length) {
      add(h("div", { class: "card empty" }, h("span", { class: "icon", svg: ICON_FILM }), h("p", { text: t.familyEmpty })));
      return;
    }
    add(h("div", { class: "gallery" }, data.media.map(function (m) {
      const visual = m.kind === "video"
        ? h("video", { src: m.url, controls: true, playsinline: true, preload: "metadata" })
        : h("img", { src: m.url, alt: m.title || "", loading: "lazy" });
      return h("article", { class: "card media-item" }, visual, m.title ? h("h2", { text: m.title }) : null);
    })));
  }

  async function load() {
    try {
      const res = await fetch("/api/family?f=" + encodeURIComponent(token));
      const body = await res.json().catch(function () { return null; });
      if (res.status === 404) error = I18N[lang].ui.linkNotFound;
      else if (!res.ok || !body) error = I18N[lang].ui.loadFail;
      else {
        data = body;
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
