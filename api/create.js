// A family member asks someone one main question.
// POST { from, name, lang, relationship, mainKey, mainQuestion }
//   → { tellerUrl, familyUrl, mainQuestion, steps }
import { getStore } from "./_lib/store.js";
import { send, fail, readJson, newToken, cleanText, baseUrl, LANGS } from "./_lib/http.js";
import { RELATIONSHIPS, cleanMain, createStory } from "./_lib/stories.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const body = await readJson(req);
    const from = cleanText(body.from, 40);
    const name = cleanText(body.name, 40);
    const lang = LANGS.includes(body.lang) ? body.lang : "ru";
    const relationship = RELATIONSHIPS.includes(body.relationship) ? body.relationship : null;
    const main = cleanMain(body);
    if (!from || !name) return fail(res, 400, "Both names are required");
    if (!relationship) return fail(res, 400, "Choose who this person is to you");
    if (!main.mainQuestion) return fail(res, 400, "Choose a question");

    const store = getStore();
    const teller = await store.createStoryteller({
      name,
      from_name: from,
      lang,
      relationship,
      teller_token: newToken(),
      family_token: newToken(),
      life_card: {}
    });
    const story = await createStory(store, teller, main);
    const base = baseUrl(req);
    send(res, 200, {
      tellerUrl: `${base}/?t=${teller.teller_token}`,
      familyUrl: `${base}/family.html?f=${teller.family_token}`,
      mainQuestion: story.question_text,
      steps: story.sub_questions
    });
  } catch (err) {
    console.error(err);
    fail(res, 500, "Could not create the links");
  }
}
