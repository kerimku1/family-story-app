// In-memory stand-in for Supabase, used by tests and the local test server.
import { randomUUID } from "node:crypto";

const clone = (v) => (v === undefined || v === null ? null : structuredClone(v));

export function createFakeStore(baseUrl = "http://localhost") {
  const db = { storytellers: [], answers: [], media: [] };
  const files = new Map();
  const now = () => new Date().toISOString();
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

    async createAnswer(row) { return insert("answers", { approval: "waiting", allow_voice: false, ...row }); },
    async answerById(id) { return clone(db.answers.find((r) => r.id === id)); },
    async listAnswers(sid) { return clone(db.answers.filter((r) => r.storyteller_id === sid).sort(byCreated)); },
    async updateAnswer(id, patch) { return update("answers", id, patch); },
    async deleteAnswer(id) { remove("answers", id); },

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
      characters: [{ name: "Narrator as a girl", look: "young girl, not described further" }, { name: "Mama", look: "not described" }],
      panels: [
        { setting: "Village by a river", action: "A white house with blue shutters", caption: "Дом у реки", quote: "у нас был белый дом с синими ставнями" },
        { setting: "Kitchen, Sunday", action: "Mother frying baursaks", caption: "Воскресенье", quote: "Мама пекла баурсаки каждое воскресенье" }
      ]
    },
    follow_up_questions: ["Как называлась река?"]
  };
}

export function installFakeApis(log = []) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://api.elevenlabs.io/")) {
      log.push({ service: "elevenlabs", url, init });
      const words = SAMPLE_TRANSCRIPT.split(" ").map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.35, type: "word" }));
      return Response.json({ text: SAMPLE_TRANSCRIPT, language_code: "rus", words });
    }
    if (url.startsWith("https://api.anthropic.com/")) {
      log.push({ service: "anthropic", url, init, body: JSON.parse(init.body) });
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(sampleStory()) }] });
    }
    return realFetch(input, init);
  };
  return () => { globalThis.fetch = realFetch; };
}
