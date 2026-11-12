// A story = one main question for a storyteller, answered in ~5 lead-up parts.
import { writeSteps } from "./ai.js";
import { cleanText } from "./http.js";
import { clipPaths } from "./clips.js";
import { aboutOf } from "./roles.js";

export const RELATIONSHIPS = ["parent", "child", "partner", "friend"];

export function cleanMain(body) {
  const mainQuestion = cleanText(body.mainQuestion, 300);
  const mainKey = /^[a-z]\d{2}$/.test(String(body.mainKey || "")) ? String(body.mainKey) : "custom";
  return { mainQuestion, mainKey };
}

export async function createStory(store, teller, { mainQuestion, mainKey }, { fetchImpl = fetch } = {}) {
  const steps = await writeSteps({
    mainQuestion,
    name: teller.name,
    from: teller.from_name,
    lang: teller.lang,
    relationship: teller.relationship,
    about: aboutOf(teller)
  }, { fetchImpl });
  const existing = await store.listAnswers(teller.id);
  return store.createAnswer({
    storyteller_id: teller.id,
    question_index: existing.length,
    question_text: mainQuestion,
    main_key: mainKey,
    sub_questions: steps,
    status: "collecting"
  });
}

// What a story looks like to the storyteller and to the asker.
export function storyProgress(answer, parts) {
  const mine = parts.filter((p) => p.answer_id === answer.id && p.status !== "pending");
  const answeredParts = [...new Set(mine.map((p) => p.part_index))].sort((a, b) => a - b);
  return {
    steps: Array.isArray(answer.sub_questions) ? answer.sub_questions : [answer.question_text],
    answeredParts,
    spoken: mine.some((p) => p.audio_path)
  };
}

// Deletes one story completely: recordings, clips, pictures, parts and the story itself.
export async function deleteStory(store, answer) {
  const parts = await store.listParts(answer.id);
  const recordings = [...parts.map((p) => p.audio_path), answer.audio_path].filter(Boolean);
  if (recordings.length) await store.remove("recordings", recordings);
  const media = await store.listMediaForAnswer(answer.id);
  await store.remove("media", [...clipPaths(answer), ...media.map((m) => m.path).filter((p) => p && p !== "pending")]);
  for (const m of media) await store.deleteMedia(m.id);
  for (const p of parts) await store.deletePart(p.id);
  await store.deleteAnswer(answer.id);
}

// Deletes a person and everything about them, including photos and both links.
export async function deleteStoryteller(store, teller) {
  for (const a of await store.listAnswers(teller.id)) await deleteStory(store, a);
  const media = await store.listMedia(teller.id);
  await store.remove("media", media.map((m) => m.path).filter((p) => p && p !== "pending"));
  for (const m of media) await store.deleteMedia(m.id);
  await store.deleteStoryteller(teller.id);
}
