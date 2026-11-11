// Story Studio: turn approved stories into comics for the family.
// One person at a time, newest first. Each story shows one clear next step.
// The studio never receives raw recordings or stories the storyteller did not approve.
(function () {
  "use strict";
  const app = document.getElementById("app");
  const REL = { parent: "Parent", child: "Child", partner: "Partner", friend: "Friend" };
  let password = "";
  try { password = sessionStorage.getItem("studio-password") || ""; } catch (e) { /* blocked */ }
  let selected = "";
  try { selected = sessionStorage.getItem("studio-person") || ""; } catch (e) { /* blocked */ }
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
      const waiting = data.storytellers.some(function (t) {
        return t.media.some(function (m) { return m.appMade && m.status === "rendering"; }) ||
          t.answers.some(function (a) { return a.comicStatus === "drawing" || a.status === "uploaded" || a.status === "processing"; });
      });
      if (waiting) pollTimer = setTimeout(function () { if (!busy) load(); }, 6000);
    } catch (e) {
      data = null;
      error = e.status === 401 ? "Wrong password." : "Could not load: " + e.message;
      if (e.status === 401) { password = ""; try { sessionStorage.removeItem("studio-password"); } catch (_) { /* */ } }
    }
    render();
  }

  // ---------- Page ----------
  function render() {
    app.replaceChildren(h("div", { class: "topbar" }, h("span", { class: "brand", text: "Story Studio" }),
      password ? h("button", { class: "btn btn-quiet", type: "button", onclick: load }, "Refresh") : null));
    if (!password) return renderLogin();
    if (error) add(h("div", { class: "notice bad", role: "alert", text: error }));
    if (!data) return add(h("p", { class: "lead", text: "Loading…" }));
    const people = data.storytellers; // newest first
    if (!people.length) return add(h("h1", { text: "Studio" }), h("p", { class: "lead", text: "Nobody yet. Create a link on the home page." }));
    const person = people.find(function (t) { return t.id === selected; }) || people[0];
    if (people.length > 1) add(peoplePicker(people, person));
    add(renderPerson(person));
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

  function choose(id) {
    selected = id;
    try { sessionStorage.setItem("studio-person", id); } catch (_) { /* */ }
    render();
    window.scrollTo(0, 0);
  }

  function peoplePicker(people, current) {
    return h("nav", { class: "people", "aria-label": "People" }, people.map(function (t) {
      const todo = t.answers.filter(function (a) { return stageOf(t, a).todo; }).length;
      return h("button", {
        type: "button", class: "person-chip", "aria-pressed": String(t.id === current.id),
        onclick: function () { choose(t.id); }
      }, h("b", { text: t.name }), h("span", { text: (REL[t.relationship] || "") + (todo ? " · " + todo + " to do" : "") }));
    }));
  }

  function renderPerson(t) {
    const familyUrl = location.origin + "/family.html?f=" + t.familyToken;
    const stories = t.answers.slice().reverse(); // newest first
    const latest = stories[0];
    const older = stories.slice(1);
    return h("div", { class: "person" },
      h("header", { class: "person-head" },
        h("h1", { text: t.name }),
        h("p", { class: "meta", text: [REL[t.relationship], "asked by " + t.from, "started " + day(t.createdAt)].filter(Boolean).join(" · ") }),
        h("div", { class: "toolbar" },
          h("a", { class: "btn btn-secondary", href: familyUrl, target: "_blank", rel: "noopener" }, "Open family page ↗")),
        tellerLinkBox(t)),
      latest ? storyCard(t, latest, true) : h("p", { class: "lead", text: "No questions yet." }),
      older.length ? h("section", { class: "older" },
        h("h2", { text: "Older stories (" + older.length + ")" }),
        older.map(function (a) {
          const st = stageOf(t, a);
          return h("details", { class: "older-item" },
            h("summary", null, h("span", { class: "older-title", text: a.question }), h("span", { class: "pill " + st.tone, text: st.short })),
            storyCard(t, a, false));
        })) : null,
      photosCard(t),
      h("details", { class: "danger-zone" },
        h("summary", null, "More for " + t.name),
        lifeCard(t.lifeCard),
        filmUpload(t, null, t.media.filter(function (m) { return !m.answerId && (m.kind === "comic" || m.kind === "video"); }), "A finished film or comic page not tied to one story"),
        h("div", { class: "box" },
          h("p", { text: "Delete " + t.name + " and everything about them: all stories, recordings, comics, photos and both links. This can't be undone." }),
          h("button", { class: "btn btn-quiet danger", type: "button", disabled: busy === t.id + ":delete", onclick: function () { deletePerson(t); } }, "Delete " + t.name))));
  }

  // The storyteller's own private link (where they answer and tap "OK to use").
  function tellerUrlOf(t) { return location.origin + "/?t=" + t.tellerToken; }
  function tellerLinkBox(t, compact) {
    const url = tellerUrlOf(t);
    return h("div", { class: compact ? "teller-link compact" : "teller-link" },
      compact ? null : h("p", { class: "meta", text: t.name + "'s own link (where they answer and approve). Keep it private: it shows their stories before they approve them." }),
      compact ? null : h("div", { class: "link-box", text: url }),
      h("div", { class: "toolbar" },
        h("button", { class: "btn btn-secondary", type: "button", onclick: function (e) { copy(e.target, url); } }, "Copy " + t.name + "'s link"),
        h("a", { class: "btn btn-quiet", href: url, target: "_blank", rel: "noopener" }, "Open their page ↗")));
  }

  function day(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
  }

  // ---------- One story: where it is, and the one thing to do next ----------
  function panelsOf(t, a) {
    return t.media.filter(function (m) { return m.answerId === a.id && m.kind === "panel" && (m.status === "draft" || m.status === "published"); });
  }

  const FRESH_MS = 10 * 60 * 1000;
  function videoOf(t, a) {
    const vids = t.media.filter(function (m) { return m.answerId === a.id && m.appMade; });
    return vids[vids.length - 1] || null;
  }
  const narratorChoice = {};

  // Steps: 0 Answers, 1 Story, 2 OK to use, 3 Comic, 4 Video, 5 Family, 6 = all done.
  function stageOf(t, a) {
    const answered = (a.answeredParts || []).length;
    const total = (a.steps || []).length;
    if (a.status === "collecting") {
      if (!answered) return { step: 0, tone: "wait", short: "Not answered yet", text: t.name + " hasn't answered yet. Send them their link again if needed." };
      return { step: 0, tone: "todo", short: "Answered " + answered + "/" + total, todo: true, action: "write",
        text: t.name + " answered " + answered + " of " + total + " questions. Write the story from these answers now" + (answered < total ? ", or wait for the rest." : ".") };
    }
    if (a.status === "uploaded" || a.status === "processing") return { step: 1, tone: "wait", short: "Writing", text: "Writing the story… usually about a minute. This page refreshes by itself." };
    if (a.status === "failed") return { step: 1, tone: "bad", short: "Failed", todo: true, text: "The story couldn't be written. " + (a.error || ""), action: "retry" };
    if (a.approval === "hidden") return { step: 2, tone: "wait", short: "Private", text: t.name + " chose to keep this story private. Nothing to do." };
    if (a.approval !== "approved") return { step: 2, tone: "wait", short: "Waiting for OK", text: "The story is written. " + t.name + " now reads it on their link and taps “OK to use”. Then the comic and video are made automatically." };
    const panels = panelsOf(t, a);
    const comicLive = panels.some(function (m) { return m.status === "published"; });
    const pictures = ((a.comicScript || {}).panels || []).length;
    if (a.comicStatus === "drawing") {
      const minutes = Math.floor((Date.now() - Date.parse(a.comicStartedAt || 0)) / 60000);
      if (minutes >= 6) return { step: 3, tone: "bad", short: "Stuck", todo: true, action: "missing",
        text: "The drawing seems to have stopped (started " + minutes + " minutes ago). " + (panels.length ? panels.length + " of " + pictures + " pictures are drawn. " : "") + "Tap Try again." };
      return { step: 3, tone: "wait", short: "Drawing", text: "Drawing the comic… usually 1–3 minutes" + (a.comicError ? " (" + a.comicError + ")" : "") + ". The video is made right after. This page refreshes by itself." };
    }
    if (panels.length && panels.length < pictures) {
      return { step: 3, tone: "bad", short: panels.length + "/" + pictures + " pictures", todo: true, action: "missing",
        text: panels.length + " of " + pictures + " pictures are drawn. " + (a.comicError ? "Problem: " + a.comicError + ". " : "") + "Draw the missing ones." };
    }
    if (!panels.length) {
      if (!data.aiDrawing) return { step: 3, tone: "todo", short: "Needs comic", todo: true, text: "Automatic drawing is off (add GEMINI_API_KEY in Vercel). You can still upload your own pictures under “More options”." };
      return { step: 3, tone: "todo", short: "Draw comic", todo: true, text: a.comicStatus === "failed" ? "Drawing failed: " + (a.comicError || "") + " Try again." : "Approved! Draw the comic.", action: "draw" };
    }
    const partial = a.comicStatus === "partial" ? (a.comicError || "Some pictures couldn't be drawn.") : "";
    const v = videoOf(t, a);
    if (v && v.status === "rendering" && Date.now() - Date.parse(v.createdAt) < FRESH_MS) return { step: 4, tone: "wait", short: "Making video", text: "Making the animated video… usually 1–2 minutes. This page refreshes by itself." };
    const hasVideo = v && (v.status === "draft" || v.status === "published");
    if (!hasVideo) {
      if (comicLive) return { step: 6, tone: "good", short: "On family page", text: "Done. The family can see the comic.", action: "hide", extra: "video-too" };
      const failed = v && (v.status === "failed" || v.status === "rendering");
      return { step: 4, tone: failed ? "bad" : "todo", short: "Make video", todo: true, action: "video", partial: partial,
        text: failed ? "The video couldn't be made: " + (v.status === "failed" ? v.title || "" : "it took too long.") + " Try again."
          : "The comic is drawn. Check the pictures below (tap “Redraw” on any you don't like), then make the animated video." };
    }
    if (!comicLive || v.status !== "published") {
      return { step: 5, tone: "todo", short: "Send to family", todo: true, action: "publish", partial: partial,
        text: comicLive ? "The family has the comic. Watch the video below and send it too." : "Watch the video below. When you're happy, send the comic and the video to the family." };
    }
    return { step: 6, tone: "good", short: "On family page", text: "Done. The family can see the comic and the video.", action: "hide" };
  }

  function stepper(step) {
    const names = ["Answers", "Story", "OK to use", "Comic", "Video", "Family"];
    return h("ol", { class: "stepper", "aria-label": "Progress" }, names.map(function (n, i) {
      const state = i < step ? "done" : i === step ? "now" : "later";
      return h("li", { class: state, "aria-current": state === "now" ? "step" : null }, h("span", { class: "num", text: state === "done" ? "✓" : String(i + 1) }), n);
    }));
  }

  // Woman / man narrator for the parts without the storyteller's real voice.
  function narratorPicker(t, a) {
    const script = a.comicScript || {};
    const current = narratorChoice[a.id] || (script.storyteller_voice === "male" ? "male" : "female");
    const realVoice = a.allowVoice && !a.typed;
    return h("div", { class: "narrator" },
      h("span", { class: "meta", text: realVoice ? "Uses " + t.name + "'s real voice where we have it. Narrator for the rest:" : "Narrator voice:" }),
      h("div", { class: "chips" }, [["female", "Woman"], ["male", "Man"]].map(function (o) {
        return h("button", { type: "button", class: "chip", "aria-pressed": String(current === o[0]), onclick: function () { narratorChoice[a.id] = o[0]; render(); } }, o[1]);
      })));
  }

  function storyCard(t, a, isLatest) {
    const st = stageOf(t, a);
    const panels = panelsOf(t, a);
    const script = a.comicScript;
    const total = script ? (script.panels || []).length : 0;
    const hasPhotos = t.media.some(function (m) { return m.kind === "photo" && m.url; });
    const v = videoOf(t, a);
    const videoReady = v && v.url && (v.status === "draft" || v.status === "published");
    const next = [h("p", { class: "next-text", text: st.text })];
    if (st.partial) next.push(h("p", { class: "meta", text: st.partial }));
    if (st.action === "write") next.push(bigButton(busy === a.id ? "Starting…" : "Write the story now", busy === a.id, function () { retry(a, true); }));
    if (st.action === "retry") next.push(bigButton("Try again", busy === a.id, function () { retry(a); }));
    if (st.action === "draw") {
      if (!hasPhotos) next.push(h("p", { class: "meta", text: "Tip: add a photo of " + t.name + " below first, so the drawings look like them." }));
      next.push(bigButton(busy === a.id + ":draw" ? "Starting…" : "Draw the comic", busy === a.id + ":draw", function () { drawComic(a, null, 0); }));
    }
    if (st.action === "missing") next.push(bigButton(busy === a.id + ":draw" ? "Starting…" : (panels.length ? "Draw the missing pictures" : "Try again"), busy === a.id + ":draw", function () { drawMissing(a); }));
    if (st.action === "video") {
      next.push(narratorPicker(t, a));
      next.push(bigButton(busy === a.id + ":video" ? "Starting…" : "Make the animated video", busy === a.id + ":video", function () { makeVideo(a); }));
      next.push(h("button", { class: "btn btn-quiet", type: "button", disabled: busy === a.id + ":publish", onclick: function () { publishComic(a, true, panels.length, total, false); } }, "Skip the video, send only the comic"));
    }
    if (st.action === "publish") {
      next.push(bigButton("Send to the family", busy === a.id + ":publish", function () { publishComic(a, true, panels.length, total, true); }));
      if (videoReady && panels.some(function (m) { return Date.parse(m.createdAt) > Date.parse(v.createdAt); })) {
        next.push(h("p", { class: "meta", text: "Some pictures changed after this video was made. Remake it to include them." }));
      }
    }
    if (st.step === 2 && a.approval !== "hidden") next.push(tellerLinkBox(t, true));
    if (st.action === "hide") next.push(h("button", { class: "btn btn-quiet", type: "button", disabled: busy === a.id + ":publish", onclick: function () { publishComic(a, false); } }, "Hide it from the family"));
    if (st.extra === "video-too") next.push(h("button", { class: "btn btn-secondary", type: "button", disabled: busy === a.id + ":video", onclick: function () { makeVideo(a); } }, "Make an animated video too"));
    const notes = script && script.video_notes && script.video_notes.length ? script.video_notes : null;

    return h("article", { class: "card story-card" + (isLatest ? " latest" : "") },
      isLatest ? h("p", { class: "eyebrow", text: "Latest question" }) : null,
      h("h2", { class: "story-q", text: a.question }),
      a.title ? h("p", { class: "meta", text: "Story title: " + a.title }) : null,
      stepper(st.step),
      h("div", { class: "next " + st.tone }, h("p", { class: "eyebrow", text: st.todo ? "Your next step" : st.step === 6 ? "Finished" : "Status" }), next),
      videoReady ? h("div", { class: "video-box" },
        h("video", { src: v.url, controls: true, playsinline: true, preload: "metadata" }),
        notes ? h("p", { class: "meta", text: "Voice-over problem: " + notes.join("; ") }) : null,
        h("div", { class: "toolbar" },
          narratorPicker(t, a),
          h("button", { class: "btn btn-secondary", type: "button", disabled: busy === a.id + ":video", onclick: function () { makeVideo(a); } }, busy === a.id + ":video" ? "Starting…" : "Remake video"))) : null,
      script && panels.length ? panelGrid(t, a, script, panels, st) : null,
      a.story ? h("details", { class: "fold" }, h("summary", null, "Read the story"), h("p", { class: "story-text", text: a.story })) : null,
      moreOptions(t, a, script, panels));
  }

  function bigButton(label, disabled, onclick) {
    return h("button", { class: "btn btn-primary btn-big", type: "button", disabled: disabled, onclick: onclick }, label);
  }

  function panelGrid(t, a, script, panels, st) {
    const drawing = a.comicStatus === "drawing";
    return h("div", { class: "panel-grid" }, (script.panels || []).map(function (p, i) {
      const image = panels.filter(function (m) { return m.panelIndex === i && m.url; }).pop();
      return h("figure", { class: "sp" },
        image ? h("img", { src: image.url, alt: "Picture " + (i + 1) }) : h("div", { class: "sp-empty", text: "No picture yet" }),
        h("figcaption", null,
          h("span", { class: "sp-cap", text: (i + 1) + ". " + p.caption }),
          h("div", { class: "sp-actions" },
            data.aiDrawing ? h("button", { class: "btn btn-secondary", type: "button", disabled: drawing, onclick: function () { drawComic(a, i); } }, image ? "Redraw" : "Draw") : null,
            fileButton("Use my own", "image/png,image/jpeg,image/webp", busy === a.id + ":panel:" + i, function (f) { uploadPanel(t, a, i, f); }))));
    }));
  }

  // A plain button that opens the file picker and uploads as soon as a file is chosen.
  function fileButton(label, accept, isBusy, onFile, kind) {
    const input = h("input", { type: "file", accept: accept, class: "hidden-file", tabindex: "-1", "aria-hidden": "true" });
    input.addEventListener("change", function () { if (input.files && input.files[0]) onFile(input.files[0]); });
    return h("span", { class: "file-btn" }, input,
      h("button", { class: "btn " + (kind || "btn-quiet"), type: "button", disabled: isBusy, onclick: function () { input.click(); } }, isBusy ? "Uploading…" : label));
  }

  function moreOptions(t, a, script, panels) {
    const steps = a.steps || [];
    const done = new Set(a.answeredParts || []);
    const items = [
      h("div", { class: "box" }, h("b", { text: "The " + steps.length + " questions " + t.name + " answers" }),
        h("ol", null, steps.map(function (q, i) { return h("li", { class: done.has(i) ? "answered" : "", text: q + (done.has(i) ? "  ✓" : "") }); })))
    ];
    if (a.status === "ready" || a.status === "failed") {
      items.push(h("div", { class: "box" }, h("b", { text: "Rewrite the story" }),
        h("p", { class: "meta", text: "Writes the story again from the same answers. " + t.name + " will need to approve it again." }),
        h("button", { class: "btn btn-secondary", type: "button", disabled: busy === a.id, onclick: function () { retry(a); } }, "Rewrite")));
    }
    if (script) {
      const sheet = t.media.filter(function (m) { return m.kind === "sheet" && m.answerId === a.id && m.url; }).pop();
      items.push(h("div", { class: "box" }, h("b", { text: "Comic" }),
        h("p", { class: "meta", text: "Voice: " + (a.typed ? "typed answers, no voice." : a.allowVoice ? t.name + " allowed their voice in this comic." : t.name + " has not allowed their voice.") }),
        data.aiDrawing && panels.length ? h("button", { class: "btn btn-secondary", type: "button", disabled: a.comicStatus === "drawing", onclick: function () { drawComic(a, null, panels.length); } }, "Redraw the whole comic") : null,
        sheet ? h("a", { class: "btn btn-quiet", href: sheet.url, target: "_blank", rel: "noopener" }, "See the character sheet ↗") : null,
        h("p", { class: "meta", text: "Drawing by hand in Gemini instead? Copy a prompt, make the picture there, then tap “Use my own” on that picture." }),
        h("div", { class: "toolbar" },
          (script.panels || []).map(function (_, i) {
            return h("button", { class: "btn btn-quiet", type: "button", onclick: function (e) { copy(e.target, panelPrompt(script, i)); } }, "Copy prompt " + (i + 1));
          }),
          h("button", { class: "btn btn-quiet", type: "button", onclick: function (e) { copy(e.target, characterSheetPrompt(script)); } }, "Copy character-sheet prompt"))));
      const other = t.media.filter(function (m) { return m.answerId === a.id && !m.appMade && (m.kind === "comic" || m.kind === "video"); });
      items.push(filmUpload(t, a, other, "A finished film or one-page comic for this story"));
    }
    items.push(h("div", { class: "box" }, h("b", { text: "Delete this story" }),
      h("p", { class: "meta", text: "Deletes the answers, recordings, story and pictures. Can't be undone." }),
      h("button", { class: "btn btn-quiet danger", type: "button", disabled: busy === a.id + ":del", onclick: function () { deleteStoryAll(t, a); } }, "Delete story")));
    return h("details", { class: "fold" }, h("summary", null, "More options"), items);
  }

  function photosCard(t) {
    const photos = t.media.filter(function (m) { return m.kind === "photo" && m.url; });
    const key = t.id + ":photo";
    return h("section", { class: "card photos" },
      h("h2", { text: "Photos of " + t.name + " (optional)" }),
      h("p", { class: "meta", text: "Only used so the drawings look like them. The family never sees these. Clear, front-facing photos work best; the newest 3 are used." }),
      photos.length ? h("div", { class: "thumbs" }, photos.map(function (m) {
        return h("div", { class: "thumb" }, h("img", { src: m.url, alt: m.title || "photo" }),
          h("div", null, h("span", { text: m.title || "" }),
            h("button", { class: "btn btn-quiet danger", type: "button", onclick: function () { removeMedia(m, "Delete this photo?"); } }, "Delete")));
      })) : null,
      fileButton(photos.length ? "Add another photo" : "Add a photo", "image/png,image/jpeg,image/webp", busy === key, function (f) { uploadPhoto(t, f, key); }, "btn-secondary"));
  }

  function lifeCard(card) {
    const keys = ["people", "places", "times", "objects", "appearance", "phrases", "traits"];
    const filled = keys.filter(function (k) { return card && card[k] && card[k].length; });
    if (!filled.length) return null;
    return h("div", { class: "box" }, h("b", { text: "What we know (from approved stories)" }),
      h("div", { class: "grid" }, filled.map(function (k) {
        return h("div", null, h("span", { class: "meta", text: k }), h("ul", null, card[k].map(function (item) {
          return h("li", { text: typeof item === "string" ? item : Object.values(item).filter(Boolean).join(" — ") });
        })));
      })));
  }

  function filmUpload(t, a, media, label) {
    const key = (a ? a.id : t.id) + ":upload";
    return h("div", { class: "box" }, h("b", { text: label }),
      media.length ? h("div", { class: "thumbs" }, media.map(function (m) {
        return h("div", { class: "thumb" },
          m.url ? (m.kind === "video" ? h("video", { src: m.url, muted: true, preload: "metadata" }) : h("img", { src: m.url, alt: m.title || "" })) : null,
          h("div", null, h("span", { text: (m.title || m.kind) + (m.status !== "published" ? " (unfinished)" : "") }),
            h("button", { class: "btn btn-quiet danger", type: "button", onclick: function () { removeMedia(m); } }, "Delete")));
      })) : null,
      h("p", { class: "meta", text: "It goes straight to the family page." }),
      fileButton("Upload image or video", "image/png,image/jpeg,image/webp,video/mp4,video/webm", busy === key, function (f) { upload(t, a, f, key); }, "btn-secondary"));
  }

  // ---------- Prompts for drawing by hand ----------
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

  // ---------- Actions ----------
  async function putFile(slot, f) {
    const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": f.type, "x-upsert": "false" }, body: f });
    if (!put.ok) throw new Error("Upload failed: " + put.status);
    await api("POST", { action: "media-publish", mediaId: slot.mediaId });
  }

  async function uploadPhoto(t, f, key) {
    busy = key; render();
    try { await putFile(await api("POST", { action: "media-upload-url", storytellerId: t.id, kind: "photo", mime: f.type, title: "" }), f); }
    catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function uploadPanel(t, a, index, f) {
    busy = a.id + ":panel:" + index; render();
    try { await putFile(await api("POST", { action: "media-upload-url", storytellerId: t.id, answerId: a.id, kind: "panel", panelIndex: index, mime: f.type }), f); }
    catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function upload(t, a, f, key) {
    busy = key; render();
    try {
      await putFile(await api("POST", {
        action: "media-upload-url", storytellerId: t.id, answerId: a ? a.id : null,
        kind: f.type.indexOf("video") === 0 ? "video" : "comic", mime: f.type, title: ""
      }), f);
    } catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function drawComic(a, panelIndex, have) {
    if (panelIndex === null && have && !confirm("Redraw all pictures? The current ones will be replaced.")) return;
    busy = a.id + ":draw"; render();
    try { await api("POST", { action: "comic-draw", answerId: a.id, panelIndex: panelIndex }); }
    catch (e) { alert(e.message); }
    busy = ""; setTimeout(load, 800);
  }

  async function publishComic(a, publish, have, total, withVideo) {
    if (publish && have < total && !confirm(have + " of " + total + " pictures are ready. Send anyway?")) return;
    busy = a.id + ":publish"; render();
    try { await api("POST", { action: "comic-publish", answerId: a.id, publish: publish, withVideo: withVideo !== false }); } catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function drawMissing(a) {
    busy = a.id + ":draw"; render();
    try { await api("POST", { action: "comic-draw", answerId: a.id, missing: true }); }
    catch (e) { alert(e.message); }
    busy = ""; setTimeout(load, 800);
  }

  async function makeVideo(a) {
    const script = a.comicScript || {};
    const narrator = narratorChoice[a.id] || (script.storyteller_voice === "male" ? "male" : "female");
    busy = a.id + ":video"; render();
    try { await api("POST", { action: "video-make", answerId: a.id, narrator: narrator }); } catch (e) { alert(e.message); }
    busy = ""; setTimeout(load, 800);
  }

  async function retry(a, now) {
    if (now && (a.answeredParts || []).length < (a.steps || []).length &&
      !confirm("Not every question is answered yet. Write the story from the answers so far? The storyteller can't add more answers to this story after that.")) return;
    busy = a.id; render();
    try { await api("POST", { action: "retry", answerId: a.id }); } catch (e) { alert(e.message); }
    busy = ""; setTimeout(load, 1500);
  }

  async function removeMedia(m, question) {
    if (!confirm(question || "Delete this from the family page?")) return;
    try { await api("POST", { action: "media-delete", mediaId: m.id }); } catch (e) { alert(e.message); }
    load();
  }

  async function deleteStoryAll(t, a) {
    if (!confirm("Delete the story “" + a.question + "”? Its answers, recordings and pictures are deleted for good.")) return;
    busy = a.id + ":del"; render();
    try { await api("POST", { action: "story-delete", answerId: a.id }); } catch (e) { alert(e.message); }
    busy = ""; load();
  }

  async function deletePerson(t) {
    const typed = prompt("This deletes " + t.name + ", all their stories, recordings, comics and photos, for good. Their links stop working.\n\nType DELETE to confirm.");
    if (!typed || typed.trim().toUpperCase() !== "DELETE") return;
    busy = t.id + ":delete"; render();
    try { await api("POST", { action: "person-delete", storytellerId: t.id }); } catch (e) { alert(e.message); }
    busy = "";
    if (selected === t.id) selected = "";
    load();
  }

  render();
  if (password) load();
})();
