// Пилотная страница: ссылка для близкого человека, вопросы, запись голосового ответа
// и отправка файла через меню «Поделиться» (WhatsApp, Telegram). Сервер не нужен.
(function () {
  "use strict";

  const I18N = window.I18N;
  const LANG_NAMES = { ru: "Русский", kk: "Қазақша", en: "English" };
  const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/><path d="M8 21h8"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  const ICON_SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

  const params = new URLSearchParams(location.search);
  function guessLang() {
    const l = (navigator.language || "ru").toLowerCase();
    if (l.startsWith("kk")) return "kk";
    if (l.startsWith("en")) return "en";
    return "ru";
  }
  const urlLang = params.get("lang");
  const state = {
    lang: urlLang && I18N[urlLang] ? urlLang : guessLang(),
    name: (params.get("name") || "").trim().slice(0, 40),
    from: (params.get("from") || "").trim().slice(0, 40),
    mode: params.get("name") ? "story" : "create",
    screen: "welcome",
    index: 0,
    privacy: "now",
    recorder: null,
    stream: null,
    chunks: [],
    blob: null,
    blobUrl: "",
    recording: false,
    startedAt: 0,
    timerId: 0,
    notice: null,
    form: { from: "", name: "", qlang: "" },
    createdLink: "",
    createdLang: "",
    copied: false
  };
  state.form.qlang = state.lang;

  const app = document.getElementById("app");
  const T = () => I18N[state.lang].ui;
  const Q = () => I18N[state.lang].questions;

  // Небольшой помощник для создания элементов. Пользовательский текст всегда идёт через textContent.
  function h(tag, props) {
    const node = document.createElement(tag);
    const kids = Array.prototype.slice.call(arguments, 2);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "svg") node.innerHTML = v; // только для статичных иконок выше
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

  // Прогресс хранится только на этом телефоне.
  const progressKey = () => "story:" + state.from + ":" + state.name + ":" + state.lang;
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(progressKey()) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(progressKey(), JSON.stringify(p)); } catch (e) { /* хранилище недоступно */ }
  }
  function firstOpen() {
    const p = loadProgress();
    const i = Q().findIndex(function (_, k) { return !p[k]; });
    return i === -1 ? 0 : i;
  }

  function setLang(lang) {
    if (state.recording) return;
    state.lang = lang;
    if (state.mode === "create") state.form.qlang = lang;
    if (state.mode === "story") {
      const url = new URL(location.href);
      url.searchParams.set("lang", lang);
      history.replaceState(null, "", url);
      state.index = Math.min(state.index, Q().length - 1);
    }
    state.notice = null;
    render();
  }

  function go(screen) {
    resetRecording();
    state.notice = null;
    state.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    document.documentElement.lang = state.lang;
    document.title = T().brand;
    app.replaceChildren(topbar());
    if (state.mode === "create") return renderCreate();
    if (state.screen === "welcome") return renderWelcome();
    if (state.screen === "done") return renderDone();
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

  // ---------- Экран 1: ребёнок создаёт ссылку ----------
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

    app.append(
      h("h1", { text: t.createTitle }),
      h("p", { class: "lead", text: t.createLead }),
      h("form", { class: "card", onsubmit: function (e) { e.preventDefault(); createLink(fromInput, nameInput); } },
        h("label", { for: "from" }, t.yourName, fromInput),
        h("label", { for: "name" }, t.theirName, nameInput),
        h("label", { for: "qlang" }, t.langLabel, langSelect),
        h("button", { class: "btn btn-primary", type: "submit" }, t.createBtn)));

    if (state.createdLink) {
      const linkUi = I18N[state.createdLang].ui;
      const message = linkUi.shareMsg(state.form.name.trim()) + " " + state.createdLink;
      app.append(h("section", { class: "card" },
        h("h2", { text: t.linkReady }),
        h("div", { class: "link-box", text: state.createdLink }),
        h("a", { class: "btn btn-primary", href: "https://wa.me/?text=" + encodeURIComponent(message), target: "_blank", rel: "noopener" }, t.shareWa),
        h("a", { class: "btn btn-secondary", href: "https://t.me/share/url?url=" + encodeURIComponent(state.createdLink) + "&text=" + encodeURIComponent(linkUi.shareMsg(state.form.name.trim())), target: "_blank", rel: "noopener" }, t.shareTg),
        h("button", { class: "btn btn-quiet", type: "button", onclick: copyLink }, state.copied ? t.copied : t.copy)));
    }
  }

  function createLink(fromInput, nameInput) {
    const from = state.form.from.trim();
    const name = state.form.name.trim();
    if (!from) { fromInput.focus(); return; }
    if (!name) { nameInput.focus(); return; }
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set("name", name);
    url.searchParams.set("from", from);
    url.searchParams.set("lang", state.form.qlang);
    state.createdLink = url.toString();
    state.createdLang = state.form.qlang;
    state.copied = false;
    render();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(state.createdLink);
    } catch (e) {
      const ta = h("textarea", null, state.createdLink);
      document.body.append(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) { /* ничего */ }
      ta.remove();
    }
    state.copied = true;
    render();
  }

  // ---------- Экран 2: приветствие для рассказчика ----------
  function renderWelcome() {
    const t = T();
    const started = Object.keys(loadProgress()).length > 0;
    app.append(
      h("h1", { text: t.welcomeTitle(state.name, state.from) }),
      h("p", { class: "lead", text: t.welcomeLead }),
      h("p", { class: "tip", text: t.tip }),
      h("button", {
        class: "btn btn-primary",
        type: "button",
        onclick: function () { state.index = firstOpen(); go("question"); }
      }, started ? t.cont : t.start));
  }

  // ---------- Экран 3: вопрос и запись ----------
  function renderQuestion() {
    const t = T();
    const qs = Q();
    const i = state.index;
    const p = loadProgress();

    const dots = h("div", { class: "dots" }, qs.map(function (_, k) {
      return h("button", {
        type: "button",
        class: "dot" + (k === i ? " current" : p[k] ? " done" : ""),
        "aria-label": t.questionOf(k + 1, qs.length) + (p[k] ? ", " + t.answered : ""),
        "aria-current": k === i ? "step" : null,
        disabled: state.recording,
        onclick: function () { state.index = k; go("question"); }
      }, String(k + 1));
    }));

    app.append(h("section", { class: "card" },
      h("div", { class: "progress" }, h("span", { text: t.questionOf(i + 1, qs.length) }), dots),
      h("p", { class: "question", text: qs[i] }),
      h("button", { class: "btn btn-secondary", type: "button", onclick: speakQuestion, disabled: state.recording }, icon(ICON_SPEAKER), t.listen),
      (!state.blob || state.recording) ? recorderBlock() : null,
      state.notice ? h("div", { class: "notice " + state.notice.kind, role: "status", text: state.notice.text }) : null,
      (state.blob && !state.recording) ? answerBlock() : null));

    const last = i === qs.length - 1;
    app.append(h("div", { class: "row" },
      h("button", {
        class: "btn btn-quiet", type: "button",
        disabled: i === 0 || state.recording,
        onclick: function () { state.index = i - 1; go("question"); }
      }, t.back),
      h("button", {
        class: "btn " + (p[i] ? "btn-secondary" : "btn-quiet"), type: "button",
        disabled: state.recording,
        onclick: function () { if (last) go("done"); else { state.index = i + 1; go("question"); } }
      }, p[i] ? t.next : t.skip)));
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
    const chip = function (value, label) {
      return h("button", {
        type: "button", class: "chip", "aria-pressed": String(state.privacy === value),
        onclick: function () { state.privacy = value; render(); }
      }, label);
    };
    return h("div", { class: "answer" },
      h("p", { class: "small", text: t.yourAnswer }),
      h("audio", { controls: true, preload: "metadata", src: state.blobUrl }),
      h("p", { class: "small", text: t.privacyLabel }),
      h("div", { class: "chips" }, chip("now", t.privacyNow), chip("later", t.privacyLater)),
      h("button", { class: "btn btn-primary", type: "button", onclick: sendAnswer }, t.send),
      h("button", {
        class: "btn btn-secondary", type: "button",
        onclick: function () { resetRecording(); state.notice = null; render(); }
      }, t.rerecord));
  }

  // ---------- Экран 4: спасибо ----------
  function renderDone() {
    const t = T();
    app.append(
      h("h1", { text: t.doneTitle }),
      h("p", { class: "lead", text: t.doneLead }),
      h("button", {
        class: "btn btn-secondary", type: "button",
        onclick: function () { state.index = firstOpen(); go("question"); }
      }, t.allQuestions));
  }

  // ---------- Запись звука ----------
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
    state.privacy = "now";
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // ---------- Отправка ----------
  function extFor(type) {
    if (type.indexOf("mp4") !== -1 || type.indexOf("m4a") !== -1) return "m4a";
    if (type.indexOf("ogg") !== -1) return "ogg";
    return "webm";
  }

  function fileName() {
    const safe = function (s) {
      return (s || "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "story";
    };
    const day = new Date().toISOString().slice(0, 10);
    const n = String(state.index + 1).padStart(2, "0");
    return safe(state.name) + "_q" + n + "_" + state.privacy + "_" + day + "." + extFor(state.blob.type);
  }

  async function sendAnswer() {
    const t = T();
    const i = state.index;
    const file = new File([state.blob], fileName(), { type: state.blob.type });
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: t.answerFile(i + 1, Q()[i]) });
        shared = true;
      } catch (e) {
        if (e && e.name === "AbortError") return; // человек закрыл меню
      }
    }
    if (shared) {
      state.notice = { kind: "good", text: t.sentOk };
    } else {
      download(file);
      state.notice = { kind: "good", text: t.downloaded };
    }
    const p = loadProgress();
    p[i] = { privacy: state.privacy, at: Date.now() };
    saveProgress(p);
    render();
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = h("a", { href: url, download: file.name });
    document.body.append(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  // ---------- Озвучка вопроса ----------
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
    if (state.recording) { e.preventDefault(); e.returnValue = ""; }
  });

  render();
})();
