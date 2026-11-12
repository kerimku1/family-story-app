// Speech-to-text (ElevenLabs Scribe) and story writing (Claude).
import { env } from "./store.js";
import { describeRoles } from "./roles.js";

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
  follow_up_questions: list(str("A gentle question in the storyteller's language asking for a missing detail"), "2-4 follow-up questions")
});

// The comic: a short graphic-novel episode, 3-4 pages. Pictures never contain text;
// the app draws the narration boxes and speech bubbles itself, so they are always spelled right.
export const COMIC_SCHEMA = obj({
  style_notes: str("In English: era, place, colour palette and mood for the artist"),
  storyteller_voice: { type: "string", enum: ["female", "male", "unknown"], description: "The storyteller's gender (for the narrator voice)" },
  characters: list(obj({
    name: str("Name as used in the dialogue, e.g. 'Mo' or 'Mama'"),
    gender: { type: "string", enum: ["female", "male", "unknown"], description: "Must match the facts given" },
    role: str("In English: who they are in this story, e.g. 'the storyteller, 24', 'the asker, her boyfriend'"),
    look: str("In English: age in this story and a consistent visual look (hair, build, clothes, colours). Use stated details; fill gaps with plausible ones that fit the era and place"),
    is_storyteller: { type: "boolean", description: "True only for the storyteller themself" }
  }), "Every character who appears"),
  panels: list(obj({
    page: { type: "integer", description: "Page number, starting at 1" },
    shape: { type: "string", enum: ["wide", "square"], description: "wide = establishing shot or big moment; square = close-up or conversation" },
    setting: str("In English: where and when, with concrete visual details"),
    action: str("In English: what we see — action, facial expressions, body language, lighting, camera angle"),
    left: str("Name of the character on the LEFT of the frame, or empty"),
    right: str("Name of the character on the RIGHT of the frame, or empty"),
    caption: str("Narration box in the storyteller's language, first person, at most 20 words; empty if not needed"),
    dialogue: list(obj({
      speaker: str("Character name exactly as in characters"),
      side: { type: "string", enum: ["left", "right"], description: "Where the speaker stands in the frame" },
      text: str("What they say, in the storyteller's language, at most 15 words")
    }), "0 to 2 speech bubbles"),
    quote: str("Exact words copied from ONE answer for a real-voice clip, 3-25 words; empty if this panel has none"),
    quote_answer: { type: "integer", description: "The number of the answer the quote is from (1 = Answer 1); 0 if no quote" }
  }), "10 to 14 panels in reading order")
});

const RELATION = { parent: "parent", child: "child", partner: "partner", friend: "friend" };

function answersBlock(parts) {
  const lines = [];
  (parts || []).filter((p) => p.text).forEach((p, i) => {
    lines.push(`Answer ${i + 1} (${p.spoken ? "spoken, transcribed" : "written"}) — question: "${p.question}"`);
    lines.push('"""', p.text, '"""', "");
  });
  return lines;
}

// A story is one main question answered in several parts.
// parts: [{ question, text, spoken }] in order.
export function storyPrompt({ name, from, lang, question, parts, lifeCard, relationship, about }) {
  const language = LANG_NAME[lang] || "the storyteller's language";
  const answered = (parts || []).filter((p) => p.text);
  const roles = describeRoles({ name, from, relationship, about });
  return [
    `You are helping a family keep the life story of ${name || "a loved one"}.`,
    roles.text,
    `The family asked them one main question: "${question}"`,
    `To answer it, they replied to ${answered.length} short lead-up question${answered.length === 1 ? "" : "s"}, in ${language}:`,
    "",
    ...answersBlock(parts),
    "What we already know about them from earlier stories (may be empty):",
    JSON.stringify(lifeCard || {}),
    "",
    "Rules:",
    "- Combine all answers into ONE flowing first-person story that answers the main question. Do not list the lead-up questions; tell it as one story with a beginning, a middle and an end.",
    "- Use ONLY facts from the answers. Never invent names, places, dates, colours or events. If something is unclear, leave it out.",
    `- When they speak to "you", that is ${from || "the person who asked"}.`,
    `- Write the title, story and follow-up questions in ${language}, with grammar that matches the storyteller's gender.`,
    "- Keep their own phrases, humour and way of speaking. Fix only obvious speech slips and typos.",
    "- Respectful and warm. Skip anything painful the storyteller seemed unsure about sharing."
  ].join("\n");
}

