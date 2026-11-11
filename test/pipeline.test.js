import { test } from "node:test";
import assert from "node:assert/strict";
import { findClip, mergeLifeCard } from "../api/_lib/pipeline.js";
import { STORY_SCHEMA, STEPS_SCHEMA, fallbackSteps } from "../api/_lib/ai.js";
import { normalizeSupabaseUrl } from "../api/_lib/store.js";
import { startTestServer } from "./test-server.js";
import { SAMPLE_STEPS } from "./fake-store.js";

test("findClip locates the quoted words and their times", () => {
  const words = "Я родилась в ауле у реки у нас был белый дом".split(" ").map((w, i) => ({ text: w, start: i, end: i + 0.5 }));
  const clip = findClip(words, "у нас был белый дом");
  assert.equal(clip.start, 6);
  assert.equal(clip.end, 10.5);
  assert.equal(findClip(words, "совсем другие слова здесь"), null);
});

test("mergeLifeCard adds new details and skips repeats", () => {
  const a = mergeLifeCard({}, { people: [{ name: "Мама", relation: "mother", note: "" }], phrases: ["Ну вот!"] });
  const b = mergeLifeCard(a, { people: [{ name: "мама", relation: "mother", note: "x" }, { name: "Папа", relation: "father", note: "" }], phrases: ["ну вот!"] });
  assert.deepEqual(b.people.map((p) => p.name), ["Мама", "Папа"]);
  assert.equal(b.phrases.length, 1);
});

test("Supabase URL is cleaned from common copy-paste forms", () => {
  const ok = "https://abcd1234.supabase.co";
  for (const raw of [ok, ok + "/", ok + "/rest/v1/", ` ${ok}/rest/v1 `, "abcd1234.supabase.co", "https://supabase.com/dashboard/project/abcd1234/settings/api"]) {
    assert.equal(normalizeSupabaseUrl(raw), ok, raw);
  }
});

test("story schema follows structured-output rules", () => {
  (function walk(node, path) {
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false, path + " needs additionalProperties:false");
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path + " must require every property");
      for (const [k, v] of Object.entries(node.properties)) walk(v, path + "." + k);
    }
    if (node.type === "array") walk(node.items, path + "[]");
  })(STORY_SCHEMA, "root");
});


// Small helpers shared by the end-to-end tests.
function client(url) {
  const post = (path, body, headers = {}) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const get = (path, headers = {}) => fetch(url + path, { headers }).then((r) => r.json());
  const waitFor = async (check, tries = 200) => { for (let i = 0; i < tries && !(await check()); i++) await new Promise((r) => setTimeout(r, 30)); };
  const tokens = (created) => ({ t: new URL(created.tellerUrl).searchParams.get("t"), f: new URL(created.familyUrl).searchParams.get("f") });
  const latestStory = async (t) => { const v = await get(`/api/teller?t=${t}`); return v.stories[v.stories.length - 1]; };
  return { post, get, waitFor, tokens, latestStory };
}
const DREAM = { relationship: "parent", mainKey: "p01", mainQuestion: "Кем вы мечтали стать в детстве?" };

test("lead-up questions schema follows structured-output rules", () => {
  assert.equal(STEPS_SCHEMA.additionalProperties, false);
  assert.deepEqual(STEPS_SCHEMA.required, Object.keys(STEPS_SCHEMA.properties));
  for (const lang of ["ru", "kk", "en"]) {
    assert.equal(fallbackSteps(lang, "parent").length, 5);
    assert.equal(fallbackSteps(lang, "friend").length, 5);
  }
  assert.match(fallbackSteps("ru", "parent").join(" "), /вы|Вы/);
});

