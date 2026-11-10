// The question chooser: "Who is this person to you?" → one of 30 main questions (or your own).
// Used by the create page (app.js) and the family page (family.js).
// sel = { relationship, key, custom, showAll } is kept by the caller; onChange(patch) updates it.
(function () {
  "use strict";
  const BANK = window.QUESTION_BANK;
  const RELS = ["parent", "child", "partner", "friend"];
  const SHOW_FIRST = 10;
  const ICONS = {
    parent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="6" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2"/><circle cx="18" cy="10" r="2"/><path d="M15.5 21v-1.5a2.5 2.5 0 0 1 5 0V21"/></svg>',
    child: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="3.5"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/></svg>',
    partner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    friend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><path d="M2 21v-2a5 5 0 0 1 10 0v2M12 21v-2a5 5 0 0 1 10 0v2"/></svg>'
  };

  // The main question text for a selection, in the questions' language.
  function mainText(sel, qlang) {
    if (sel.key === "custom") return String(sel.custom || "").trim();
    const q = (BANK[sel.relationship] || []).find(function (x) { return x.id === sel.key; });
    return q ? q[qlang] || q.ru : "";
  }

  // h = the page's element helper; t = interface texts; qlang = language of the questions.
  function build(h, t, qlang, sel, onChange, opts) {
    opts = opts || {};
    const parts = [];
    if (!opts.fixedRelationship) {
      parts.push(h("h2", { text: t.relLabel }));
      parts.push(h("div", { class: "rel-grid", role: "radiogroup", "aria-label": t.relLabel }, RELS.map(function (r) {
        return h("button", {
          type: "button", class: "rel-btn", role: "radio", "aria-checked": String(sel.relationship === r),
          onclick: function () { if (sel.relationship !== r) onChange({ relationship: r, key: null, showAll: false }); }
        }, h("span", { class: "icon", svg: ICONS[r] }), t.rel[r]);
      })));
    }
    if (sel.relationship) {
      // Questions already asked are left out (opts.hideKeys), unless one is the current choice.
      const hide = new Set(opts.hideKeys || []);
      const list = (BANK[sel.relationship] || []).filter(function (q) { return !hide.has(q.id) || q.id === sel.key; });
      const chosenAt = list.findIndex(function (q) { return q.id === sel.key; });
      const limit = sel.showAll || chosenAt >= SHOW_FIRST ? list.length : SHOW_FIRST;
      parts.push(h("h2", { text: t.chooseLabel }));
      parts.push(h("p", { class: "small", text: t.chooseLead }));
      parts.push(h("div", { class: "q-list", role: "radiogroup", "aria-label": t.chooseLabel }, list.slice(0, limit).map(function (q) {
        return h("button", {
          type: "button", class: "q-option", role: "radio", "aria-checked": String(sel.key === q.id),
          onclick: function () { onChange({ key: q.id }); }
        }, q[qlang] || q.ru);
      })));
      if (limit < list.length) {
        parts.push(h("button", { type: "button", class: "btn btn-quiet", onclick: function () { onChange({ showAll: true }); } }, t.showAll));
      }
      const own = h("textarea", { class: "answer-text own-q", rows: "2", maxlength: "300", placeholder: t.ownPh, "aria-label": t.ownQuestion });
      own.value = sel.custom || "";
      // Typing does not re-render (keeps focus); it only updates the selection.
      own.addEventListener("input", function () { sel.custom = own.value; if (sel.key !== "custom") { sel.key = "custom"; markCustom(own); } });
      own.addEventListener("focus", function () { if (sel.key !== "custom") { sel.key = "custom"; markCustom(own); } });
      parts.push(h("div", { class: "q-own" + (sel.key === "custom" ? " on" : "") },
        h("span", { class: "small", text: t.ownQuestion }), own));
    }
    return h("div", { class: "chooser" }, parts);
  }

  // Show the custom box as selected without rebuilding the page.
  function markCustom(textarea) {
    const root = textarea.closest(".chooser");
    if (!root) return;
    root.querySelectorAll(".q-option").forEach(function (b) { b.setAttribute("aria-checked", "false"); });
    textarea.parentNode.classList.add("on");
  }

  window.Chooser = { build: build, mainText: mainText, RELS: RELS };
})();
