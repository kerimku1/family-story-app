// What happens after an answer is uploaded:
// audio → transcript with word timings → story + details + comic script → life card.
import { transcribe, writeStory } from "./ai.js";
import { syncClips, clipPaths } from "./clips.js";
import { generateComic, autoComicsOn } from "./comic.js";

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

export async function processAnswer(store, answerId, { fetchImpl = fetch } = {}) {
  let answer = await store.answerById(answerId);
  if (!answer) return;
  try {
    const teller = await store.storytellerById(answer.storyteller_id);
    answer = await store.updateAnswer(answerId, { status: "processing", error: null });

    const typed = !answer.audio_path;
    let heard;
    if (typed) {
      // A typed answer: the text is already here, nothing to transcribe.
      if (!answer.transcript) throw new Error("The answer is empty");
      heard = { text: answer.transcript, words: [] };
    } else {
      const audio = await store.download("recordings", answer.audio_path);
      heard = await transcribe(audio, { lang: teller.lang, mime: answer.mime, fetchImpl });
      if (!heard.text) throw new Error("No speech was found in the recording");
      await store.updateAnswer(answerId, { transcript: heard.text, words: heard.words });
    }

    const written = await writeStory({
      name: teller.name,
      lang: teller.lang,
      question: answer.question_text,
      transcript: heard.text,
      lifeCard: teller.life_card,
      typed
    }, { fetchImpl });

    const panels = (written.comic?.panels || []).map((p) => ({ ...p, voice_clip: findClip(heard.words, p.quote) }));
    const oldClips = clipPaths(answer);
    await store.updateAnswer(answerId, {
      status: "ready",
      title: written.title,
      story: written.story,
      details: written.details,
      comic_script: { ...written.comic, panels },
      follow_up_questions: written.follow_up_questions || []
    });

    // Re-read the storyteller so two answers finishing together don't overwrite each other's details.
    const fresh = await store.storytellerById(teller.id);
    await store.updateStoryteller(teller.id, { life_card: mergeLifeCard(fresh.life_card, written.details) });

    if (oldClips.length) await store.remove("media", oldClips);
    await syncClips(store, answerId);

    // A rewritten story that was already approved gets a fresh comic for its new script.
    const done = await store.answerById(answerId);
    if (done && done.approval === "approved" && autoComicsOn()) {
      await generateComic(store, answerId, { force: true, newSheet: true, fetchImpl });
    }
  } catch (err) {
    console.error("processAnswer failed", answerId, err);
    await store.updateAnswer(answerId, { status: "failed", error: String(err.message || err).slice(0, 500) });
  }
}