test("full flow: choose a question → answer the lead-up questions → one story → approve → family sees only media", async () => {
  const { server, store, apiLog, url } = await startTestServer(8799);
  const { post, get, waitFor, tokens } = client(url);
  try {
    // The asker must say who the person is and pick a question.
    assert.equal((await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", mainKey: "p01", mainQuestion: "Q" })).status, 400);
    assert.equal((await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", relationship: "parent" })).status, 400);

    const created = await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", ...DREAM });
    assert.equal(created.status, 200);
    assert.equal(created.body.mainQuestion, DREAM.mainQuestion);
    assert.deepEqual(created.body.steps, SAMPLE_STEPS, "the asker sees the lead-up questions");
    const stepsCall = apiLog.find((c) => c.service === "anthropic");
    assert.match(stepsCall.body.messages[0].content, /Кем вы мечтали стать в детстве/);
    const { t, f } = tokens(created.body);
    assert.equal(store.db.storytellers[0].relationship, "parent");

    let view = await get(`/api/teller?t=${t}`);
    assert.equal(view.stories.length, 1);
    const story = view.stories[0];
    assert.equal(story.main, DREAM.mainQuestion);
    assert.equal(story.status, "collecting");
    assert.deepEqual(story.steps, SAMPLE_STEPS);
    assert.deepEqual(story.answeredParts, []);

    // Part 1 by voice.
    assert.equal((await post("/api/teller", { t, action: "upload-url", answerId: story.id, partIndex: 9, mime: "audio/webm" })).status, 400);
    const slot = await post("/api/teller", { t, action: "upload-url", answerId: story.id, partIndex: 0, mime: "audio/webm" });
    assert.equal(slot.status, 200);
    assert.equal((await fetch(slot.body.uploadUrl, { method: "PUT", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) })).status, 200);
    assert.equal((await post("/api/teller", { t, action: "uploaded", partId: slot.body.partId, durationSec: 12.4 })).status, 200);
    await waitFor(() => store.db.parts.find((p) => p.id === slot.body.partId)?.status === "ready");
    assert.equal(store.db.parts.find((p) => p.id === slot.body.partId).transcript.includes("ставнями"), true);

    // Part 3 typed, then typed again: only the newest answer is kept.
    await post("/api/teller", { t, action: "text-answer", answerId: story.id, partIndex: 2, text: "Первый вариант" });
    await post("/api/teller", { t, action: "text-answer", answerId: story.id, partIndex: 2, text: "Хотела стать врачом, как тётя." });
    assert.equal(store.db.parts.filter((p) => p.part_index === 2).length, 1);
    view = await get(`/api/teller?t=${t}`);
    assert.deepEqual(view.stories[0].answeredParts, [0, 2]);

    // Family sees its question and progress, never the answers.
    let fam = await get(`/api/family?f=${f}`);
    assert.deepEqual(fam.asked, [{ main: DREAM.mainQuestion, key: "p01", answered: 2, total: 5, stage: "answering" }]);
    assert.equal(fam.relationship, "parent");
    assert.equal(JSON.stringify(fam).includes("врачом"), false);
    assert.equal(fam.tellerUrl, created.body.tellerUrl);

    // "Write my story": one story from both answers.
    assert.equal((await post("/api/teller", { t, action: "finish", answerId: story.id })).status, 200);
    await waitFor(() => store.db.answers[0].status === "ready");
    const answer = store.db.answers[0];
    assert.equal(answer.status, "ready", answer.error || "");
    assert.equal(answer.title, "Белый дом у реки");
    const storyCall = apiLog.filter((c) => c.service === "anthropic").at(-1);
    assert.ok(storyCall.body.output_config.format.schema.properties.comic);
    const prompt = storyCall.body.messages[0].content;
    assert.match(prompt, /Кем вы мечтали стать в детстве/);
    assert.match(prompt, /Answer 1 \(spoken/);
    assert.match(prompt, /Answer 2 \(written/);
    assert.match(prompt, /белый дом с синими ставнями/);
    assert.match(prompt, /врачом, как тётя/);
    assert.doesNotMatch(prompt, /Первый вариант/, "replaced answers are not used");
    assert.equal(answer.comic_script.panels[0].voice_clip.part_id, slot.body.partId, "clip found in the spoken part");
    assert.equal(store.db.storytellers[0].life_card.people[0].name, "Мама");

    // Once written, the answers are locked.
    assert.equal((await post("/api/teller", { t, action: "text-answer", answerId: story.id, partIndex: 1, text: "Ещё" })).status, 409);
    fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.asked[0].stage, "reviewing");
    assert.equal(fam.collected, 1);
    assert.equal(JSON.stringify(fam).includes("ставнями"), false, "family must never get story text");

    const teller = await get(`/api/teller?t=${t}`);
    assert.equal(teller.stories[0].story.includes("синими ставнями"), true);
    assert.equal(teller.stories[0].typed, false);

    const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
    assert.equal((await fetch(`${url}/api/studio`)).status, 401);
    let studio = await get("/api/studio", auth);
    assert.equal(studio.storytellers[0].answers[0].story, null, "studio must not see unapproved story");
    assert.deepEqual(studio.storytellers[0].answers[0].answeredParts, [0, 2]);
    assert.equal(JSON.stringify(studio).includes("ставнями"), false);
    assert.equal(JSON.stringify(studio).includes("врачом"), false);
    const blocked = await post("/api/studio", { action: "media-upload-url", storytellerId: answer.storyteller_id, answerId: answer.id, kind: "comic", mime: "image/png" }, auth);
    assert.equal(blocked.status, 400);

    assert.equal((await post("/api/teller", { t, action: "approve", answerId: answer.id, approval: "approved" })).status, 200);
    studio = await get("/api/studio", auth);
    assert.ok(studio.storytellers[0].answers[0].comicScript.panels.length >= 1);
    assert.equal(JSON.stringify(studio).includes("audio_path"), false, "studio never gets recordings");

    const m = await post("/api/studio", { action: "media-upload-url", storytellerId: answer.storyteller_id, answerId: answer.id, kind: "comic", mime: "image/png", title: "Дом у реки" }, auth);
    assert.equal(m.status, 200);
    await fetch(m.body.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) });
    assert.equal((await post("/api/studio", { action: "media-publish", mediaId: m.body.mediaId }, auth)).status, 200);
    fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.media.length, 1);
    assert.equal(fam.asked[0].stage, "approved");

    // Wrong tokens and other people's stories are rejected.
    assert.equal((await fetch(`${url}/api/teller?t=nope`)).status, 404);
    const other = await post("/api/create", { from: "A", name: "B", lang: "kk", relationship: "friend", mainKey: "f01", mainQuestion: "Q?" });
    const t2 = tokens(other.body).t;
    assert.equal((await post("/api/teller", { t: t2, action: "delete", answerId: answer.id })).status, 404);
    assert.equal((await post("/api/teller", { t: t2, action: "uploaded", partId: slot.body.partId })).status, 404);

    // Deleting removes the recordings and the parts too.
    assert.equal((await post("/api/teller", { t, action: "delete", answerId: answer.id })).status, 200);
    assert.equal([...store.files.keys()].some((k) => k.startsWith("recordings/")), false);
    assert.equal(store.db.parts.filter((p) => p.answer_id === answer.id).length, 0);
  } finally {
    server.close();
  }
});

test("typed story with your own question: no transcription, written in Kazakh from the text", async () => {
  const { server, store, apiLog, url } = await startTestServer(8798);
  const { post, waitFor, tokens, latestStory } = client(url);
  try {
    const created = await post("/api/create", { from: "Мухамед", name: "Ата", lang: "kk", relationship: "parent", mainKey: "<script>", mainQuestion: "  Сіз неден қорқатын едіңіз?  " });
    assert.equal(created.status, 200);
    assert.equal(created.body.mainQuestion, "Сіз неден қорқатын едіңіз?");
    assert.equal(store.db.answers[0].main_key, "custom");
    const { t } = tokens(created.body);
    const s = await latestStory(t);

    assert.equal((await post("/api/teller", { t, action: "finish", answerId: s.id })).status, 400, "nothing answered yet");
    assert.equal((await post("/api/teller", { t, action: "text-answer", answerId: s.id, partIndex: 1, text: "   " })).status, 400);
    assert.equal((await post("/api/teller", { t, action: "text-answer", answerId: s.id, partIndex: 1, text: "Мен ауылда тудым.\r\nҮйіміз ақ еді." })).status, 200);
    assert.equal((await post("/api/teller", { t, action: "finish", answerId: s.id })).status, 200);

    await waitFor(() => store.db.answers[0].status === "ready");
    const a = store.db.answers[0];
    assert.equal(a.status, "ready", a.error || "");
    assert.equal(a.transcript, "Мен ауылда тудым.\nҮйіміз ақ еді.");
    assert.equal(apiLog.filter((c) => c.service === "elevenlabs").length, 0, "typed answers must not be transcribed");
    const prompt = apiLog.filter((c) => c.service === "anthropic").at(-1).body.messages[0].content;
    assert.match(prompt, /Kazakh/);
    assert.match(prompt, /Сіз неден қорқатын едіңіз/);
    assert.match(prompt, /Үйіміз ақ еді/);
    assert.equal((await latestStory(t)).typed, true);
    // Finishing twice does nothing.
    assert.equal((await post("/api/teller", { t, action: "finish", answerId: s.id })).status, 200);
  } finally {
    server.close();
  }
});

test("family asks another question on the same link; lead-up questions fall back when the AI fails", async () => {
  const { server, store, url } = await startTestServer(8795);
  const { post, get, tokens } = client(url);
  try {
    const created = await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", ...DREAM });
    const { t, f } = tokens(created.body);

    assert.equal((await post("/api/family", { f: "nope", action: "ask", mainKey: "p02", mainQuestion: "Q" })).status, 404);
    assert.equal((await post("/api/family", { f, action: "ask", mainKey: "p02", mainQuestion: "" })).status, 400);

    globalThis.__CLAUDE_STEPS_FAIL__ = true;
    const asked = await post("/api/family", { f, action: "ask", mainKey: "p02", mainQuestion: "Вы счастливы, как сложилась ваша жизнь?" });
    globalThis.__CLAUDE_STEPS_FAIL__ = false;
    assert.equal(asked.status, 200);
    assert.equal(asked.body.tellerUrl, created.body.tellerUrl, "same link for the storyteller");
    assert.deepEqual(asked.body.steps, fallbackSteps("ru", "parent"));

    const view = await get(`/api/teller?t=${t}`);
    assert.equal(view.stories.length, 2);
    assert.equal(view.stories[1].main, "Вы счастливы, как сложилась ваша жизнь?");
    assert.deepEqual(store.db.answers.map((a) => a.question_index), [0, 1]);
    const fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.asked.length, 2);

    // A storyteller made before relationships existed gets one when the family asks.
    store.db.storytellers[0].relationship = null;
    await post("/api/family", { f, action: "ask", relationship: "partner", mainKey: "r01", mainQuestion: "Как мы познакомились?" });
    assert.equal(store.db.storytellers[0].relationship, "partner");
  } finally {
    globalThis.__CLAUDE_STEPS_FAIL__ = false;
    server.close();
  }
});

