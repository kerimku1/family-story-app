// In-memory stand-in for Supabase, used by tests and the local test server.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const clone = (v) => (v === undefined || v === null ? null : structuredClone(v));

export function createFakeStore(baseUrl = "http://localhost") {
  const db = { storytellers: [], answers: [], media: [], parts: [] };
  const files = new Map();
  // Strictly increasing times, so "newest" is always well defined (like a real database).
  let lastMs = 0;
  const now = () => { lastMs = Math.max(Date.now(), lastMs + 1); return new Date(lastMs).toISOString(); };
  const insert = (table, row) => {
    const r = pgTimes({ id: randomUUID(), created_at: now(), ...row });
    db[table].push(r);
    return clone(r);
  };
  // Like Postgres: timestamps come back as "2026-11-12T20:57:10.123+00:00", not as the "…Z" string sent.
  const pgTimes = (row) => {
    const out = { ...row };
    for (const [k, v] of Object.entries(out)) {
      if (/_at$/.test(k) && typeof v === "string" && /Z$/.test(v)) out[k] = new Date(v).toISOString().replace("Z", "+00:00");
    }
    return out;
  };
  const update = (table, id, patch) => {
    const r = db[table].find((x) => x.id === id);
    if (!r) throw new Error(`${table} ${id} not found`);
    Object.assign(r, pgTimes(patch));
    return clone(r);
  };
  const remove = (table, id) => { db[table] = db[table].filter((x) => x.id !== id); };
  const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : 1);

  return {
    db,
    files,
    baseUrl,
    async createStoryteller(row) { return insert("storytellers", row); },
    async storytellerByTellerToken(t) { return clone(db.storytellers.find((r) => r.teller_token === t)); },
    async storytellerByFamilyToken(t) { return clone(db.storytellers.find((r) => r.family_token === t)); },
    async storytellerById(id) { return clone(db.storytellers.find((r) => r.id === id)); },
    async listStorytellers() { return clone([...db.storytellers].reverse()); },
    async updateStoryteller(id, patch) { return update("storytellers", id, patch); },
    async deleteStoryteller(id) {
      remove("storytellers", id);
      const gone = new Set(db.answers.filter((r) => r.storyteller_id === id).map((r) => r.id));
      db.answers = db.answers.filter((r) => r.storyteller_id !== id);
      db.parts = db.parts.filter((r) => r.storyteller_id !== id && !gone.has(r.answer_id));
      db.media = db.media.filter((r) => r.storyteller_id !== id);
    },

    async createAnswer(row) { return insert("answers", { approval: "waiting", allow_voice: false, ...row }); },
    async answerById(id) { return clone(db.answers.find((r) => r.id === id)); },
    async listAnswers(sid) { return clone(db.answers.filter((r) => r.storyteller_id === sid).sort(byCreated)); },
    async updateAnswer(id, patch) { return update("answers", id, { ...patch, updated_at: now() }); },
    async deleteAnswer(id) { remove("answers", id); db.parts = db.parts.filter((r) => r.answer_id !== id); },

    async createPart(row) { return insert("parts", row); },
    async partById(id) { return clone(db.parts.find((r) => r.id === id)); },
    async listParts(aid) { return clone(db.parts.filter((r) => r.answer_id === aid).sort(byCreated)); },
    async listPartsForStoryteller(sid) { return clone(db.parts.filter((r) => r.storyteller_id === sid).sort(byCreated)); },
    async updatePart(id, patch) { return update("parts", id, patch); },
    async deletePart(id) { remove("parts", id); },

    async createMedia(row) { return insert("media", row); },
    async listMediaForAnswer(aid) { return clone(db.media.filter((r) => r.answer_id === aid).sort(byCreated)); },
    async mediaById(id) { return clone(db.media.find((r) => r.id === id)); },
    async listMedia(sid) { return clone(db.media.filter((r) => r.storyteller_id === sid).sort(byCreated)); },
    async updateMedia(id, patch) { return update("media", id, patch); },
    async deleteMedia(id) { remove("media", id); },

    async signedUploadUrl(bucket, path) { return `${baseUrl}/__upload/${bucket}/${encodeURIComponent(path)}`; },
    async download(bucket, path) {
      const f = files.get(`${bucket}/${path}`);
      if (!f) throw new Error("file not found: " + path);
      return new Blob([f.data], { type: f.type });
    },
    async upload(bucket, path, data, contentType) { files.set(`${bucket}/${path}`, { data: Buffer.from(data), type: contentType }); },
    async signedUrl(bucket, path) { return `${baseUrl}/__file/${bucket}/${encodeURIComponent(path)}`; },
    async remove(bucket, paths) { for (const p of paths) files.delete(`${bucket}/${p}`); }
  };
}

// Fake replies from ElevenLabs and Claude, so the whole pipeline runs without real keys.
export const SAMPLE_TRANSCRIPT = "Я родилась в ауле у реки, у нас был белый дом с синими ставнями. Мама пекла баурсаки каждое воскресенье.";

