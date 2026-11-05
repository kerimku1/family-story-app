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
      look: str("In English: age in this story and visual look, from stated details; say 'not described' where unknown")
    }), "Characters to draw"),
    panels: list(obj({
      setting: str("In English: where and when the scene happens"),
      action: str("In English: what we see happening"),
      caption: str("Short caption in the storyteller's language"),
      quote: str("The exact words from the transcript to play as real-voice narration for this panel, 3-25 words, copied verbatim")
    }), "4 to 6 comic panels in story order")
  }),
  follow_up_questions: list(str("A gentle question in the storyteller's language asking for a missing detail"), "2-4 follow-up questions")
});

export function storyPrompt({ name, lang, question, transcript, lifeCard }) {
  return [
    `You are helping a family keep the life story of ${name || "a loved one"}.`,
    `The storyteller answered this question by voice in ${LANG_NAME[lang] || "their language"}: "${question}"`,
    "",
    "Transcript of their answer:",
    '"""',
    transcript,
    '"""',
    "",
    "What we already know about them from earlier answers (may be empty):",
    JSON.stringify(lifeCard || {}),
    "",
    "Rules:",
    "- Use ONLY facts from the transcript. Never invent names, places, dates, colours or events. If something is unclear, leave it out.",
    `- Write the title, story, captions and follow-up questions in ${LANG_NAME[lang] || "the storyteller's language"}.`,
    "- Write the story in first person, keeping their own phrases, humour and way of speaking. Fix only obvious speech slips.",
    "- The comic is for the family, so it must be respectful and warm. Skip anything painful the storyteller seemed unsure about sharing.",
    "- Panel quotes must be copied word for word from the transcript so we can play their real voice.",
    "- Visual descriptions for the artist are in English and should be specific: clothing, colours, objects, weather, era — but only from what was said or what is certain from the era and place."
  ].join("\n");
}

export async function writeStory(input, { fetchImpl = fetch } = {}) {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env("CLAUDE_MODEL") || "claude-sonnet-5-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: storyPrompt(input) }],
      output_config: { format: { type: "json_schema", schema: STORY_SCHEMA } }
    })
  });
  if (!res.ok) throw new Error(`Story writing failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (data.stop_reason === "max_tokens") throw new Error("Story writing stopped early (max_tokens)");
  if (data.stop_reason === "refusal") throw new Error("Story writing was refused");
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("Story writing returned no text");
  return JSON.parse(block.text);
}
