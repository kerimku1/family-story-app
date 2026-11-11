// Everything the storyteller's page needs. The secret link token (?t=) identifies them.
// A story is one main question, answered through ~5 lead-up questions ("parts").
// GET  ?t=TOKEN                                           → profile and their stories
// POST { t, action: "upload-url", answerId, partIndex, mime }   → { partId, uploadUrl }
// POST { t, action: "uploaded", partId, durationSec }           → recording saved; starts transcribing it
// POST { t, action: "text-answer", answerId, partIndex, text }  → typed answer for one part
// POST { t, action: "finish", answerId }                         → write the story from all parts
// POST { t, action: "approve", answerId, approval: "approved"|"hidden" }
// POST { t, action: "voice", answerId, allow: true|false }       → may short voice clips play in the comic?
// POST { t, action: "delete", answerId }                         → deletes recordings, story, clips and pictures
import { getStore } from "./_lib/store.js";
import { send, fail, readJson, query, extFor, inBackground } from "./_lib/http.js";
import { processAnswer, transcribePart } from "./_lib/pipeline.js";
import { syncClips } from "./_lib/clips.js";
import { autoComicsOn } from "./_lib/comic.js";
import { comicThenVideo } from "./_lib/video.js";
import { storyProgress, deleteStory } from "./_lib/stories.js";

export const config = { maxDuration: 300 };

const EDITABLE = new Set(["collecting", "failed"]);
const MAX_TEXT = 20000;

export function tellerView(teller, answers, parts) {
  return {
    name: teller.name,
    from: teller.from_name,
    lang: teller.lang,
    relationship: teller.relationship || null,
    stories: answers
      .filter((a) => a.status !== "pending")
      .map((a) => {
        const progress = storyProgress(a, parts);
        return {
          id: a.id,
          main: a.question_text,
          steps: progress.steps,
          answeredParts: progress.answeredParts,
          status: a.status,
          title: a.status === "ready" ? a.title : null,
          story: a.status === "ready" ? a.story : null,
          approval: a.approval,
          allowVoice: Boolean(a.allow_voice),
          typed: !progress.spoken,
          createdAt: a.created_at
        };
      })
  };
}

// Older answers to the same lead-up question are replaced by the newest one.
async function dropOlder(store, part) {
  const older = (await store.listParts(part.answer_id)).filter((p) => p.part_index === part.part_index && p.id !== part.id);
  const paths = older.map((p) => p.audio_path).filter(Boolean);
  if (paths.length) await store.remove("recordings", paths);
  for (const p of older) await store.deletePart(p.id);
}

export default async function handler(req, res) {
  try {
    const store = getStore();
    const body = req.method === "POST" ? await readJson(req) : {};
    const token = String((req.method === "POST" ? body.t : query(req).t) || "");
    const teller = token ? await store.storytellerByTellerToken(token) : null;
    if (!teller) return fail(res, 404, "Link not found");

    if (req.method === "GET") {
      return send(res, 200, tellerView(teller, await store.listAnswers(teller.id), await store.listPartsForStoryteller(teller.id)));
    }
    if (req.method !== "POST") return fail(res, 405, "GET or POST only");

    // "uploaded" works on a part; every other action on one of this storyteller's stories.
    if (body.action === "uploaded") {
      const part = body.partId ? await store.partById(String(body.partId)) : null;
      if (!part || part.storyteller_id !== teller.id) return fail(res, 404, "Answer not found");
      if (part.status !== "pending") return send(res, 200, { ok: true });
      const duration = Number(body.durationSec);
      const saved = await store.updatePart(part.id, {
        status: "uploaded",
        duration_sec: Number.isFinite(duration) ? Math.round(duration) : null
      });
      await dropOlder(store, saved);
      await inBackground(transcribePart(store, part.id));
      return send(res, 200, { ok: true });
    }

    const answer = body.answerId ? await store.answerById(String(body.answerId)) : null;
    if (!answer || answer.storyteller_id !== teller.id) return fail(res, 404, "Story not found");
    const steps = Array.isArray(answer.sub_questions) ? answer.sub_questions : [answer.question_text];

    if (body.action === "upload-url" || body.action === "text-answer") {
      if (!EDITABLE.has(answer.status)) return fail(res, 409, "This story is already written");
      const index = Number(body.partIndex);
      if (!Number.isInteger(index) || index < 0 || index >= steps.length) return fail(res, 400, "Bad question");

      if (body.action === "text-answer") {
        const text = String(body.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);
        if (!text) return fail(res, 400, "Empty answer");
        const part = await store.createPart({
          answer_id: answer.id, storyteller_id: teller.id, part_index: index, question_text: steps[index],
          transcript: text, words: [], status: "ready"
        });
        await dropOlder(store, part);
        return send(res, 200, { partId: part.id });
      }

      const mime = String(body.mime || "audio/webm").slice(0, 60);
      const part = await store.createPart({
        answer_id: answer.id, storyteller_id: teller.id, part_index: index, question_text: steps[index],
        mime, status: "pending"
      });
      const path = `${teller.id}/${answer.id}/${part.id}.${extFor(mime)}`;
      await store.updatePart(part.id, { audio_path: path });
      const uploadUrl = await store.signedUploadUrl("recordings", path);
      return send(res, 200, { partId: part.id, uploadUrl });
    }

    if (body.action === "finish") {
      if (!EDITABLE.has(answer.status)) return send(res, 200, { ok: true });
      const parts = (await store.listParts(answer.id)).filter((p) => p.status !== "pending");
      if (!parts.length) return fail(res, 400, "Answer at least one question first");
      await store.updateAnswer(answer.id, { status: "uploaded", error: null });
      await inBackground(processAnswer(store, answer.id));
      return send(res, 200, { ok: true });
    }

    if (body.action === "approve") {
      if (!["approved", "hidden"].includes(body.approval)) return fail(res, 400, "Bad approval");
      if (answer.status !== "ready") return fail(res, 409, "The story isn't written yet");
      await store.updateAnswer(answer.id, { approval: body.approval });
      const jobs = [syncClips(store, answer.id)];
      // First approval: draw the comic automatically (only if it hasn't been drawn yet).
      if (body.approval === "approved" && autoComicsOn()) {
        const drawn = (await store.listMediaForAnswer(answer.id)).some((m) => m.kind === "panel");
        if (!drawn) jobs.push(comicThenVideo(store, answer.id));
      }
      await inBackground(Promise.all(jobs));
      return send(res, 200, { ok: true });
    }

    if (body.action === "voice") {
      const spoken = (await store.listParts(answer.id)).some((p) => p.audio_path && p.status !== "pending");
      if (!spoken) return fail(res, 400, "This story was typed, there is no voice");
      await store.updateAnswer(answer.id, { allow_voice: body.allow === true });
      await inBackground(syncClips(store, answer.id));
      return send(res, 200, { ok: true });
    }

    if (body.action === "delete") {
      await deleteStory(store, answer);
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "Unknown action");
  } catch (err) {
    console.error(err);
    fail(res, 500, "Something went wrong");
  }
}
