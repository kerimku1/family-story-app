// The "ask a question" page and the storyteller's page.
// Ask: who is this person to you → one main question → a link.
// Storyteller: ~5 short lead-up questions (voice or text) → "Write my story" → one story.
// Recordings go straight to private storage; nobody can play them back from the server.
(function () {
  "use strict";

  const I18N = window.I18N;
  const Chooser = window.Chooser;
  const LANG_NAMES = { ru: "Русский", kk: "Қазақша", en: "English" };
  const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  const ICON_SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const ICON_KEYS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>';
  const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const params = new URLSearchParams(location.search);
  const token = (params.get("t") || "").trim();

  function guessLang() {
    const l = (navigator.language || "ru").toLowerCase();
    if (l.startsWith("kk")) return "kk";
    if (l.startsWith("en")) return "en";
    return "ru";
  }
  function store(key, value) {
    try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
  }
  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }
  const draftKey = (storyId, i) => "story-draft:" + token + ":" + storyId + ":" + i;

  const state = {
    mode: token ? "story" : "create",
    lang: guessLang(),
    qlang: "ru",            // language the storyteller's questions are written in
    loading: Boolean(token),
    loadError: "",
    name: "",
    from: "",
    stories: [],
    current: null,          // id of the story being answered
    screen: "welcome",
    index: 0,
    pollId: 0,
    recorder: null,
    stream: null,
    chunks: [],
    blob: null,
    blobUrl: "",
    durationSec: 0,
    recording: false,
    sending: false,
    inputMode: read("story-mode") === "text" ? "text" : "voice",
    startedAt: 0,
    timerId: 0,
    notice: null,
    form: { from: "", name: "", qlang: "" },
    sel: { relationship: null, key: null, custom: "", showAll: false },
    created: null,
    creating: false,
    copied: ""
  };
  state.form.qlang = state.lang;

  const app = document.getElementById("app");
  const T = () => I18N[state.lang].ui;

  // Small element helper. Text from people always goes through textContent.
  // Append only real nodes (DOM append would print "null" for empty slots).
  function add() {
    Array.prototype.slice.call(arguments).flat(Infinity).forEach(function (n) { if (n) app.append(n); });
  }

  function h(tag, props) {
    const node = document.createElement(tag);
    const kids = Array.prototype.slice.call(arguments, 2);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "svg") node.innerHTML = v; // only the fixed icons above
        else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : String(v));
      });
    }
    kids.flat(Infinity).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }
  const icon = (svg) => h("span", { class: "icon", svg: svg });

  async function api(method, url, body) {
    const res = await fetch(url, {
      method: method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || "HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setLang(lang) {
    if (state.recording || state.sending) return;
    state.lang = lang;
    if (state.mode === "create") { if (!state.created) state.form.qlang = lang; }
    else store("story-lang:" + token, lang);
    state.notice = null;
    render();
  }

  function go(screen) {
    resetRecording();
    state.notice = null;
    state.screen = screen;
    clearTimeout(state.pollId);
    if (screen === "stories" || screen === "writing") loadStories();
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    document.documentElement.lang = state.lang;
    document.title = T().brand;
    app.replaceChildren(topbar());
    if (state.mode === "create") return renderCreate();
    if (state.loading) return add(h("p", { class: "lead", text: T().loading }));
    if (state.loadError) return add(h("div", { class: "notice bad", role: "alert", text: state.loadError }));
    if (state.screen === "question" && story()) return renderQuestion();
    if (state.screen === "finish" && story()) return renderFinish();
    if (state.screen === "writing") return renderWriting();
    if (state.screen === "stories") return renderStories();
    return renderWelcome();
  }

  function topbar() {
    return h("div", { class: "topbar" },
      h("span", { class: "brand", text: T().brand }),
      h("div", { class: "langs", role: "group", "aria-label": "Language" },
        Object.keys(I18N).map(function (code) {
          return h("button", {
            type: "button",
            "aria-pressed": String(code === state.lang),
            onclick: function () { setLang(code); }
          }, I18N[code].label);
        })));
  }

  // ---------- Ask a question (the family member) ----------
  function renderCreate() {
    const t = T();
    if (state.created) return renderCreated();

    const fromInput = h("input", { id: "from", autocomplete: "given-name", placeholder: t.yourNamePh, maxlength: "40" });
    fromInput.value = state.form.from;
    fromInput.addEventListener("input", function () { state.form.from = fromInput.value; });
    const nameInput = h("input", { id: "name", placeholder: t.theirNamePh, maxlength: "40" });
    nameInput.value = state.form.name;
    nameInput.addEventListener("input", function () { state.form.name = nameInput.value; });
    const langSelect = h("select", { id: "qlang" }, Object.keys(I18N).map(function (code) {
      return h("option", { value: code }, LANG_NAMES[code] || code);
    }));
    langSelect.value = state.form.qlang;
    langSelect.addEventListener("change", function () { state.form.qlang = langSelect.value; render(); });

    add(
      h("h1", { text: t.createTitle }),
      h("p", { class: "lead", text: t.createLead }),
      h("section", { class: "card" },
        h("label", { for: "from" }, t.yourName, fromInput),
        h("label", { for: "name" }, t.theirName, nameInput),
        h("label", { for: "qlang" }, t.langLabel, langSelect)),
      h("section", { class: "card" }, Chooser.build(h, t, state.form.qlang, state.sel, function (patch) {
        Object.assign(state.sel, patch);
        state.notice = null;
        render();
      })),
      state.notice ? h("div", { class: "notice " + state.notice.kind, role: "status", text: state.notice.text }) : null,
      h("button", { class: "btn btn-primary", type: "button", disabled: state.creating, onclick: function () { createLinks(fromInput, nameInput); } },
        state.creating ? t.preparing : t.createBtn));
  }

  async function createLinks(fromInput, nameInput) {
    const t = T();
    const from = state.form.from.trim();
    const name = state.form.name.trim();
    if (!from) { fromInput.focus(); return; }
    if (!name) { nameInput.focus(); return; }
    if (!state.sel.relationship) { state.notice = { kind: "bad", text: t.needRelationship }; return render(); }
    const mainQuestion = Chooser.mainText(state.sel, state.form.qlang);
    if (!mainQuestion) { state.notice = { kind: "bad", text: t.needQuestion }; return render(); }
    state.creating = true;
    state.notice = null;
    render();
    try {
      const data = await api("POST", "/api/create", {
        from: from, name: name, lang: state.form.qlang, relationship: state.sel.relationship,
        mainKey: state.sel.key, mainQuestion: mainQuestion
      });
      state.created = { tellerUrl: data.tellerUrl, familyUrl: data.familyUrl, lang: state.form.qlang, name: name, main: data.mainQuestion, steps: data.steps || [] };
      state.copied = "";
      window.scrollTo(0, 0);
    } catch (e) {
      state.notice = { kind: "bad", text: t.createFail };
    }
    state.creating = false;
    render();
  }

  function renderCreated() {
    const t = T();
    const c = state.created;
    const linkUi = I18N[c.lang].ui;
    const message = linkUi.shareMsg(c.name, c.main) + " " + c.tellerUrl;
    add(
      h("section", { class: "card main-q" },
        h("p", { class: "small", text: t.mainLabel }),
        h("p", { class: "main-q-text", text: c.main }),
        h("p", { class: "small", text: t.stepsPreview(c.name) }),
        h("ol", { class: "steps-preview" }, c.steps.map(function (s) { return h("li", { text: s }); }))),
      h("section", { class: "card" },
        h("h2", { text: t.forTeller }),
        h("p", { class: "small", text: t.forTellerNote }),
        h("div", { class: "link-box", text: c.tellerUrl }),
        h("a", { class: "btn btn-primary", href: "https://wa.me/?text=" + encodeURIComponent(message), target: "_blank", rel: "noopener" }, t.shareWa),
        h("a", { class: "btn btn-secondary", href: "https://t.me/share/url?url=" + encodeURIComponent(c.tellerUrl) + "&text=" + encodeURIComponent(linkUi.shareMsg(c.name, c.main)), target: "_blank", rel: "noopener" }, t.shareTg),
        h("button", { class: "btn btn-quiet", type: "button", onclick: function () { copyText(c.tellerUrl, "teller"); } }, state.copied === "teller" ? t.copied : t.copy)),
      h("section", { class: "card" },
        h("h2", { text: t.forFamily }),
        h("p", { class: "small" }, icon(ICON_LOCK), " ", t.forFamilyNote),
        h("div", { class: "link-box", text: c.familyUrl }),
        h("a", { class: "btn btn-secondary", href: c.familyUrl, target: "_blank", rel: "noopener" }, t.openFamily),
        h("button", { class: "btn btn-quiet", type: "button", onclick: function () { copyText(c.familyUrl, "family"); } }, state.copied === "family" ? t.copied : t.copy)),
      h("button", { class: "btn btn-quiet", type: "button", onclick: function () {
        state.created = null;
        state.sel = { relationship: null, key: null, custom: "", showAll: false };
        state.form.name = "";
        render();
        window.scrollTo(0, 0);
      } }, t.newQuestion));
  }

  async function copyText(text, which) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h("textarea", null, text);
      document.body.append(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) { /* nothing */ }
      ta.remove();
    }
    state.copied = which;
    render();
  }

  // ---------- Storyteller ----------
  const story = () => state.stories.find(function (s) { return s.id === state.current; }) || null;
  const steps = () => (story() ? story().steps : []);
  const answered = () => new Set(story() ? story().answeredParts : []);
  const isOpen = (s) => s.status === "collecting" || s.status === "failed";
  const openStories = () => state.stories.filter(isOpen);

  function applyData(data) {
    state.name = data.name;
    state.from = data.from;
    state.qlang = I18N[data.lang] ? data.lang : "ru";
    state.stories = data.stories || [];
    if (!story()) {
      const open = openStories();
      state.current = open.length ? open[open.length - 1].id : null;
    }
  }

  async function loadProfile() {
    try {
      const data = await api("GET", "/api/teller?t=" + encodeURIComponent(token));
      applyData(data);
      const chosen = read("story-lang:" + token);
      state.lang = I18N[chosen] ? chosen : state.qlang;
    } catch (e) {
      state.loadError = e.status === 404 ? T().linkNotFound : T().loadFail;
    }
    state.loading = false;
    render();
  }

  function firstOpenPart() {
    const done = answered();
    const i = steps().findIndex(function (_, k) { return !done.has(k); });
    return i === -1 ? 0 : i;
  }

  function startStory(id) {
    state.current = id;
    state.index = firstOpenPart();
    go("question");
  }

  function storiesButton(kind) {
    const written = state.stories.some(function (s) { return !isOpen(s); });
    return written ? h("button", { class: "btn " + (kind || "btn-secondary"), type: "button", onclick: function () { go("stories"); } }, T().myStories) : null;
  }

  function renderWelcome() {
    const t = T();
    const open = openStories();
    add(h("h1", { text: t.welcomeTitle(state.name, state.from) }));
    if (!open.length) {
      add(h("p", { class: "lead", text: t.noOpen }), storiesButton("btn-primary"));
      return;
    }
    add(h("p", { class: "lead", text: t.welcomeLead }));
    if (open.length === 1) {
      const s = open[0];
      add(
        h("section", { class: "card main-q" },
          h("p", { class: "small", text: t.mainIntro(state.from) }),
          h("p", { class: "main-q-text", text: s.main }),
          h("p", { class: "small", text: s.answeredParts.length ? t.answeredOf(s.answeredParts.length, s.steps.length) : t.stepsCount(s.steps.length) })),
        h("p", { class: "privacy" }, icon(ICON_LOCK), h("span", { text: t.privacyNote })),
        h("p", { class: "tip", text: t.tip }),
        h("button", { class: "btn btn-primary", type: "button", onclick: function () { startStory(s.id); } },
          s.answeredParts.length ? t.cont : t.start),
        storiesButton());
      return;
    }
    add(h("h2", { text: t.questionsForYou }));
    open.slice().reverse().forEach(function (s) {
      add(h("section", { class: "card main-q" },
        h("p", { class: "main-q-text", text: s.main }),
        h("p", { class: "small", text: t.answeredOf(s.answeredParts.length, s.steps.length) }),
        h("button", { class: "btn btn-primary", type: "button", onclick: function () { startStory(s.id); } }, t.openStory)));
    });
    add(h("p", { class: "privacy" }, icon(ICON_LOCK), h("span", { text: t.privacyNote })), storiesButton());
  }

  // ---------- One lead-up question ----------
  function renderQuestion() {
    const t = T();
    const s = story();
    if (!isOpen(s)) { add(h("div", { class: "notice good", text: t.alreadyWritten }), storiesButton("btn-primary")); return; }
    const qs = steps();
    const i = Math.min(state.index, qs.length - 1);
    const done = answered();
    const busy = state.recording || state.sending;

    const dots = h("div", { class: "dots" }, qs.map(function (_, k) {
      const ok = done.has(k);
      return h("button", {
        type: "button",
        class: "dot" + (k === i ? " current" : ok ? " done" : ""),
        "aria-label": t.questionOf(k + 1, qs.length) + (ok ? ", " + t.answered : ""),
        "aria-current": k === i ? "step" : null,
        disabled: busy,
        onclick: function () { state.index = k; go("question"); }
      }, String(k + 1));
    }));

    add(
      h("p", { class: "main-q-line" }, h("span", { class: "small", text: t.mainLabel + ": " }), h("span", { text: s.main })),
      h("section", { class: "card" },
        h("div", { class: "progress" }, h("span", { text: t.questionOf(i + 1, qs.length) }), dots),
        h("p", { class: "question", text: qs[i] }),
        h("button", { class: "btn btn-secondary", type: "button", onclick: speakQuestion, disabled: busy }, icon(ICON_SPEAKER), t.listen),
        modeSwitch(busy),
        state.inputMode === "text" ? textBlock() : ((!state.blob || state.recording) ? recorderBlock() : null),
        state.notice ? h("div", { class: "notice " + state.notice.kind, role: "status", text: state.notice.text }) : null,
        (state.inputMode === "voice" && state.blob && !state.recording) ? answerBlock() : null));

    const last = i === qs.length - 1;
    add(h("div", { class: "row" },
      h("button", {
        class: "btn btn-quiet", type: "button",
        disabled: i === 0 || busy,
        onclick: function () { state.index = i - 1; go("question"); }
      }, t.back),
      h("button", {
        class: "btn " + (done.has(i) ? "btn-secondary" : "btn-quiet"), type: "button",
        disabled: busy,
        onclick: function () { if (last) go("finish"); else { state.index = i + 1; go("question"); } }
      }, done.has(i) ? t.next : t.skip)));
    if (done.size === qs.length) {
      add(h("button", { class: "btn btn-primary", type: "button", disabled: busy, onclick: function () { go("finish"); } }, t.finishBtn));
    }
  }

  // Voice or text: the storyteller picks, and the phone remembers the choice.
  function modeSwitch(busy) {
    const t = T();
    const option = function (mode, svg, label) {
      return h("button", {
        type: "button", class: "seg-btn", "aria-pressed": String(state.inputMode === mode), disabled: busy,
        onclick: function () { setMode(mode); }
      }, icon(svg), label);
    };
    return h("div", { class: "seg", role: "group", "aria-label": t.yourAnswer },
      option("voice", ICON_MIC, t.modeVoice), option("text", ICON_KEYS, t.modeText));
  }

  function setMode(mode) {
    if (state.recording || state.sending || state.inputMode === mode) return;
    state.inputMode = mode;
    store("story-mode", mode);
    state.notice = null;
    render();
    if (mode === "text") {
      const ta = document.getElementById("answer-text");
      if (ta) ta.focus();
    }
  }

  function textBlock() {
    const t = T();
    const key = draftKey(state.current, state.index);
    const ta = h("textarea", {
      id: "answer-text", class: "answer-text", rows: "8", maxlength: "20000",
      placeholder: t.textPh, "aria-label": t.yourAnswer, disabled: state.sending
    });
    ta.value = read(key);
    ta.addEventListener("input", function () { store(key, ta.value); });
    return h("div", { class: "answer" },
      ta,
      h("p", { class: "privacy" }, icon(ICON_LOCK), h("span", { text: t.privacyNoteText })),
      h("button", { class: "btn btn-primary", type: "button", disabled: state.sending, onclick: function () { sendText(ta); } },
        state.sending ? t.sending : t.send));
  }

  function markAnswered(index) {
    const s = story();
    if (s && s.answeredParts.indexOf(index) === -1) s.answeredParts = s.answeredParts.concat(index).sort(function (a, b) { return a - b; });
  }

  async function sendText(ta) {
    const t = T();
    const index = state.index;
    const key = draftKey(state.current, index);
    const text = ta.value.trim();
    if (!text) {
      state.notice = { kind: "bad", text: t.textEmpty };
      render();
      const again = document.getElementById("answer-text");
      if (again) again.focus();
      return;
    }
    store(key, ta.value);
    state.sending = true;
    state.notice = null;
    render();
    try {
      await api("POST", "/api/teller", { t: token, action: "text-answer", answerId: state.current, partIndex: index, text: text });
      markAnswered(index);
      store(key, "");
      state.notice = { kind: "good", text: t.saved };
    } catch (e) {
      state.notice = { kind: "bad", text: e.status === 409 ? t.alreadyWritten : t.sendFail };
    }
    state.sending = false;
    render();
  }

  function recorderBlock() {
    const t = T();
    return h("div", { class: "recorder" },
      h("button", {
        type: "button",
        class: "rec-btn" + (state.recording ? " recording" : ""),
        "aria-label": state.recording ? t.recording : t.tapToRecord,
        svg: state.recording ? ICON_STOP : ICON_MIC,
        onclick: toggleRecording
      }),
      state.recording ? h("span", { class: "timer", id: "timer", text: fmt(Date.now() - state.startedAt) }) : null,
      h("span", { class: "rec-label", text: state.recording ? t.recording : t.tapToRecord }));
  }

  function answerBlock() {
    const t = T();
    return h("div", { class: "answer" },
      h("p", { class: "small", text: t.yourAnswer }),
      h("audio", { controls: true, preload: "metadata", src: state.blobUrl }),
      h("p", { class: "privacy" }, icon(ICON_LOCK), h("span", { text: t.privacyNote })),
      h("button", { class: "btn btn-primary", type: "button", onclick: sendAnswer, disabled: state.sending }, state.sending ? t.sending : t.send),
      h("button", {
        class: "btn btn-secondary", type: "button", disabled: state.sending,
        onclick: function () { resetRecording(); state.notice = null; render(); }
      }, t.rerecord));
  }

  // ---------- Finish: write one story from all answers ----------
  function renderFinish() {
    const t = T();
    const s = story();
    if (!isOpen(s)) { add(h("div", { class: "notice good", text: t.alreadyWritten }), storiesButton("btn-primary")); return; }
    const n = s.steps.length;
    const a = s.answeredParts.length;
    add(
      h("h1", { text: a === n ? t.finishTitle : t.mainLabel }),
      h("section", { class: "card main-q" }, h("p", { class: "main-q-text", text: s.main })),
      h("p", { class: "lead", text: a === n ? t.finishLead : t.finishPartial(a, n) }),
      state.notice ? h("div", { class: "notice " + state.notice.kind, role: "status", text: state.notice.text }) : null,
      a ? h("button", { class: "btn btn-primary", type: "button", disabled: state.sending, onclick: finishStory }, state.sending ? t.sending : t.finishBtn) : null,
      h("button", { class: "btn btn-secondary", type: "button", disabled: state.sending, onclick: function () { state.index = firstOpenPart(); go("question"); } }, t.backToQuestions));
  }

  async function finishStory() {
    state.sending = true;
    state.notice = null;
    render();
    try {
      await api("POST", "/api/teller", { t: token, action: "finish", answerId: state.current });
      const s = story();
      if (s) s.status = "uploaded";
      state.sending = false;
      go("writing");
      return;
    } catch (e) {
      state.notice = { kind: "bad", text: T().sendFail };
    }
    state.sending = false;
    render();
  }

  function renderWriting() {
    const t = T();
    const s = story();
    if (s && s.status === "ready") { go("stories"); return; }
    add(
      h("h1", { text: t.writingTitle }),
      h("p", { class: "lead writing", text: t.writingLead }),
      h("button", { class: "btn btn-secondary", type: "button", onclick: function () { go("stories"); } }, t.myStories),
      openStories().length ? h("button", { class: "btn btn-quiet", type: "button", onclick: function () { go("welcome"); } }, t.questionsForYou) : null);
  }

  // ---------- My stories: read and approve ----------
  async function loadStories() {
    try {
      applyData(await api("GET", "/api/teller?t=" + encodeURIComponent(token)));
    } catch (e) { /* keep what we have */ }
    if (state.screen !== "stories" && state.screen !== "writing") return;
    render();
    clearTimeout(state.pollId);
    const writing = state.stories.some(function (s) { return s.status === "uploaded" || s.status === "processing"; });
    if (writing) state.pollId = setTimeout(loadStories, 6000);
  }

  function renderStories() {
    const t = T();
    add(h("h1", { text: t.myStories }), h("p", { class: "lead", text: t.myStoriesLead }));
    if (!state.stories.length) add(h("p", { class: "small", text: t.noStories }));
    state.stories.slice().reverse().forEach(function (s) {
      const body = [];
      if (s.status === "ready") {
        body.push(h("h2", { text: s.title || s.main }));
        body.push(h("p", { class: "story-text", text: s.story || "" }));
        body.push(h("div", { class: "chips" },
          h("button", { type: "button", class: "chip", "aria-pressed": String(s.approval === "approved"), onclick: function () { setApproval(s, "approved"); } }, t.approve),
          h("button", { type: "button", class: "chip", "aria-pressed": String(s.approval === "hidden"), onclick: function () { setApproval(s, "hidden"); } }, t.hide)));
        if (s.approval === "approved") body.push(h("p", { class: "small", text: t.approvedNote }));
        if (s.approval === "hidden") body.push(h("p", { class: "small", text: t.hiddenNote }));
        if (s.approval === "approved" && !s.typed) {
          body.push(h("div", { class: "voice-choice" },
            h("p", { class: "small", text: t.voiceLabel }),
            h("div", { class: "chips" },
              h("button", { type: "button", class: "chip", "aria-pressed": String(Boolean(s.allowVoice)), onclick: function () { setVoice(s, true); } }, t.voiceWith),
              h("button", { type: "button", class: "chip", "aria-pressed": String(!s.allowVoice), onclick: function () { setVoice(s, false); } }, t.voiceWithout)),
            h("p", { class: "small", text: s.allowVoice ? t.voiceOnNote : t.voiceOffNote })));
        }
      } else if (isOpen(s)) {
        if (s.status === "failed") body.push(h("p", { class: "small", text: t.statusFailed }));
        body.push(h("p", { class: "small", text: t.answeredOf(s.answeredParts.length, s.steps.length) }));
        body.push(h("button", { class: "btn btn-primary", type: "button", onclick: function () { startStory(s.id); } }, t.openStory));
      } else {
        body.push(h("p", { class: "small writing", text: t.statusWriting }));
      }
      add(h("article", { class: "card story" },
        h("p", { class: "small", text: s.main }),
        body,
        h("button", { class: "btn btn-quiet danger", type: "button", onclick: function () { deleteStory(s); } }, t.deleteRec)));
    });
    if (openStories().length) add(h("button", { class: "btn btn-secondary", type: "button", onclick: function () { go("welcome"); } }, t.questionsForYou));
  }

  async function setVoice(s, allow) {
    const previous = s.allowVoice;
    s.allowVoice = allow;
    render();
    try {
      await api("POST", "/api/teller", { t: token, action: "voice", answerId: s.id, allow: allow });
    } catch (e) {
      s.allowVoice = previous;
      render();
    }
  }

  async function setApproval(s, approval) {
    const previous = s.approval;
    s.approval = approval;
    render();
    try {
      await api("POST", "/api/teller", { t: token, action: "approve", answerId: s.id, approval: approval });
    } catch (e) {
      s.approval = previous;
      render();
    }
  }

  async function deleteStory(s) {
    if (!window.confirm(T().confirmDelete)) return;
    try {
      await api("POST", "/api/teller", { t: token, action: "delete", answerId: s.id });
      state.stories = state.stories.filter(function (x) { return x.id !== s.id; });
      if (state.current === s.id) state.current = null;
      render();
    } catch (e) { /* leave as is */ }
  }

  // ---------- Recording ----------
  function pickMime() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return "";
    const options = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    return options.find(function (m) { return MediaRecorder.isTypeSupported(m); }) || "";
  }

  function toggleRecording() {
    if (state.recording) stopRecording();
    else startRecording();
  }

  async function startRecording() {
    const t = T();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      state.notice = { kind: "bad", text: t.noRecorder };
      return render();
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      state.notice = { kind: "bad", text: t.micDenied };
      return render();
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();

    const mime = pickMime();
    let rec;
    try { rec = mime ? new MediaRecorder(state.stream, { mimeType: mime }) : new MediaRecorder(state.stream); }
    catch (e) { rec = new MediaRecorder(state.stream); }

    state.chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) state.chunks.push(e.data); };
    rec.onstop = function () {
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0];
      state.blob = new Blob(state.chunks, { type: type });
      state.durationSec = (Date.now() - state.startedAt) / 1000;
      if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = URL.createObjectURL(state.blob);
      stopStream();
      clearInterval(state.timerId);
      state.recording = false;
      render();
    };
    state.recorder = rec;
    rec.start(1000);
    state.recording = true;
    state.startedAt = Date.now();
    state.notice = null;
    render();
    state.timerId = setInterval(function () {
      const el = document.getElementById("timer");
      if (el) el.textContent = fmt(Date.now() - state.startedAt);
    }, 500);
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (track) { track.stop(); });
      state.stream = null;
    }
  }

  function resetRecording() {
    if (state.recording && state.recorder) {
      state.recorder.onstop = null;
      stopRecording();
      clearInterval(state.timerId);
      state.recording = false;
    }
    stopStream();
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blob = null;
    state.blobUrl = "";
    state.chunks = [];
    state.durationSec = 0;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // ---------- Private upload ----------
  async function sendAnswer() {
    const t = T();
    const index = state.index;
    const blob = state.blob;
    const type = blob.type || "audio/webm";
    state.sending = true;
    state.notice = null;
    render();
    try {
      const slot = await api("POST", "/api/teller", { t: token, action: "upload-url", answerId: state.current, partIndex: index, mime: type });
      const put = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "content-type": type, "x-upsert": "false" },
        body: blob
      });
      if (!put.ok) throw new Error("Upload failed: " + put.status);
      await api("POST", "/api/teller", { t: token, action: "uploaded", partId: slot.partId, durationSec: state.durationSec });
      markAnswered(index);
      state.sending = false;
      resetRecording();
      state.notice = { kind: "good", text: t.saved };
    } catch (e) {
      state.sending = false;
      state.notice = { kind: "bad", text: e.status === 409 ? t.alreadyWritten : t.sendFail };
    }
    render();
  }

  // ---------- Read the question aloud (in the questions' language) ----------
  function speakQuestion() {
    const t = T();
    if (!("speechSynthesis" in window)) {
      state.notice = { kind: "bad", text: t.noVoice };
      return render();
    }
    const code = I18N[state.qlang].speechLang;
    const base = code.slice(0, 2).toLowerCase();
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(function (v) { return v.lang === code; }) ||
      voices.find(function (v) { return (v.lang || "").toLowerCase().indexOf(base) === 0; });
    if (!voice && voices.length) {
      state.notice = { kind: "bad", text: t.noVoice };
      return render();
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(steps()[state.index] || "");
    u.lang = code;
    if (voice) u.voice = voice;
    u.rate = 0.92;
    speechSynthesis.speak(u);
  }
  if ("speechSynthesis" in window) speechSynthesis.getVoices();

  window.addEventListener("beforeunload", function (e) {
    if (state.recording || state.sending) { e.preventDefault(); e.returnValue = ""; }
  });

  render();
  if (state.mode === "story") loadProfile();
})();
