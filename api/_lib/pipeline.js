// What happens after a story's parts are in:
// each recording → transcript with word timings; all parts → one story + details + comic script → life card.
import { transcribe, writeStory, writeComic } from "./ai.js";
import { aboutOf } from "./roles.js";
import { syncClips, clipPaths } from "./clips.js";
import { autoComicsOn } from "./comic.js";
import { comicThenVideo } from "./video.js";
import { startInOwnCall } from "./selfcall.js";

const CARD_KEYS = ["people", "places", "times", "objects", "phrases", "traits", "appearance"];

// Add new details to the life card, skipping ones we already have.
export function mergeLifeCard(card, details) {
  const out = {};
  for (const key of CARD_KEYS) {
    const merged = [...((card && card[key]) || [])];
    const seen = new Set(merged.map(identity));
    for (const item of (details && details[key]) || []) {
      const id = identity(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
    out[key] = merged;
  }
  if (card && card.about) out.about = card.about; // who's who, set by the asker or the studio
  return out;
}

function identity(item) {
  if (typeof item === "string") return item.trim().toLowerCase();
  if (!item || typeof item !== "object") return "";
  if (item.name || item.who) return String(item.name || item.who).trim().toLowerCase();
  return (String(item.when || "") + "|" + String(item.event || "")).trim().toLowerCase();
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Find where a quote was spoken, so a real-voice clip can be cut later.
export function findClip(words, quote) {
  const target = String(quote || "").split(/\s+/).map(norm).filter(Boolean);
  const spoken = (words || []).map((w) => norm(w.text));
  if (!target.length || !spoken.length) return null;
  let best = null;
  for (let i = 0; i < spoken.length; i++) {
    if (spoken[i] !== target[0]) continue;
    let j = 0;
    let k = i;
    let matched = 0;
    while (j < target.length && k < spoken.length) {
      if (spoken[k] === target[j]) { matched++; j++; k++; }
      else if (spoken[k] === "") k++;
      else break;
    }
    if (!best || matched > best.matched) best = { matched, start: i, end: k - 1 };
  }
  if (!best || best.matched < Math.min(3, target.length)) return null;
  return {
    start: words[best.start].start,
    end: words[best.end].end,
    matched_words: best.matched,
    quote_words: target.length
  };
}

// The newest answer for each lead-up question (re-recording replaces the older one).
export function latestParts(parts) {
  const byIndex = new Map();
  for (const p of parts || []) {
    if (p.status === "pending") continue;
    const old = byIndex.get(p.part_index);
    if (!old || old.created_at <= p.created_at) byIndex.set(p.part_index, p);
  }
  return [...byIndex.values()].sort((a, b) => a.part_index - b.part_index);
}

// Turn one recorded part into text (typed parts already are text).
export async function transcribePart(store, partId, { fetchImpl = fetch } = {}) {
  const part = await store.partById(partId);
  if (!part || part.transcript || !part.audio_path) return part;
  try {
    const teller = await store.storytellerById(part.storyteller_id);
    const audio = await store.download("recordings", part.audio_path);
    const heard = await transcribe(audio, { lang: teller.lang, mime: part.mime, fetchImpl });
    return await store.updatePart(partId, { transcript: heard.text, words: heard.words, status: "ready", error: heard.text ? null : "No speech found" });
  } catch (err) {
    console.error("transcribePart failed", partId, err);
    return await store.updatePart(partId, { status: "failed", error: String(err.message || err).slice(0, 300) });
  }
}

// The comic script for a written story, with the moments where each panel's quote was spoken
// (first in the answer the writer named, then in any other), so real-voice clips can be cut.
async function comicScriptFor(teller, answer, parts, written, { fetchImpl }) {
  const script = await writeComic({
    name: teller.name,
    from: teller.from_name,
    lang: teller.lang,
    relationship: teller.relationship,
    about: aboutOf(teller),
    question: answer.question_text,
    parts: parts.map((p) => ({ question: p.question_text, text: p.transcript, spoken: Boolean(p.audio_path) })),
    story: written.story,
    title: written.title
  }, { fetchImpl });
  const panels = (script.panels || []).map((p) => {
    if (!String(p.quote || "").trim()) return { ...p, voice_clip: null };
    const named = parts[Number(p.quote_answer) - 1];
    const order = named ? [named, ...parts.filter((x) => x !== named)] : parts;
    for (const part of order) {
      if (!part.audio_path) continue;
      const clip = findClip(part.words, p.quote);
      if (clip) return { ...p, voice_clip: { ...clip, part_id: part.id } };
    }
    return { ...p, voice_clip: null };
  });
  return { ...script, panels };
}

// Write a new comic script for an already written story (keeps the story text the storyteller approved),
// then draw it again.
export async function remakeComic(store, answerId, { fetchImpl = fetch } = {}) {
  const answer = await store.answerById(answerId);
  if (!answer || answer.status !== "ready" || !answer.story) return;
  try {
    const teller = await store.storytellerById(answer.storyteller_id);
    const parts = latestParts(await store.listParts(answerId)).filter((p) => p.transcript && p.transcript.trim());
    await store.updateAnswer(answerId, { comic_status: "drawing", comic_error: "Writing the new comic script…", comic_started_at: new Date().toISOString() });
    const comic = await comicScriptFor(teller, answer, parts, { story: answer.story, title: answer.title }, { fetchImpl });
    const oldClips = clipPaths(answer);
    await store.updateAnswer(answerId, { comic_script: comic });
    if (oldClips.length) await store.remove("media", oldClips);
    await syncClips(store, answerId);
    await store.updateAnswer(answerId, { comic_error: "Drawing the new comic…" });
    if (!(await startInOwnCall({ action: "comic-draw", answerId, force: true }))) {
      await comicThenVideo(store, answerId, { force: true, newSheet: true, fetchImpl });
    }
  } catch (err) {
    console.error("remakeComic failed", answerId, err);
    await store.updateAnswer(answerId, { comic_status: "failed", comic_error: String(err.message || err).slice(0, 500) });
  }
}

// Combine all parts of a story into one story, a comic script and life-card details.
export async function processAnswer(store, answerId, { fetchImpl = fetch } = {}) {
  let answer = await store.answerById(answerId);
  if (!answer) return;
  try {
    const teller = await store.storytellerById(answer.storyteller_id);
    answer = await store.updateAnswer(answerId, { status: "processing", error: null });

    let parts = latestParts(await store.listParts(answerId));
    for (const p of parts) {
      if (p.audio_path && !p.transcript) await transcribePart(store, p.id, { fetchImpl });
    }
    parts = latestParts(await store.listParts(answerId)).filter((p) => p.transcript && p.transcript.trim());
    if (!parts.length) throw new Error("No answers with words in them yet");

    const written = await writeStory({
      name: teller.name,
      from: teller.from_name,
      lang: teller.lang,
      relationship: teller.relationship,
      about: aboutOf(teller),
      question: answer.question_text,
      parts: parts.map((p) => ({ question: p.question_text, text: p.transcript, spoken: Boolean(p.audio_path) })),
      lifeCard: teller.life_card
    }, { fetchImpl });
    const comic = await comicScriptFor(teller, answer, parts, written, { fetchImpl });

    const oldClips = clipPaths(answer);
    await store.updateAnswer(answerId, {
      status: "ready",
      transcript: parts.map((p) => p.transcript).join("\n\n"),
      title: written.title,
      story: written.story,
      details: written.details,
      comic_script: comic,
      follow_up_questions: written.follow_up_questions || []
    });

    // Re-read the storyteller so two stories finishing together don't overwrite each other's details.
    const fresh = await store.storytellerById(teller.id);
    await store.updateStoryteller(teller.id, { life_card: mergeLifeCard(fresh.life_card, written.details) });

    if (oldClips.length) await store.remove("media", oldClips);
    await syncClips(store, answerId);

    // A rewritten story that was already approved gets a fresh comic for its new script.
    const done = await store.answerById(answerId);
    if (done && done.approval === "approved" && autoComicsOn()) {
      if (!(await startInOwnCall({ action: "comic-draw", answerId, force: true }))) {
        await comicThenVideo(store, answerId, { force: true, newSheet: true, fetchImpl });
      }
    }
  } catch (err) {
    console.error("processAnswer failed", answerId, err);
    await store.updateAnswer(answerId, { status: "failed", error: String(err.message || err).slice(0, 500) });
  }
}
