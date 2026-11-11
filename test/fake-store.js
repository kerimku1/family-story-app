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
    const r = { id: randomUUID(), created_at: now(), ...row };
    db[table].push(r);
    return clone(r);
  };
  const update = (table, id, patch) => {
    const r = db[table].find((x) => x.id === id);
    if (!r) throw new Error(`${table} ${id} not found`);
    Object.assign(r, patch);
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
    async updateAnswer(id, patch) { return update("answers", id, patch); },
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
    comic: {
      style_notes: "Rural Kazakhstan village by a river, warm Sunday morning",
      storyteller_voice: "female",
      characters: [{ name: "Narrator as a girl", look: "young girl, not described further", is_storyteller: true }, { name: "Mama", look: "not described", is_storyteller: false }],
      panels: [
        { setting: "Village by a river", action: "A white house with blue shutters", caption: "Дом у реки", quote: "у нас был белый дом с синими ставнями", quote_answer: 1 },
        { setting: "Kitchen, Sunday", action: "Mother frying baursaks", caption: "Воскресенье", quote: "Мама пекла баурсаки каждое воскресенье", quote_answer: 1 }
      ]
    },
    follow_up_questions: ["Как называлась река?"]
  };
}

// One second of real MP3 audio, so the video maker can measure and mix it.
let speech = null;
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
      return new Response(fakeSpeech(), { headers: { "content-type": "audio/mpeg" } });
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
      const reply = steps ? { questions: SAMPLE_STEPS } : sampleStory();
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] });
    }
    return realFetch(input, init);
  };
  return () => { globalThis.fetch = realFetch; };
}
