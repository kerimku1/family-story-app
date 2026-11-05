// Everything the storyteller's page needs. The secret link token (?t=) identifies them.
// GET  ?t=TOKEN                                  → profile, answered questions, their own stories
// POST { t, action: "upload-url", questionIndex, questionText, mime } → { answerId, uploadUrl }
// POST { t, action: "uploaded", answerId, durationSec }               → starts transcription + writing
// POST { t, action: "approve", answerId, approval: "approved"|"hidden" }
// POST { t, action: "delete", answerId }                               → deletes the recording and story
import { getStore } from "./_lib/store.js";
import { send, fail, readJson, query, cleanText, extFor, inBackground } from "./_lib/http.js";
import { processAnswer } from "./_lib/pipeline.js";

export const config = { maxDuration: 300 };

const ANSWERED = new Set(["uploaded", "processing", "ready"]);

export function tellerView(teller, answers) {
  return {
    name: teller.name,
    from: teller.from_name,
    lang: teller.lang,
    answered: [...new Set(answers.filter((a) => ANSWERED.has(a.status)).map((a) => a.question_index))],
    stories: answers
      .filter((a) => a.status !== "pending")
      .map((a) => ({
        id: a.id,
        questionIndex: a.question_index,
        question: a.question_text,
        status: a.status,
        title: a.status === "ready" ? a.title : null,
        story: a.status === "ready" ? a.story : null,
        approval: a.approval,
        createdAt: a.created_at
      }))
  };
}

export default async function handler(req, res) {
  try {
    const store = getStore();
    const body = req.method === "POST" ? await readJson(req) : {};
    const token = String((req.method === "POST" ? body.t : query(req).t) || "");
    const teller = token ? await store.storytellerByTellerToken(token) : null;
    if (!teller) return fail(res, 404, "Link not found");

    if (req.method === "GET") {
      return send(res, 200, tellerView(teller, await store.listAnswers(teller.id)));
    }
    if (req.method !== "POST") return fail(res, 405, "GET or POST only");

    // Every action except upload-url works on one of this storyteller's own answers.
    let answer = null;
    if (body.action !== "upload-url") {
      answer = body.answerId ? await store.answerById(String(body.answerId)) : null;
      if (!answer || answer.storyteller_id !== teller.id) return fail(res, 404, "Answer not found");
    }

    if (body.action === "upload-url") {
      const index = Number(body.questionIndex);
      if (!Number.isInteger(index) || index < 0 || index > 200) return fail(res, 400, "Bad question");
      const mime = cleanText(body.mime, 60) || "audio/webm";
      const created = await store.createAnswer({
        storyteller_id: teller.id,
        question_index: index,
        question_text: cleanText(body.questionText, 500) || `Question ${index + 1}`,
        mime,
        status: "pending"
      });
      const path = `${teller.id}/${created.id}.${extFor(mime)}`;
      await store.updateAnswer(created.id, { audio_path: path });
      const uploadUrl = await store.signedUploadUrl("recordings", path);
      return send(res, 200, { answerId: created.id, uploadUrl });
    }

    if (body.action === "uploaded") {
      if (answer.status !== "pending") return send(res, 200, { ok: true });
      const duration = Number(body.durationSec);
      await store.updateAnswer(answer.id, {
        status: "uploaded",
        duration_sec: Number.isFinite(duration) ? Math.round(duration) : null
      });
      await inBackground(processAnswer(store, answer.id));
      return send(res, 200, { ok: true });
    }

    if (body.action === "approve") {
      if (!["approved", "hidden"].includes(body.approval)) return fail(res, 400, "Bad approval");
      await store.updateAnswer(answer.id, { approval: body.approval });
      return send(res, 200, { ok: true });
    }

    if (body.action === "delete") {
      if (answer.audio_path) await store.remove("recordings", [answer.audio_path]);
      await store.deleteAnswer(answer.id);
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "Unknown action");
  } catch (err) {
    console.error(err);
    fail(res, 500, "Something went wrong");
  }
}
