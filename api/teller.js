// Everything the storyteller's page needs. The secret link token (?t=) identifies them.
// GET  ?t=TOKEN                                  → profile, answered questions, their own stories
// POST { t, action: "upload-url", questionIndex, questionText, mime } → { answerId, uploadUrl }
// POST { t, action: "uploaded", answerId, durationSec }               → starts transcription + writing
// POST { t, action: "text-answer", questionIndex, questionText, text } → typed answer, starts writing
// POST { t, action: "approve", answerId, approval: "approved"|"hidden" }
// POST { t, action: "voice", answerId, allow: true|false }             → may short voice clips play in the comic?
// POST { t, action: "delete", answerId }                               → deletes the recording, story, clips and panels
import { getStore } from "./_lib/store.js";
import { send, fail, readJson, query, cleanText, extFor, inBackground } from "./_lib/http.js";
import { processAnswer } from "./_lib/pipeline.js";
import { syncClips, clipPaths } from "./_lib/clips.js";

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
        allowVoice: Boolean(a.allow_voice),
        typed: !a.audio_path,
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
    if (body.action !== "upload-url" && body.action !== "text-answer") {
      answer = body.answerId ? await store.answerById(String(body.answerId)) : null;
      if (!answer || answer.storyteller_id !== teller.id) return fail(res, 404, "Answer not found");
    }

    const index = Number(body.questionIndex);
    const badIndex = !Number.isInteger(index) || index < 0 || index > 200;

    if (body.action === "text-answer") {
      if (badIndex) return fail(res, 400, "Bad question");
      const text = String(body.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 20000);
      if (!text) return fail(res, 400, "Empty answer");
      const created = await store.createAnswer({
        storyteller_id: teller.id,
        question_index: index,
        question_text: cleanText(body.questionText, 500) || `Question ${index + 1}`,
        status: "uploaded",
        transcript: text,
        words: []
      });
      await inBackground(processAnswer(store, created.id));
      return send(res, 200, { answerId: created.id });
    }

    if (body.action === "upload-url") {
      if (badIndex) return fail(res, 400, "Bad question");
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
      await inBackground(syncClips(store, answer.id));
      return send(res, 200, { ok: true });
    }

    if (body.action === "voice") {
      if (!answer.audio_path) return fail(res, 400, "This answer was typed, there is no voice");
      await store.updateAnswer(answer.id, { allow_voice: body.allow === true });
      await inBackground(syncClips(store, answer.id));
      return send(res, 200, { ok: true });
    }

    if (body.action === "delete") {
      if (answer.audio_path) await store.remove("recordings", [answer.audio_path]);
      const media = await store.listMediaForAnswer(answer.id);
      await store.remove("media", [...clipPaths(answer), ...media.map((m) => m.path).filter((p) => p && p !== "pending")]);
      for (const m of media) await store.deleteMedia(m.id);
      await store.deleteAnswer(answer.id);
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "Unknown action");
  } catch (err) {
    console.error(err);
    fail(res, 500, "Something went wrong");
  }
}
