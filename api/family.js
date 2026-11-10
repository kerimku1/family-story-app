// The family page. It never returns recordings, transcripts or story text —
// only finished comics and videos, plus how many stories have been collected.
// A comic is shown only while its story is approved. Voice clips (one sentence per panel)
// are included only if the storyteller allowed their voice for that story.
// GET ?f=TOKEN
import { getStore } from "./_lib/store.js";
import { send, fail, query } from "./_lib/http.js";

const HOUR = 60 * 60;

export default async function handler(req, res) {
  if (req.method !== "GET") return fail(res, 405, "GET only");
  try {
    const store = getStore();
    const token = String(query(req).f || "");
    const teller = token ? await store.storytellerByFamilyToken(token) : null;
    if (!teller) return fail(res, 404, "Link not found");

    const answers = await store.listAnswers(teller.id);
    const byId = new Map(answers.map((a) => [a.id, a]));
    const visible = (m) => m.status === "published" && (!m.answer_id || byId.get(m.answer_id)?.approval === "approved");
    const media = (await store.listMedia(teller.id)).filter(visible);

    // Panel comics, one per story, in story order.
    const comics = [];
    for (const a of answers) {
      const panels = media.filter((m) => m.kind === "panel" && m.answer_id === a.id).sort((x, y) => x.panel_index - y.panel_index);
      if (!panels.length) continue;
      const script = (a.comic_script && a.comic_script.panels) || [];
      const items = [];
      for (const m of panels) {
        const p = script[m.panel_index] || {};
        items.push({
          url: await store.signedUrl("media", m.path, HOUR),
          caption: p.caption || "",
          clipUrl: a.allow_voice && p.clip_path ? await store.signedUrl("media", p.clip_path, HOUR) : null
        });
      }
      comics.push({ id: a.id, title: a.title || "", panels: items });
    }

    // Finished comic pages and films uploaded as single files.
    const items = [];
    for (const m of media.filter((x) => x.kind === "comic" || x.kind === "video")) {
      items.push({ id: m.id, kind: m.kind, title: m.title, url: await store.signedUrl("media", m.path, HOUR) });
    }

    send(res, 200, {
      name: teller.name,
      from: teller.from_name,
      lang: teller.lang,
      collected: answers.filter((a) => ["uploaded", "processing", "ready"].includes(a.status)).length,
      comics,
      media: items
    });
  } catch (err) {
    console.error(err);
    fail(res, 500, "Something went wrong");
  }
}
