// The family page. It never returns recordings, transcripts or story text —
// only finished comics and videos, plus how many stories have been collected.
// GET ?f=TOKEN
import { getStore } from "./_lib/store.js";
import { send, fail, query } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "GET only");
  try {
    const store = getStore();
    const token = String(query(req).f || "");
    const teller = token ? await store.storytellerByFamilyToken(token) : null;
    if (!teller) return fail(res, 404, "Link not found");

    const answers = await store.listAnswers(teller.id);
    const media = (await store.listMedia(teller.id)).filter((m) => m.status === "published");
    const items = [];
    for (const m of media) {
      items.push({
        id: m.id,
        kind: m.kind,
        title: m.title,
        url: await store.signedUrl("media", m.path, 60 * 60)
      });
    }
    send(res, 200, {
      name: teller.name,
      from: teller.from_name,
      lang: teller.lang,
      collected: answers.filter((a) => a.status === "ready" || a.status === "processing" || a.status === "uploaded").length,
      media: items
    });
  } catch (err) {
    console.error(err);
    fail(res, 500, "Something went wrong");
  }
}