test("comic panels: voice clip only when allowed, gone when voice is off or story hidden", async () => {
  const { execFileSync } = await import("node:child_process");
  const ffmpeg = (await import("ffmpeg-static")).default;
  // 10 seconds of real Opus audio, like a phone recording.
  const audio = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=10", "-c:a", "libopus", "-f", "webm", "pipe:1"], { maxBuffer: 1 << 24 });

  const { server, store, url } = await startTestServer(8797);
  const { post, get, waitFor, tokens, latestStory } = client(url);
  try {
    const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
    const created = await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", ...DREAM });
    const { t, f } = tokens(created.body);
    const id = (await latestStory(t)).id;
    const slot = await post("/api/teller", { t, action: "upload-url", answerId: id, partIndex: 0, mime: "audio/webm" });
    await fetch(slot.body.uploadUrl, { method: "PUT", headers: { "content-type": "audio/webm" }, body: audio });
    await post("/api/teller", { t, action: "uploaded", partId: slot.body.partId, durationSec: 10 });
    await post("/api/teller", { t, action: "finish", answerId: id });
    await waitFor(() => store.db.answers[0].status === "ready");
    assert.equal(store.db.answers[0].status, "ready", store.db.answers[0].error || "");

    // Approved, voice not allowed yet: no clips.
    await post("/api/teller", { t, action: "approve", answerId: id, approval: "approved" });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(store.db.answers[0].comic_script.panels.some((p) => p.clip_path), false);

    // Studio uploads both panels, then publishes the comic.
    const teller = store.db.storytellers[0];
    for (const i of [0, 1]) {
      const m = await post("/api/studio", { action: "media-upload-url", storytellerId: teller.id, answerId: id, kind: "panel", panelIndex: i, mime: "image/png" }, auth);
      assert.equal(m.status, 200, JSON.stringify(m.body));
      await fetch(m.body.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71, i]) });
      await post("/api/studio", { action: "media-publish", mediaId: m.body.mediaId }, auth);
    }
    assert.equal((await post("/api/studio", { action: "media-upload-url", storytellerId: teller.id, answerId: id, kind: "panel", panelIndex: 9, mime: "image/png" }, auth)).status, 400);
    let fam = await get(`/api/family?f=${f}`);
    assert.deepEqual(fam.comics, [], "draft panels are not shown");
    assert.equal((await post("/api/studio", { action: "comic-publish", answerId: id, publish: true }, auth)).status, 200);

    fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.comics.length, 1);
    assert.equal(fam.comics[0].panels.length, 2);
    assert.equal(fam.comics[0].panels[0].caption, "Дом у реки");
    assert.equal(fam.comics[0].panels[0].clipUrl, null, "no voice until the storyteller allows it");

    // Replacing panel 1 keeps exactly one image for it, still published.
    const r = await post("/api/studio", { action: "media-upload-url", storytellerId: teller.id, answerId: id, kind: "panel", panelIndex: 0, mime: "image/png" }, auth);
    await fetch(r.body.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([9]) });
    await post("/api/studio", { action: "media-publish", mediaId: r.body.mediaId }, auth);
    assert.equal(store.db.media.filter((m) => m.panel_index === 0).length, 1);
    assert.equal(store.db.media.find((m) => m.panel_index === 0).status, "published");

    // Storyteller allows voice → clips are cut from the part's recording.
    await post("/api/teller", { t, action: "voice", answerId: id, allow: true });
    await waitFor(() => store.db.answers[0].comic_script.panels.every((p) => p.clip_path));
    const panels = store.db.answers[0].comic_script.panels;
    assert.ok(panels.every((p) => p.clip_path), "both panels get a clip");
    const clip = store.files.get("media/" + panels[0].clip_path);
    assert.equal(clip.type, "audio/mp4");
    assert.ok(clip.data.length > 500, "clip has audio");
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmp = join(mkdtempSync(join(tmpdir(), "cliptest-")), "c.m4a");
    writeFileSync(tmp, clip.data);
    let info = "";
    try { execFileSync(ffmpeg, ["-hide_banner", "-i", tmp], { stdio: "pipe" }); } catch (e) { info = String(e.stderr); }
    const dur = info.match(/Duration: 00:00:(\d+\.\d+)/);
    assert.ok(dur && Number(dur[1]) > 2 && Number(dur[1]) < 5, "clip length " + (dur && dur[1]));

    fam = await get(`/api/family?f=${f}`);
    assert.ok(fam.comics[0].panels[0].clipUrl, "family hears the allowed clip");
    assert.equal(JSON.stringify(fam).includes("recordings/"), false, "full recording is never shared");
    const studio = await get("/api/studio", auth);
    assert.equal(JSON.stringify(studio).includes("clip_path"), false);

    // Voice off → clips deleted.
    await post("/api/teller", { t, action: "voice", answerId: id, allow: false });
    await waitFor(() => !store.db.answers[0].comic_script.panels.some((p) => p.clip_path));
    assert.equal([...store.files.keys()].some((k) => k.includes("/clips/")), false);
    fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.comics[0].panels[0].clipUrl, null);

    // Story hidden → comic disappears from the family page.
    await post("/api/teller", { t, action: "approve", answerId: id, approval: "hidden" });
    fam = await get(`/api/family?f=${f}`);
    assert.deepEqual(fam.comics, []);
    assert.equal(fam.asked[0].stage, "private");

    // A typed story can't turn voice on.
    await post("/api/family", { f, action: "ask", mainKey: "p02", mainQuestion: "Q2" });
    const typedId = (await latestStory(t)).id;
    await post("/api/teller", { t, action: "text-answer", answerId: typedId, partIndex: 0, text: "Текст" });
    assert.equal((await post("/api/teller", { t, action: "voice", answerId: typedId, allow: true })).status, 400);

    // Deleting removes panels too.
    await post("/api/teller", { t, action: "delete", answerId: id });
    assert.equal(store.db.media.filter((m) => m.answer_id === id).length, 0);
  } finally {
    server.close();
  }
});

