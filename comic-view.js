// Draws a comic the way a reader sees it: pages of panels, each picture with its narration box
// and speech bubbles. The pictures have no text in them; all words are drawn here, so they are
// always spelled right. Used by the family page and the studio.
// panel = { url, caption, dialogue: [{ speaker, side, text }], shape: "wide"|"square", page }
(function () {
  "use strict";

  function bubbles(h, dialogue) {
    const lines = (dialogue || []).filter(function (d) { return d && String(d.text || "").trim(); }).slice(0, 3);
    if (!lines.length) return null;
    return h("div", { class: "cv-bubbles" }, lines.map(function (d, i) {
      const side = d.side === "right" ? "right" : d.side === "left" ? "left" : (i % 2 ? "right" : "left");
      return h("div", { class: "cv-bubble " + side, title: d.speaker || "" }, d.text);
    }));
  }

  // One panel. opts: { id, image (an element instead of an <img>), overlay (element on the picture), below (element under it) }
  function panel(h, p, opts) {
    opts = opts || {};
    const shape = p.shape === "square" ? "square" : "wide";
    const art = opts.image || (p.url
      ? h("img", { src: p.url, alt: p.caption || "", loading: opts.eager ? "eager" : "lazy" })
      : h("div", { class: "cv-empty", text: opts.emptyText || "" }));
    return h("figure", { class: "cv-panel panel-frame " + shape + (opts.solo ? " solo" : ""), id: opts.id || null },
      p.caption ? h("figcaption", { class: "cv-caption", text: p.caption }) : null,
      h("div", { class: "cv-art" + (p.shape ? "" : " legacy") }, art, bubbles(h, p.dialogue), opts.overlay || null),
      opts.below || null);
  }

  // Panels grouped into pages. renderOne(p, index, solo) returns the panel element.
  function pages(h, panels, renderOne, pageLabel) {
    const groups = [];
    panels.forEach(function (p, i) {
      const n = p.page || 0;
      let g = groups[groups.length - 1];
      if (!g || g.n !== n) { g = { n: n, items: [] }; groups.push(g); }
      g.items.push({ p: p, i: i });
    });
    return groups.map(function (g) {
      // A square panel with no square neighbour to sit beside takes the full row.
      const els = g.items.map(function (it, k) {
        const sq = function (x) { return x && x.p.shape === "square"; };
        let run = 0;
        for (let j = k; j >= 0 && sq(g.items[j]); j--) run++;
        const pairedBefore = run % 2 === 0;
        const pairedAfter = !pairedBefore && sq(g.items[k + 1]);
        const solo = sq(it) && !pairedBefore && !pairedAfter;
        return renderOne(it.p, it.i, solo);
      });
      return h("section", { class: "cv-page" },
        g.n && groups.length > 1 && pageLabel ? h("p", { class: "cv-page-label", text: pageLabel(g.n) }) : null,
        h("div", { class: "cv-grid" }, els));
    });
  }

  window.ComicView = { panel: panel, pages: pages };
})();
