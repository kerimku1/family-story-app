// A family member creates links for a storyteller.
// POST { from, name, lang } → { tellerUrl, familyUrl }
import { getStore } from "./_lib/store.js";
import { send, fail, readJson, newToken, cleanText, baseUrl, LANGS } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "POST only");
  try {
    const body = await readJson(req);
    const from = cleanText(body.from, 40);
    const name = cleanText(body.name, 40);
    const lang = LANGS.includes(body.lang) ? body.lang : "ru";
    if (!from || !name) return fail(res, 400, "Both names are required");

    const store = getStore();
    const teller = await store.createStoryteller({
      name,
      from_name: from,
      lang,
      teller_token: newToken(),
      family_token: newToken(),
      life_card: {}
    });
    const base = baseUrl(req);
    send(res, 200, {
      tellerUrl: `${base}/?t=${teller.teller_token}`,
      familyUrl: `${base}/family.html?f=${teller.family_token}`
    });
  } catch (err) {
    console.error(err);
    fail(res, 500, "Could not create the links");
  }
}