test("automatic comics: approval draws a sheet and panels with the photos, redraw one panel, auto-publish", async () => {
  const { server, store, apiLog, url } = await startTestServer(8796);
  process.env.GEMINI_API_KEY = "test-gemini";
  try {
    const post = (path, body, headers = {}) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
    const waitFor = async (check) => { for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 30)); };
    const gemini = () => apiLog.filter((c) => c.service === "gemini");

    const { latestStory } = client(url);
    const typedStory = async (t, text) => {
      const s = await latestStory(t);
      await post("/api/teller", { t, action: "text-answer", answerId: s.id, partIndex: 0, text });
      await post("/api/teller", { t, action: "finish", answerId: s.id });
      return s.id;
    };
    const created = await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", ...DREAM });
    const t = new URL(created.body.tellerUrl).searchParams.get("t");
    const f = new URL(created.body.familyUrl).searchParams.get("f");
    const teller = store.db.storytellers[0];

    // Studio adds a reference photo (a real small JPEG made with ffmpeg).
    const { execFileSync } = await import("node:child_process");
    const ffmpeg = (await import("ffmpeg-static")).default;
    const jpeg = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=2000x1500", "-frames:v", "1", "-f", "mjpeg", "pipe:1"], { maxBuffer: 1 << 24 });
    const ph = await post("/api/studio", { action: "media-upload-url", storytellerId: teller.id, kind: "photo", mime: "image/jpeg", title: "Мама, 1985" }, auth);
    assert.equal(ph.status, 200, JSON.stringify(ph.body));
    await fetch(ph.body.uploadUrl, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: jpeg });
    await post("/api/studio", { action: "media-publish", mediaId: ph.body.mediaId }, auth);
    assert.equal(store.db.media.find((m) => m.kind === "photo").status, "reference");

    const id = await typedStory(t, "Я родилась в ауле у реки.");
    await waitFor(() => store.db.answers[0].status === "ready");
    assert.equal(gemini().length, 0, "nothing is drawn before approval");

    // Approval starts drawing: 1 character sheet + 2 panels.
    await post("/api/teller", { t, action: "approve", answerId: id, approval: "approved" });
    await waitFor(() => ["ready", "partial", "failed"].includes(store.db.answers[0].comic_status));
    const a = store.db.answers[0];
    assert.equal(a.comic_status, "ready", a.comic_error || "");
    assert.equal(gemini().length, 3);
    const [sheetCall, ...panelCalls] = gemini();
    assert.match(sheetCall.body.contents[0].parts[0].text, /character reference sheet/);
    assert.equal(sheetCall.body.generationConfig.imageConfig.aspectRatio, "3:2");
    assert.equal(sheetCall.body.contents[0].parts.length, 2, "sheet gets the photo");
    const sentPhoto = Buffer.from(sheetCall.body.contents[0].parts[1].inlineData.data, "base64");
    assert.ok(sentPhoto.length < jpeg.length, "photo is shrunk before sending");
    for (const c of panelCalls) {
      const text = c.body.contents[0].parts[0].text;
      assert.match(text, /no text of any kind/);
      assert.match(text, /Image 1 is the character sheet/);
      assert.match(text, /"Narrator as a girl"'s face/);
      assert.equal(c.body.contents[0].parts.length, 3, "panel gets sheet + photo");
      assert.equal(c.body.generationConfig.imageConfig.aspectRatio, "4:3");
    }
    const panels = () => store.db.media.filter((m) => m.answer_id === id && m.kind === "panel");
    assert.deepEqual(panels().map((m) => m.panel_index).sort(), [0, 1]);
    assert.ok(panels().every((m) => m.status === "draft"), "drafts until the studio publishes");
    assert.equal(store.db.media.filter((m) => m.kind === "sheet").length, 1);

    // Family sees nothing yet, and never the photo or the sheet.
    let fam = await (await fetch(`${url}/api/family?f=${f}`)).json();
    assert.deepEqual(fam.comics, []);
    assert.deepEqual(fam.media, []);

    // Approving again does not redraw.
    await post("/api/teller", { t, action: "approve", answerId: id, approval: "approved" });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(gemini().length, 3);

    // Redraw panel 2 only: one more call, reusing the saved sheet; only that panel is replaced.
    const keep = panels().find((m) => m.panel_index === 0).id;
    assert.equal((await post("/api/studio", { action: "comic-draw", answerId: id, panelIndex: 1 }, auth)).status, 200);
    await waitFor(() => gemini().length === 4 && store.db.answers[0].comic_status === "ready");
    assert.equal(gemini().length, 4);
    assert.equal(panels().length, 2);
    assert.equal(panels().find((m) => m.panel_index === 0).id, keep);

    // Publish; then a redraw of a live comic stays live.
    await post("/api/studio", { action: "comic-publish", answerId: id, publish: true }, auth);
    fam = await (await fetch(`${url}/api/family?f=${f}`)).json();
    assert.equal(fam.comics[0].panels.length, 2);
    await post("/api/studio", { action: "comic-draw", answerId: id, panelIndex: 0 }, auth);
    await waitFor(() => gemini().length === 5 && store.db.answers[0].comic_status === "ready");
    assert.ok(panels().every((m) => m.status === "published"));

    // A failed panel is reported and the old picture is kept.
    globalThis.__GEMINI_FAIL__ = (prompt) => prompt.includes("panel 2 of 2");
    await post("/api/studio", { action: "comic-draw", answerId: id }, auth);
    await waitFor(() => ["partial", "failed"].includes(store.db.answers[0].comic_status));
    assert.equal(store.db.answers[0].comic_status, "partial");
    assert.match(store.db.answers[0].comic_error, /panel 2: .*SAFETY/);
    assert.equal(panels().length, 2, "panel 2 keeps its previous image");
    globalThis.__GEMINI_FAIL__ = null;

    // Studio data: status visible, never the recording, the photo is marked as a reference.
    const studio = await (await fetch(`${url}/api/studio`, { headers: auth })).json();
    assert.equal(studio.aiDrawing, true);
    assert.equal(studio.storytellers[0].answers[0].comicStatus, "partial");

    // Auto-publish: a new approved story goes straight to the family page.
    process.env.AUTO_PUBLISH = "on";
    await post("/api/family", { f, action: "ask", mainKey: "p02", mainQuestion: "Q2" });
    const s2 = await typedStory(t, "Мама пекла баурсаки.");
    await waitFor(() => store.db.answers.find((x) => x.id === s2).status === "ready");
    await post("/api/teller", { t, action: "approve", answerId: s2, approval: "approved" });
    await waitFor(() => store.db.answers.find((x) => x.id === s2).comic_status === "ready");
    fam = await (await fetch(`${url}/api/family?f=${f}`)).json();
    assert.equal(fam.comics.length, 2);

    // Without a Gemini key nothing is drawn automatically, and the studio says so.
    delete process.env.GEMINI_API_KEY;
    assert.equal((await post("/api/studio", { action: "comic-draw", answerId: id }, auth)).status, 400);
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.AUTO_PUBLISH;
    globalThis.__GEMINI_FAIL__ = null;
    server.close();
  }
});

