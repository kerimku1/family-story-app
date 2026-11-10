// Speech-to-text (ElevenLabs Scribe) and story writing (Claude).
import { env } from "./store.js";

const STT_LANG = { ru: "rus", kk: "kaz", en: "eng" };
const LANG_NAME = { ru: "Russian", kk: "Kazakh", en: "English" };

export async function transcribe(audioBlob, { lang, mime, fetchImpl = fetch } = {}) {
  const key = env("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const form = new FormData();
  form.append("model_id", env("ELEVENLABS_STT_MODEL") || "scribe_v2");
  form.append("file", audioBlob, "answer." + (String(mime).includes("mp4") ? "m4a" : "webm"));
  if (STT_LANG[lang]) form.append("language_code", STT_LANG[lang]);
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");

  const res = await fetchImpl("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const words = (data.words || [])
    .filter((w) => w.type === undefined || w.type === "word")
    .map((w) => ({ text: w.text, start: w.start, end: w.end }));
  return { text: String(data.text || "").trim(), words, language: data.language_code || null };
}

// JSON schema for the structured answer. Every object lists all its properties as required
// and sets additionalProperties:false, as structured outputs require.
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false
});
const str = (description) => ({ type: "string", description });
const list = (items, description) => ({ type: "array", items, description });

export const STORY_SCHEMA = obj({
  title: str("Short warm title for this story, in the storyteller's language"),
  story: str("The story retold in first person, in the storyteller's language, using their own words and phrases"),
  details: obj({
    people: list(obj({ name: str("Name or how they are called"), relation: str("Relation to the storyteller"), note: str("What was said about them") }), "People mentioned"),
    places: list(obj({ name: str("Place"), when: str("When, if said, else empty"), note: str("What was said about it") }), "Places mentioned"),
    times: list(obj({ when: str("Year, decade or age"), event: str("What happened") }), "Dated events"),
    objects: list(obj({ name: str("Object"), description: str("Colour, look, meaning — only as said") }), "Meaningful objects"),
    phrases: list(str("A characteristic phrase or saying, quoted exactly"), "Their own expressions"),
    traits: list(str("A character trait shown in the story"), "Character traits"),
    appearance: list(obj({ who: str("Person"), description: str("How they looked, only as said") }), "Appearance details")
  }),
  comic: obj({
    style_notes: str("In English: era, region and mood for the artist, based only on the story"),
    characters: list(obj({
      name: str("Character name as in the story"),
      look: str("In English: age in this story and visual look, from stated details; say 'not described' where unknown"),
      is_storyteller: { type: "boolean", description: "True only for the storyteller themself (the narrator 'I'), at the age in this story" }
    }), "Characters to draw"),
    panels: list(obj({
      setting: str("In English: where and when the scene happens"),
      action: str("In English: what we see happening"),
      caption: str("Short caption in the storyteller's language"),
      quote: str("The exact words from one answer to play as real-voice narration for this panel, 3-25 words, copied verbatim"),
      quote_answer: { type: "integer", description: "The number of the answer the quote is copied from (1 = Answer 1)" }
    }), "4 to 6 comic panels in story order")
  }),
  follow_up_questions: list(str("A gentle question in the storyteller's language asking for a missing detail"), "2-4 follow-up questions")
});

const RELATION = { parent: "parent", child: "child", partner: "partner", friend: "friend" };

