// The storyteller's page and the "create a link" page.
// Recordings go straight to private storage; nobody can play them back from the server.
(function () {
  "use strict";

  const I18N = window.I18N;
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
  function savedMode() {
    try { return localStorage.getItem("story-mode") === "text" ? "text" : "voice"; } catch (e) { return "voice"; }
  }
  function draftKey(i) { return "story-draft:" + token + ":" + i; }
  function loadDraft(i) {
    try { return localStorage.getItem(draftKey(i)) || ""; } catch (e) { return ""; }
  }
  function saveDraft(i, text) {
    try { if (text) localStorage.setItem(draftKey(i), text); else localStorage.removeItem(draftKey(i)); } catch (e) { /* storage blocked */ }
  }
  function savedLang() {
    try { return localStorage.getItem("story-lang:" + token) || ""; } catch (e) { return ""; }
  }

  const state = {
    mode: token ? "story" : "create",
    lang: guessLang(),
    loading: Boolean(token),
    loadError: "",
    name: "",
    from: "",
    screen: "welcome",
    index: 0,
    answered: new Set(),
    stories: [],
    pollId: 0,
    recorder: null,
    stream: null,
    chunks: [],
    blob: null,
    blobUrl: "",
    durationSec: 0,
    recording: false,
    sending: false,
    inputMode: savedMode(),
    startedAt: 0,
    timerId: 0,
    notice: null,
    form: { from: "", name: "", qlang: "" },
    created: null,
    creating: false,
    copied: ""
  };
  state.form.qlang = state.lang;

  const app = document.getElementById("app");
  const T = () => I18N[state.lang].ui;
  const Q = () => I18N[state.lang].questions;

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
    if (state.mode === "create") state.form.qlang = lang;
    else {
      try { localStorage.setItem("story-lang:" + token, lang); } catch (e) { /* storage blocked */ }
      state.index = Math.min(state.index, Q().length - 1);
    }
    state.notice = null;
    render();
  }

  function go(screen) {
    resetRecording();
    state.notice = null;
    state.screen = screen;
    clearTimeout(state.pollId);
    if (screen === "stories") loadStories();
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
    if (state.screen === "welcome") return renderWelcome();
    if (state.screen === "done") return renderDone();
    if (state.screen === "stories") return renderStories();
    return renderQuestion();
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

  // ---------- Create links (for the family member) ----------
  function renderCreate() {
    const t = T();
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
    langSelect.addEventListener("change", function () { state.form.qlang = langSelect.value; });

    add(
      h("h1", { text: t.createTitle }),
      h("p", { class: "lead", text: t.createLead }),
      h("form", { class: "card", onsubmit: function (e) { e.preventDefault(); createLinks(fromInput, nameInput); } },
        h("label", { for: "from" }, t.yourName, fromInput),
        h("label", { for: "name" }, t.theirName, nameInput),
        h("label", { for: "qlang" }, t.langLabel, langSelect),
        h("button", { class: "btn btn-primary", type: "submit", disabled: state.creating }, state.creating ? t.loading : t.createBtn)),
      state.notice ? h("div", { class: "notice " + state.notice.kind, role: "status", text: state.notice.text }) : null);

    if (state.created) {
      const linkUi = I18N[state.created.lang].ui;
      const message = linkUi.shareMsg(state.created.name) + " " + state.created.tellerUrl;
      add(
        h("section", { class: "card" },
          h("h2", { text: t.forTeller }),
          h("p", { class: "small", text: t.forTellerNote }),
          h("div", { class: "link-box", text: state.created.tellerUrl }),
          h("a", { class: "btn btn-primary", href: "https://wa.me/?text=" + encodeURIComponent(message), target: "_blank", rel: "noopener" }, t.shareWa),
          h("a", { class: "btn btn-secondary", href: "https://t.me/share/url?url=" + encodeURIComponent(state.created.tellerUrl) + "&text=" + encodeURIComponent(linkUi.shareMsg(state.created.name)), target: "_blank", rel: "noopener" }, t.shareTg),
          h("button", { class: "btn btn-quiet", type: "button", onclick: function () { copyText(state.created.tellerUrl, "teller"); } }, state.copied === "teller" ? t.copied : t.copy)),
        h("section", { class: "card" },
          h("h2", { text: t.forFamily }),
          h("p", { class: "small" }, icon(ICON_LOCK), " ", t.forFamilyNote),
          h("div", { class: "link-box", text: state.created.familyUrl }),
          h("a", { class: "btn btn-secondary", href: state.created.familyUrl, target: "_blank", rel: "noopener" }, t.openFamily),
          h("button", { class: "btn btn-quiet", type: "button", onclick: function () { copyText(state.created.familyUrl, "family"); } }, state.copied === "family" ? t.copied : t.copy)));
    }
  }

  async function createLinks(fromInput, nameInput) {
    const from = state.form.from.trim();
    const name = state.form.name.trim();
    if (!from) { fromInput.focus(); return; }
    if (!name) { nameInput.focus(); return; }
    state.creating = true;
    state.notice = null;
    render();
    try {
      const data = await api("POST", "/api/create", { from: from, name: name, lang: state.form.qlang });
      state.created = { tellerUrl: data.tellerUrl, familyUrl: data.familyUrl, lang: state.form.qlang, name: name };
      state.copied = "";
    } catch (e) {
      state.notice = { kind: "bad", text: T().createFail };
    }
    state.creating = false;
    render();
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

  // ---------- Storyteller: load their profile ----------
  async function loadProfile() {
    try {
      const data = await api("GET", "/api/teller?t=" + encodeURIComponent(token));
      state.name = data.name;
      state.from = data.from;
      const chosen = savedLang();
      state.lang = I18N[chosen] ? chosen : (I18N[data.lang] ? data.lang : state.lang);
      state.answered = new Set(data.answered || []);
      state.stories = data.stories || [];
    } catch (e) {
      state.loadError = e.status === 404 ? T().linkNotFound : T().loadFail;
    }
    state.loading = false;
    render();
  }

  function firstOpen() {
    const i = Q().findIndex(function (_, k) { return !state.answered.has(k); });
    return i === -1 ? 0 : i;
  }

  function storiesButton() {
    return h("button", { class: "btn btn-secondary", type: "button", onclick: function () { go("stories"); } }, T().myStories);
  }

  function renderWelcome() {
    const t = T();
    add(
      h("h1", { text: t.welcomeTitle(state.name, state.from) }),
      h("p", { class: "lead", text: t.welcomeLead }),
      h("p", { class: "privacy" }, icon(ICON_LOCK), h("span", { text: t.privacyNote })),
      h("p", { class: "tip", text: t.tip }),
      h("button", {
        class: "btn btn-primary",
        type: "button",
        onclick: function () { state.index = firstOpen(); go("question"); }
      }, state.answered.size ? t.cont : t.start),
      state.stories.length ? storiesButton() : null);
  }

  // ---------- Question and recording ----------
  function renderQuestion() {
    const t = T();
    const qs = Q();
    const i = state.index;
    const busy = state.recording || state.sending;

    const dots = h("div", { class: "dots" }, qs.map(function (_, k) {
      const done = state.answered.has(k);
      return h("button", {
        type: "button",
        class: "dot" + (k === i ? " current" : done ? " done" : ""),
        "aria-label": t.questionOf(k + 1, qs.length) + (done ? ", " + t.answered : ""),
        "aria-current": k === i ? "step" : null,
        disabled: busy,
        onclick: function () { state.index = k; go("question"); }
      }, String(k + 1));
    }));

    add(h("section", { class: "card" },
      h("div", { class: "progress" }, h("span", { text: t.questionOf(i + 1, qs.length) }), dots),
      h("p", { class: "question", text: qs[i] }),
      h("button", { class: "btn btn-secondary", type: "button", onclick: speakQuestion, disabled: busy }, icon(ICON_SPEAKER), t.listen),
      modeSwitch(busy),
      state.inputMode === "text" ? textBlock() : ((!state.blob || state.recording) ? recorderBlock() : null),
      state.notice ? h("div", { class: "notice " + state.notice.kind, role: "status", text: state.notice.text }) : null,
      (state.inputMode === "voice" && state.blob && !state.recording) ? answerBlock() : null));

    const last = i === qs.length - 1;
    const done = state.answered.has(i);
    add(h("div", { class: "row" },
      h("button", {
        class: "btn btn-quiet", type: "button",
        disabled: i === 0 || busy,
        onclick: function () { state.index = i - 1; go("question"); }
      }, t.back),
      h("button", {
        class: "btn " + (done ? "btn-secondary" : "btn-quiet"), type: "button",
        disabled: busy,
        onclick: function () { if (last) go("done"); else { state.index = i + 1; go("question"); } }
      }, done ? t.next : t.skip)));
    if (state.answered.size) add(h("button", { class: "btn btn-quiet", type: "button", disabled: busy, onclick: function () { go("stories"); } }, t.myStories));
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
    try { localStorage.setItem("story-mode", mode); } catch (e) { /* storage blocked */ }
    state.notice = null;
    render();
    if (mode === "text") {
      const ta = document.getElementById("answer-text");
      if (ta) ta.focus();
    }
  }

  function textBlock() {
    const t = T();
    const index = state.index;
    const ta = h("textarea", {
      id: "answer-text", class: "answer-text", rows: "8", maxlength: "20000",
      placeholder: t.textPh, "aria-label": t.yourAnswer, disabled: state.sending
    });
    ta.value = loadDraft(index);
    ta.addEventListener("input", function () { saveDraft(index, ta.value); });
    return h("div", { class: "answer" },
      ta,
      h("p", { class: "privacy" }, icon(ICON_LOCK), h("span", { text: t.privacyNoteText })),
      h("button", { class: "btn btn-primary", type: "button", disabled: state.sending, onclick: function () { sendText(ta); } },
        state.sending ? t.sending : t.send));
  }

  async function sendText(ta) {
    const t = T();
    const index = state.index;
    const text = ta.value.trim();
    if (!text) {
      state.notice = { kind: "bad", text: t.textEmpty };
      render();
      const again = document.getElementById("answer-text");
      if (again) again.focus();
      return;
    }
    saveDraft(index, ta.value);
    state.sending = true;
    state.notice = null;
    render();
    try {
      const out = await api("POST", "/api/teller", {
        t: token, action: "text-answer", questionIndex: index, questionText: Q()[index], text: text
      });
      state.answered.add(index);
      state.stories.push({ id: out.answerId, questionIndex: index, question: Q()[index], status: "uploaded", approval: "waiting" });
      saveDraft(index, "");
      state.notice = { kind: "good", text: t.saved };
    } catch (e) {
      state.notice = { kind: "bad", text: t.sendFail };
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

  function renderDone() {
    const t = T();
    add(
      h("h1", { text: t.doneTitle }),
      h("p", { class: "lead", text: t.doneLead }),
      storiesButton(),
      h("button", {
        class: "btn btn-quiet", type: "button",
        onclick: function () { state.index = firstOpen(); go("question"); }
      }, t.allQuestions));
  }

  // ---------- My stories: read and approve ----------
  async function loadStories() {
    try {
      const data = await api("GET", "/api/teller?t=" + encodeURIComponent(token));
      state.stories = data.stories || [];
      state.answered = new Set(data.answered || []);
    } catch (e) { /* keep what we have */ }
    if (state.screen !== "stories") return;
    render();
    clearTimeout(state.pollId);
    const writing = state.stories.some(function (s) { return s.status === "uploaded" || s.status === "processing"; });
    if (writing) state.pollId = setTimeout(loadStories, 8000);
  }

  function renderStories() {
    const t = T();
    add(h("h1", { text: t.myStories }), h("p", { class: "lead", text: t.myStoriesLead }));
    if (!state.stories.length) add(h("p", { class: "small", text: t.noStories }));
    state.stories.slice().reverse().forEach(function (s) {
      const body = [];
      if (s.status === "ready") {
        body.push(h("h2", { text: s.title || s.question }));
        body.push(h("p", { class: "story-text", text: s.story || "" }));
        body.push(h("div", { class: "chips" },
          h("button", { type: "button", class: "chip", "aria-pressed": String(s.approval === "approved"), onclick: function () { setApproval(s, "approved"); } }, t.approve),
          h("button", { type: "button", class: "chip", "aria-pressed": String(s.approval === "hidden"), onclick: function () { setApproval(s, "hidden"); } }, t.hide)));
        if (s.approval === "approved") body.push(h("p", { class: "small", text: t.approvedNote }));
        if (s.approval === "hidden") body.push(h("p", { class: "small", text: t.hiddenNote }));
      } else if (s.status === "failed") {
        body.push(h("p", { class: "small", text: t.statusFailed }));
      } else {
        body.push(h("p", { class: "small writing", text: t.statusWriting }));
      }
      add(h("article", { class: "card story" },
        h("p", { class: "small", text: s.question }),
        body,
        h("button", { class: "btn btn-quiet danger", type: "button", onclick: function () { deleteStory(s); } }, t.deleteRec)));
    });
    add(h("button", {
      class: "btn btn-primary", type: "button",
      onclick: function () { state.index = firstOpen(); go("question"); }
    }, t.allQuestions));
  }

  async function setApproval(story, approval) {
    const previous = story.approval;
    story.approval = approval;
    render();
    try {
      await api("POST", "/api/teller", { t: token, action: "approve", answerId: story.id, approval: approval });
    } catch (e) {
      story.approval = previous;
      render();
    }
  }

  async function deleteStory(story) {
    if (!window.confirm(T().confirmDelete)) return;
    try {
      await api("POST", "/api/teller", { t: token, action: "delete", answerId: story.id });
      state.stories = state.stories.filter(function (s) { return s.id !== story.id; });
      const stillAnswered = state.stories.some(function (s) { return s.questionIndex === story.questionIndex && s.status !== "failed"; });
      if (!stillAnswered) state.answered.delete(story.questionIndex);
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
      const slot = await api("POST", "/api/teller", {
        t: token, action: "upload-url", questionIndex: index, questionText: Q()[index], mime: type
      });
      const put = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "content-type": type, "x-upsert": "false" },
        body: blob
      });
      if (!put.ok) throw new Error("Upload failed: " + put.status);
      await api("POST", "/api/teller", { t: token, action: "uploaded", answerId: slot.answerId, durationSec: state.durationSec });
      state.answered.add(index);
      state.stories.push({ id: slot.answerId, questionIndex: index, question: Q()[index], status: "uploaded", approval: "waiting" });
      state.sending = false;
      resetRecording();
      state.notice = { kind: "good", text: t.saved };
    } catch (e) {
      state.sending = false;
      state.notice = { kind: "bad", text: t.sendFail };
    }
    render();
  }

  // ---------- Read the question aloud ----------
  function speakQuestion() {
    const t = T();
    if (!("speechSynthesis" in window)) {
      state.notice = { kind: "bad", text: t.noVoice };
      return render();
    }
    const code = I18N[state.lang].speechLang;
    const base = code.slice(0, 2).toLowerCase();
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(function (v) { return v.lang === code; }) ||
      voices.find(function (v) { return (v.lang || "").toLowerCase().indexOf(base) === 0; });
    if (!voice && voices.length) {
      state.notice = { kind: "bad", text: t.noVoice };
      return render();
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(Q()[state.index]);
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