test("studio deletes a story or a whole person with all their files", async () => {
  const { server, store, url } = await startTestServer(8794);
  const { post, waitFor, tokens, latestStory } = client(url);
  const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
  try {
    const keep = tokens((await post("/api/create", { from: "M", name: "Айгерим", lang: "ru", relationship: "partner", mainKey: "r01", mainQuestion: "Как мы познакомились?" })).body);
    const gone = tokens((await post("/api/create", { from: "M", name: "Мама", lang: "ru", ...DREAM })).body);
    const keepTeller = store.db.storytellers.find((s) => s.name === "Айгерим");
    const goneTeller = store.db.storytellers.find((s) => s.name === "Мама");

    // Mama: a voice part, a reference photo.
    const s = await latestStory(gone.t);
    const slot = await post("/api/teller", { t: gone.t, action: "upload-url", answerId: s.id, partIndex: 0, mime: "audio/webm" });
    await fetch(slot.body.uploadUrl, { method: "PUT", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    await post("/api/teller", { t: gone.t, action: "uploaded", partId: slot.body.partId });
    await waitFor(() => store.db.parts.some((p) => p.status === "ready"));
    const ph = await post("/api/studio", { action: "media-upload-url", storytellerId: goneTeller.id, kind: "photo", mime: "image/png" }, auth);
    await fetch(ph.body.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80]) });
    await post("/api/studio", { action: "media-publish", mediaId: ph.body.mediaId }, auth);

    // Partner: two stories, delete the older one.
    await post("/api/family", { f: keep.f, action: "ask", mainKey: "r02", mainQuestion: "Q2" });
    const first = store.db.answers.find((a) => a.storyteller_id === keepTeller.id);
    assert.equal((await post("/api/studio", { action: "story-delete", answerId: first.id })).status, 401);
    assert.equal((await post("/api/studio", { action: "story-delete", answerId: first.id }, auth)).status, 200);
    assert.equal(store.db.answers.filter((a) => a.storyteller_id === keepTeller.id).length, 1);

    // Delete Mama completely.
    assert.equal((await post("/api/studio", { action: "person-delete", storytellerId: goneTeller.id }, auth)).status, 200);
    assert.equal(store.db.storytellers.some((x) => x.id === goneTeller.id), false);
    assert.equal(store.db.answers.some((a) => a.storyteller_id === goneTeller.id), false);
    assert.equal(store.db.parts.some((p) => p.storyteller_id === goneTeller.id), false);
    assert.equal(store.db.media.some((m) => m.storyteller_id === goneTeller.id), false);
    assert.equal([...store.files.keys()].some((k) => k.includes(goneTeller.id)), false, "recordings and photos are deleted");
    assert.equal((await fetch(`${url}/api/teller?t=${gone.t}`)).status, 404, "the old link stops working");
    assert.equal((await fetch(`${url}/api/teller?t=${keep.t}`)).status, 200, "other people are untouched");
  } finally {
    server.close();
  }
});