export function comicPrompt({ name, from, lang, question, parts, story, title, relationship, about }) {
  const language = LANG_NAME[lang] || "the storyteller's language";
  const roles = describeRoles({ name, from, relationship, about });
  const anySpoken = (parts || []).some((p) => p.text && p.spoken);
  return [
    `Turn a real family story into a comic: a short graphic-novel episode that is fun to read and touches the heart.`,
    "",
    roles.text,
    `${from || "The asker"} asked: "${question}"`,
    "",
    "The storyteller's own answers (the source of truth):",
    "",
    ...answersBlock(parts),
    `The story written from these answers and approved by the storyteller ("${title || ""}"):`,
    '"""', story || "", '"""',
    "",
    "Make it a real comic:",
    "- 3 or 4 pages, 3 or 4 panels per page, 10 to 14 panels in all.",
    "- Page 1 sets the scene and hooks the reader. The middle shows the real moments with humour and life. The last page brings the emotional turn and a warm ending that answers the question; the last panel may come back to today.",
    "- Mix shot sizes: wide panels for places and big moments, square panels for faces and conversations.",
    `- Dialogue makes it alive: short, natural lines in ${language} (at most 15 words each, at most 2 bubbles per panel, some panels silent). Use the storyteller's own words and anything they quoted people saying. Humour where it fits, tenderness at the end.`,
    "- Narration boxes in first person, the storyteller's voice, at most 20 words, for time jumps and inner thoughts. Not every panel needs one.",
    "",
    "Stay true to the person:",
    "- Everything the storyteller said is true and must stay exactly as they said it: names, places, dates, the order of events, who did what, how they felt. Never change, contradict or exaggerate it.",
    "- You MAY add colour around their facts: setting, weather, light, clothing, small gestures, facial expressions, and short dialogue lines that plausibly fit what happened.",
    "- Never add major events, new people who change the plot, or a different outcome.",
    `- When the storyteller says "you", that is ${from || "the asker"} — draw them as the ${roles.askerRole}, with the right gender. The storyteller is the ${roles.tellerRole}.`,
    `- Grammar in ${language} must match each speaker's gender.`,
    "",
    "For the artist (English):",
    "- Give every character one consistent look and use it in every panel. Character genders must match the facts above.",
    "- For each panel say who stands on the left and who on the right; a speech bubble's side must match its speaker's side.",
    "- Settings and actions must be concrete and visual: place, time of day, weather, light, expressions, camera angle.",
    anySpoken
      ? "- Where a panel shows something the storyteller said aloud, copy those words exactly into quote and give the answer number, so their real voice can play. Prefer spoken answers. Otherwise leave quote empty and quote_answer 0."
      : "- Where a panel shows something the storyteller wrote, copy those words exactly into quote and give the answer number. Otherwise leave quote empty and quote_answer 0."
  ].join("\n");
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

export function stepsPrompt({ mainQuestion, name, from, lang, relationship, about }) {
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
    "Do not repeat the big question itself.",
    about && about.gender ? `${name || "They"} ${about.gender === "female" ? "is a woman" : "is a man"}: use matching grammar (e.g. Russian past tense endings).` : "If the grammar needs a gender and it is unknown, use a neutral form."
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

export async function writeComic(input, { fetchImpl = fetch } = {}) {
  return askClaude({
    model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: comicPrompt(input) }],
    output_config: { format: { type: "json_schema", schema: COMIC_SCHEMA } }
  }, fetchImpl);
}

export async function writeStory(input, { fetchImpl = fetch } = {}) {
  return askClaude({
    model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
    max_tokens: 10000,
    messages: [{ role: "user", content: storyPrompt(input) }],
    output_config: { format: { type: "json_schema", schema: STORY_SCHEMA } }
  }, fetchImpl);
}