export const SAMPLE_STEPS = [
  "Каким вы были ребёнком?",
  "О ком или о чём вы мечтали тогда?",
  "Почему именно об этом?",
  "Что помогло или помешало мечте?",
  "Что вы думаете об этой мечте сейчас?"
];

export function sampleStory() {
  return {
    title: "Белый дом у реки",
    story: "Я родилась в ауле у реки. У нас был белый дом с синими ставнями. Каждое воскресенье мама пекла баурсаки.",
    details: {
      people: [{ name: "Мама", relation: "mother", note: "пекла баурсаки по воскресеньям" }],
      places: [{ name: "аул у реки", when: "", note: "место рождения" }],
      times: [],
      objects: [{ name: "дом", description: "белый, с синими ставнями" }],
      phrases: [],
      traits: [],
      appearance: []
    },
    follow_up_questions: ["Как называлась река?"]
  };
}

export function sampleComic() {
  return {
    style_notes: "Rural Kazakhstan village by a river, warm Sunday morning",
    storyteller_voice: "female",
    characters: [
      { name: "Narrator as a girl", gender: "female", role: "the storyteller, 8", look: "young girl with two braids, red dress", is_storyteller: true },
      { name: "Mama", gender: "female", role: "her mother", look: "woman in her thirties, white headscarf", is_storyteller: false }
    ],
    panels: [
      { page: 1, shape: "wide", setting: "Village by a river", action: "A white house with blue shutters", left: "Narrator as a girl", right: "",
        caption: "Дом у реки", dialogue: [{ speaker: "Narrator as a girl", side: "left", text: "Это наш дом!" }],
        quote: "у нас был белый дом с синими ставнями", quote_answer: 1 },
      { page: 2, shape: "square", setting: "Kitchen, Sunday", action: "Mother frying baursaks", left: "Mama", right: "Narrator as a girl",
        caption: "Воскресенье", dialogue: [{ speaker: "Mama", side: "left", text: "Бери, пока горячие!" }, { speaker: "Narrator as a girl", side: "right", text: "Ещё один!" }],
        quote: "Мама пекла баурсаки каждое воскресенье", quote_answer: 1 }
    ]
  };
}

// One second of real MP3 audio, so the video maker can measure and mix it.
let speech = null;
let ttsRunning = 0;
function fakeSpeech() {
  if (!speech) {
    const bin = require("ffmpeg-static");
    speech = execFileSync(bin, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", "-c:a", "libmp3lame", "-f", "mp3", "pipe:1"]);
  }
  return speech;
}

function fakePicture(n) {
  const colour = ((n * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0");
  return execFileSync(require("ffmpeg-static"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x${colour}:s=64x48`, "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"]);
}

export function installFakeApis(log = []) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) {
      const body = JSON.parse(init.body);
      log.push({ service: "tts", url, init, body });
      if (globalThis.__TTS_FAIL__) return new Response('{"detail":"missing_permissions"}', { status: 401 });
      if (ttsRunning >= 2) {
        log.push({ service: "tts-refused" });
        return new Response('{"detail":{"type":"rate_limit_error","code":"concurrent_limit_exceeded","message":"Too many concurrent requests."}}', { status: 429 });
      }
      ttsRunning++;
      try {
        await new Promise((r) => setTimeout(r, 30));
        return new Response(fakeSpeech(), { headers: { "content-type": "audio/mpeg" } });
      } finally { ttsRunning--; }
    }
    if (url.startsWith("https://api.elevenlabs.io/")) {
      log.push({ service: "elevenlabs", url, init });
      const words = SAMPLE_TRANSCRIPT.split(" ").map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.35, type: "word" }));
      return Response.json({ text: SAMPLE_TRANSCRIPT, language_code: "rus", words });
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      const body = JSON.parse(init.body);
      log.push({ service: "gemini", url, init, body });
      const prompt = body.contents[0].parts[0].text;
      if (globalThis.__GEMINI_FAIL__ && globalThis.__GEMINI_FAIL__(prompt)) {
        return Response.json({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] });
      }
      const n = log.filter((c) => c.service === "gemini").length;
      if (globalThis.__GEMINI_DELAY__) await new Promise((r) => setTimeout(r, globalThis.__GEMINI_DELAY__));
      if (globalThis.__GEMINI_429__) {
        return Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: globalThis.__GEMINI_429__,
          details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" }] } }, { status: 429 });
      }
      // A real small PNG, a different colour each time so tests can tell images apart.
      const png = fakePicture(n);
      return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] });
    }
    if (url.startsWith("https://api.anthropic.com/")) {
      const body = JSON.parse(init.body);
      log.push({ service: "anthropic", url, init, body });
      // Two kinds of request: the ~5 lead-up questions, or the story itself.
      const steps = Boolean(body.output_config?.format?.schema?.properties?.questions);
      if (steps && globalThis.__CLAUDE_STEPS_FAIL__) return Response.json({ error: { message: "overloaded" } }, { status: 529 });
      const schema = body.output_config?.format?.schema?.properties || {};
      const reply = steps ? { questions: SAMPLE_STEPS } : schema.panels ? sampleComic() : sampleStory();
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] });
    }
    return realFetch(input, init);
  };
  return () => { globalThis.fetch = realFetch; };
}
