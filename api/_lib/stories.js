// A story = one main question for a storyteller, answered in ~5 lead-up parts.
import { writeSteps } from "./ai.js";
import { cleanText } from "./http.js";

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
    relationship: teller.relationship
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