test("animated video: made after the comic, narrator or real voice, sent with the comic, remade", async () => {
  const { server, store, apiLog, url } = await startTestServer(8793);
  const { post, get, waitFor, tokens, latestStory } = client(url);
  const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
  process.env.GEMINI_API_KEY = "test-gemini";
  try {
    const created = await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", ...DREAM });
    const { t, f } = tokens(created.body);
    const id = (await latestStory(t)).id;
    await post("/api/teller", { t, action: "text-answer", answerId: id, partIndex: 0, text: "Я родилась в ауле у реки." });

    // "Write the story now" from the studio, before the storyteller taps it.
    assert.equal((await post("/api/studio", { action: "retry", answerId: id }, auth)).status, 200);
    await waitFor(() => store.db.answers[0].status === "ready");
    assert.equal(store.db.answers[0].comic_script.storyteller_voice, "female");
    assert.equal((await post("/api/studio", { action: "video-make", answerId: id }, auth)).status, 400, "not before approval");

    // Approval → comic → video, all automatic.
    await post("/api/teller", { t, action: "approve", answerId: id, approval: "approved" });
    const video = () => store.db.media.filter((m) => m.answer_id === id && m.kind === "video");
    await waitFor(() => video().some((m) => m.status === "draft" || m.status === "failed"), 400);
    const v = video()[0];
    assert.equal(v.status, "draft", v.title);
    assert.equal(v.panel_index, -1);
    const file = store.files.get("media/" + v.path);
    assert.equal(file.type, "video/mp4");
    assert.ok(file.data.length > 10000, "a real video file");
    const tts = apiLog.filter((c) => c.service === "tts");
    assert.equal(tts.length, 2, "narrator reads each picture (typed story, no real voice)");
    assert.match(tts[0].url, /XrExE9yKIg1WjnnlVkGX/, "female narrator");
    assert.equal(tts[0].body.model_id, "eleven_v3");
    assert.deepEqual(store.db.answers[0].comic_script.video_notes, []);

    // The family sees nothing until the studio sends it; then comic and video together.
    let fam = await get(`/api/family?f=${f}`);
    assert.deepEqual(fam.media, []);
    let studio = await get("/api/studio", auth);
    const sv = studio.storytellers[0].media.find((m) => m.kind === "video");
    assert.equal(sv.appMade, true);
    assert.ok(sv.url);
    await post("/api/studio", { action: "comic-publish", answerId: id, publish: true }, auth);
    fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.comics.length, 1);
    assert.equal(fam.media.length, 1);
    assert.equal(fam.media[0].kind, "video");

    // Remake with a man's voice while narration fails: the new video replaces the old, stays live, and the problem is reported.
    globalThis.__TTS_FAIL__ = true;
    assert.equal((await post("/api/studio", { action: "video-make", answerId: id, narrator: "male" }, auth)).status, 200);
    await waitFor(() => video().length === 1 && video()[0].id !== v.id && video()[0].status !== "rendering", 400);
    globalThis.__TTS_FAIL__ = false;
    assert.equal(video().length, 1);
    assert.equal(video()[0].status, "published");
    assert.equal(store.files.has("media/" + v.path), false, "old video deleted");
    assert.match(apiLog.filter((c) => c.service === "tts").at(-1).url, /JBFqnCBsd6RMkjVDRZzb/);
    assert.match(store.db.answers[0].comic_script.video_notes.join(" "), /text-to-speech permission/);

    // Hiding the comic hides its video too; sending only the comic leaves the video out.
    await post("/api/studio", { action: "comic-publish", answerId: id, publish: false }, auth);
    assert.deepEqual((await get(`/api/family?f=${f}`)).media, []);
    await post("/api/studio", { action: "comic-publish", answerId: id, publish: true, withVideo: false }, auth);
    fam = await get(`/api/family?f=${f}`);
    assert.equal(fam.comics.length, 1);
    assert.deepEqual(fam.media, []);

    // Deleting the story deletes the video file.
    const path = video()[0].path;
    await post("/api/studio", { action: "story-delete", answerId: id }, auth);
    assert.equal(store.files.has("media/" + path), false);
  } finally {
    globalThis.__TTS_FAIL__ = false;
    delete process.env.GEMINI_API_KEY;
    server.close();
  }
});
