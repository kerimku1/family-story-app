import { test } from "node:test";
import assert from "node:assert/strict";
import { findClip, mergeLifeCard } from "../api/_lib/pipeline.js";
import { STORY_SCHEMA } from "../api/_lib/ai.js";
import { normalizeSupabaseUrl } from "../api/_lib/store.js";
import { startTestServer } from "./test-server.js";

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

test("full flow: create → upload → story → approve → studio → family sees only media", async () => {
  const { server, store, apiLog, url } = await startTestServer(8799);
  try {
    const post = (path, body, headers = {}) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const created = await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru" });
    assert.equal(created.status, 200);
    const t = new URL(created.body.tellerUrl).searchParams.get("t");
    const f = new URL(created.body.familyUrl).searchParams.get("f");

    const slot = await post("/api/teller", { t, action: "upload-url", questionIndex: 0, questionText: "Где вы родились?", mime: "audio/webm" });
    assert.equal(slot.status, 200);
    const put = await fetch(slot.body.uploadUrl, { method: "PUT", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(put.status, 200);
    assert.equal((await post("/api/teller", { t, action: "uploaded", answerId: slot.body.answerId, durationSec: 12.4 })).status, 200);

    // wait for background processing
    for (let i = 0; i < 50 && store.db.answers[0].status !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
    const answer = store.db.answers[0];
    assert.equal(answer.status, "ready", answer.error || "");
    assert.equal(answer.title, "Белый дом у реки");
    assert.ok(answer.comic_script.panels[0].voice_clip, "panel 1 should have a voice clip");
    assert.equal(store.db.storytellers[0].life_card.people[0].name, "Мама");

    const claudeCall = apiLog.find((c) => c.service === "anthropic");
    assert.ok(claudeCall.body.output_config.format.schema);
    assert.match(claudeCall.body.messages[0].content, /белый дом с синими ставнями/);

    // Storyteller sees their story; family sees nothing yet; studio sees nothing until approved.
    const teller = await (await fetch(`${url}/api/teller?t=${t}`)).json();
    assert.equal(teller.stories[0].story.includes("синими ставнями"), true);
    const family1 = await (await fetch(`${url}/api/family?f=${f}`)).json();
    assert.equal(family1.collected, 1);
    assert.deepEqual(family1.media, []);
    assert.equal(JSON.stringify(family1).includes("ставнями"), false, "family must never get story text");

    const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
    assert.equal((await fetch(`${url}/api/studio`)).status, 401);
    let studio = await (await fetch(`${url}/api/studio`, { headers: auth })).json();
    assert.equal(studio.storytellers[0].answers[0].story, null, "studio must not see unapproved story");
    assert.equal(JSON.stringify(studio).includes("ставнями"), false);
    const blocked = await post("/api/studio", { action: "media-upload-url", storytellerId: answer.storyteller_id, answerId: answer.id, kind: "comic", mime: "image/png" }, auth);
    assert.equal(blocked.status, 400);

    assert.equal((await post("/api/teller", { t, action: "approve", answerId: answer.id, approval: "approved" })).status, 200);
    studio = await (await fetch(`${url}/api/studio`, { headers: auth })).json();
    assert.ok(studio.storytellers[0].answers[0].comicScript.panels.length >= 1);
    assert.equal(studio.storytellers[0].lifeCard.people[0].name, "Мама");
    assert.equal(JSON.stringify(studio).includes("audio_path"), false, "studio never gets recordings");

    const m = await post("/api/studio", { action: "media-upload-url", storytellerId: answer.storyteller_id, answerId: answer.id, kind: "comic", mime: "image/png", title: "Дом у реки" }, auth);
    assert.equal(m.status, 200);
    await fetch(m.body.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) });
    assert.equal((await post("/api/studio", { action: "media-publish", mediaId: m.body.mediaId }, auth)).status, 200);

    const family2 = await (await fetch(`${url}/api/family?f=${f}`)).json();
    assert.equal(family2.media.length, 1);
    assert.equal(family2.media[0].title, "Дом у реки");

    // Wrong tokens and other people's answers are rejected.
    assert.equal((await fetch(`${url}/api/teller?t=nope`)).status, 404);
    const other = await post("/api/create", { from: "A", name: "B", lang: "kk" });
    const t2 = new URL(other.body.tellerUrl).searchParams.get("t");
    assert.equal((await post("/api/teller", { t: t2, action: "delete", answerId: answer.id })).status, 404);

    // Deleting removes the recording file too.
    assert.equal((await post("/api/teller", { t, action: "delete", answerId: answer.id })).status, 200);
    assert.equal([...store.files.keys()].some((k) => k.startsWith("recordings/")), false);
  } finally {
    server.close();
  }
});

test("typed answer: no transcription, story written from the text", async () => {
  const { server, store, apiLog, url } = await startTestServer(8798);
  try {
    const post = (body) => fetch(url + "/api/teller", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const created = await fetch(url + "/api/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "Мухамед", name: "Ата", lang: "kk" }) }).then((r) => r.json());
    const t = new URL(created.tellerUrl).searchParams.get("t");

    assert.equal((await post({ t, action: "text-answer", questionIndex: 2, questionText: "Q3", text: "   " })).status, 400);
    const sent = await post({ t, action: "text-answer", questionIndex: 2, questionText: "Q3", text: "Мен ауылда тудым.\r\nҮйіміз ақ еді." });
    assert.equal(sent.status, 200);

    for (let i = 0; i < 50 && store.db.answers[0].status !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
    const a = store.db.answers[0];
    assert.equal(a.status, "ready", a.error || "");
    assert.equal(a.audio_path, undefined);
    assert.equal(a.transcript, "Мен ауылда тудым.\nҮйіміз ақ еді.");
    assert.equal(apiLog.filter((c) => c.service === "elevenlabs").length, 0, "typed answers must not be transcribed");
    const prompt = apiLog.find((c) => c.service === "anthropic").body.messages[0].content;
    assert.match(prompt, /in writing in Kazakh/);
    assert.match(prompt, /Үйіміз ақ еді/);

    const view = await (await fetch(`${url}/api/teller?t=${t}`)).json();
    assert.deepEqual(view.answered, [2]);
  } finally {
    server.close();
  }
});