// A story is one main question answered in several parts.
// parts: [{ question, text, spoken }] in order.
export function storyPrompt({ name, lang, question, parts, lifeCard, relationship }) {
  const language = LANG_NAME[lang] || "the storyteller's language";
  const answered = (parts || []).filter((p) => p.text);
  const anySpoken = answered.some((p) => p.spoken);
  const lines = [
    `You are helping a family keep the life story of ${name || "a loved one"}${RELATION[relationship] ? ` (the asker's ${RELATION[relationship]})` : ""}.`,
    `The family asked them one main question: "${question}"`,
    `To answer it, they replied to ${answered.length} short lead-up question${answered.length === 1 ? "" : "s"}, in ${language}:`,
    ""
  ];
  answered.forEach((p, i) => {
    lines.push(`Answer ${i + 1} (${p.spoken ? "spoken, transcribed" : "written"}) — question: "${p.question}"`);
    lines.push('"""', p.text, '"""', "");
  });
  lines.push(
    "What we already know about them from earlier stories (may be empty):",
    JSON.stringify(lifeCard || {}),
    "",
    "Rules:",
    "- Combine all answers into ONE flowing first-person story that answers the main question. Do not list the lead-up questions; tell it as one story with a beginning, a middle and an end.",
    "- Use ONLY facts from the answers. Never invent names, places, dates, colours or events. If something is unclear, leave it out.",
    `- Write the title, story, captions and follow-up questions in ${language}.`,
    "- Keep their own phrases, humour and way of speaking. Fix only obvious speech slips and typos.",
    "- The comic is for the family, so it must be respectful and warm. Skip anything painful the storyteller seemed unsure about sharing.",
    anySpoken
      ? "- Each panel quote must be copied word for word from ONE answer, and quote_answer must be that answer's number. Prefer spoken answers, so we can play their real voice."
      : "- Each panel quote must be copied word for word from ONE answer, and quote_answer must be that answer's number.",
    "- Order the panels so they tell the story from beginning to end.",
    "- Visual descriptions for the artist are in English and should be specific: clothing, colours, objects, weather, era — but only from what was said or what is certain from the era and place."
  );
  return lines.join("\n");
}

// ---------- The ~5 lead-up questions for one main question ----------
const FORMAL = (relationship) => relationship === "parent";

export const FALLBACK_STEPS = {
  formal: {
    ru: ["С чего всё началось? Вспомните место и время.", "Расскажите, что тогда происходило. Кто был рядом?", "Какой момент запомнился Вам больше всего?", "Что Вы тогда чувствовали?", "Что эта история значит для Вас сегодня?"],
    kk: ["Бәрі неден басталды? Сол жерді және уақытты еске түсіріңізші.", "Сол кезде не болып жатқанын айтып беріңізші. Қасыңызда кім болды?", "Қай сәт есіңізде ең көп қалды?", "Сол кезде не сезіндіңіз?", "Бұл оқиғаның бүгін сіз үшін мәні қандай?"],
    en: ["Where did it all begin? Picture the place and the time.", "Tell me what was happening then. Who was with you?", "Which moment do you remember most?", "How did you feel back then?", "What does this story mean to you today?"]
  },
  informal: {
    ru: ["С чего всё началось? Вспомни место и время.", "Расскажи, что тогда происходило. Кто был рядом?", "Какой момент запомнился тебе больше всего?", "Что ты тогда чувствовал(а)?", "Что эта история значит для тебя сегодня?"],
    kk: ["Бәрі неден басталды? Сол жерді және уақытты еске түсірші.", "Сол кезде не болып жатқанын айтып берші. Қасыңда кім болды?", "Қай сәт есіңде ең көп қалды?", "Сол кезде не сезіндің?", "Бұл оқиғаның бүгін сен үшін мәні қандай?"],
    en: ["Where did it all begin? Picture the place and the time.", "Tell me what was happening then. Who was with you?", "Which moment do you remember most?", "How did you feel back then?", "What does this story mean to you today?"]
  }
};

export function fallbackSteps(lang, relationship) {
  const set = FORMAL(relationship) ? FALLBACK_STEPS.formal : FALLBACK_STEPS.informal;
  return [...(set[lang] || set.ru)];
}

export const STEPS_SCHEMA = obj({
  questions: list(str("One short lead-up question, in the storyteller's language"), "Exactly 5 questions, in story order")
});

export function stepsPrompt({ mainQuestion, name, from, lang, relationship }) {
  const language = LANG_NAME[lang] || "Russian";
  const address = FORMAL(relationship)
    ? { ru: 'respectful "Вы"', kk: 'respectful "Сіз"', en: '"you"' }[lang] || '"you"'
    : { ru: 'warm informal "ты"', kk: 'warm informal "сен"', en: '"you"' }[lang] || '"you"';
  return [
    `${from || "A family member"} wants to ask ${name || "a loved one"}${RELATION[relationship] ? `, their ${RELATION[relationship]},` : ""} one big question:`,
    `"${mainQuestion}"`,
    "",
    `Write exactly 5 short, warm questions in ${language}, speaking directly to ${name || "them"} with the ${address}.`,
    "Together they must lead them to tell the whole story that answers the big question. Put them in story order:",
    "1. The beginning: where and when it was, who was there.",
    "2. What happened: concrete scenes and details.",
    "3. The key moment or turning point.",
    "4. Feelings: what they felt then, and how they see it now.",
    `5. What it means today, or what they would like ${from || "their family"} to know.`,
    "",
    "Each question:",
    "- is easy to answer out loud in one to three minutes;",
    "- invites concrete details where natural (names, places, colours, sounds, smells, objects);",
    "- asks one thing only, in at most 25 words;",
    "- is gentle; never pushes into pain the big question doesn't ask about.",
    "Do not repeat the big question itself."
  ].join("\n");
}

async function askClaude(body, fetchImpl) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Claude error (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.stop_reason === "max_tokens") throw new Error("Claude stopped early (max_tokens)");
  if (data.stop_reason === "refusal") throw new Error("Claude refused");
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("Claude returned no text");
  return JSON.parse(block.text);
}

// Returns 5 questions; never throws (falls back to general questions).
export async function writeSteps(input, { fetchImpl = fetch } = {}) {
  try {
    const out = await askClaude({
      model: env("CLAUDE_FAST_MODEL") || env("CLAUDE_MODEL") || "claude-sonnet-5-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: stepsPrompt(input) }],
      output_config: { format: { type: "json_schema", schema: STEPS_SCHEMA } }
    }, fetchImpl);
    const qs = (out.questions || []).map((q) => String(q).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5);
    if (qs.length >= 3) return qs;
  } catch (err) {
    console.error("writeSteps failed, using general questions", err.message);
  }
  return fallbackSteps(input.lang, input.relationship);
}

export async function writeStory(input, { fetchImpl = fetch } = {}) {
  return askClaude({
    model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
    max_tokens: 10000,
    messages: [{ role: "user", content: storyPrompt(input) }],
    output_config: { format: { type: "json_schema", schema: STORY_SCHEMA } }
  }, fetchImpl);
}
