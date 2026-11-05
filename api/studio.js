// Production studio for the team that makes comics and videos. Protected by STUDIO_PASSWORD.
// The studio sees a story and its comic script only after the storyteller approved it.
// It never gets the raw recordings.
// GET                                                        → all storytellers with answers and media
// POST { action: "retry", answerId }                          → run transcription + writing again
// POST { action: "media-upload-url", storytellerId, answerId?, kind, mime, title, panelIndex? } → { mediaId, uploadUrl }
//      kind "panel" = one comic panel image (no text in it; captions are added by the app)
// POST { action: "media-publish", mediaId }                    → comic page / video: family can now see it
//                                                                 panel: uploaded, waiting for "comic-publish"
// POST { action: "comic-publish", answerId, publish: true|false } → show or hide this story's panel comic
// POST { action: "media-delete", mediaId }
import { getStore } from "./_lib/store.js";
import { send, fail, readJson, isAdmin, cleanText, inBackground } from "./_lib/http.js";
import { processAnswer, mergeLifeCard } from "./_lib/pipeline.js";

export const config = { maxDuration: 300 };

const MEDIA_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

function answerForStudio(a) {
  const approved = a.approval === "approved";
  return {
    id: a.id,
    questionIndex: a.question_index,
    question: a.question_text,
    status: a.status,
    error: a.error,
    approval: a.approval,
    durationSec: a.duration_sec,
    typed: !a.audio_path,
    allowVoice: Boolean(a.allow_voice),
    createdAt: a.created_at,
    title: approved ? a.title : null,
    story: approved ? a.story : null,
    details: approved ? a.details : null,
    comicScript: approved && a.comic_script ? {
      ...a.comic_script,
      panels: (a.comic_script.panels || []).map(({ clip_path, ...p }) => ({ ...p, hasClip: Boolean(clip_path) }))
    } : null,
    followUpQuestions: approved ? a.follow_up_questions : null
  };
}

export default async function handler(req, res) {
  if (!isAdmin(req)) return fail(res, 401, "Wrong studio password");
  try {
    const store = getStore();

    if (req.method === "GET") {
      const tellers = await store.listStorytellers();
      const out = [];
      for (const t of tellers) {
        const answers = await store.listAnswers(t.id);
        const media = await store.listMedia(t.id);
        const mediaOut = [];
        for (const m of media) {
          mediaOut.push({
            id: m.id, answerId: m.answer_id, kind: m.kind, title: m.title, status: m.status, panelIndex: m.panel_index,
            url: m.status === "published" || m.status === "draft" ? await store.signedUrl("media", m.path, 60 * 60) : null
          });
        }
        out.push({
          id: t.id,
          name: t.name,
          from: t.from_name,
          lang: t.lang,
          createdAt: t.created_at,
          familyToken: t.family_token,
          // Built only from approved stories, so hidden ones never leak into production.
          lifeCard: answers
            .filter((a) => a.approval === "approved" && a.details)
            .reduce((card, a) => mergeLifeCard(card, a.details), {}),
          answers: answers.filter((a) => a.status !== "pending").map(answerForStudio),
          media: mediaOut
        });
      }
      return send(res, 200, { storytellers: out });
    }

    if (req.method !== "POST") return fail(res, 405, "GET or POST only");
    const body = await readJson(req);

    if (body.action === "retry") {
      const answer = await store.answerById(String(body.answerId || ""));
      if (!answer) return fail(res, 404, "Answer not found");
      if (answer.status === "pending" || (!answer.audio_path && !answer.transcript)) return fail(res, 400, "Nothing uploaded yet");
      await store.updateAnswer(answer.id, { status: "uploaded", error: null });
      await inBackground(processAnswer(store, answer.id));
      return send(res, 200, { ok: true });
    }

    if (body.action === "media-upload-url") {
      const teller = await store.storytellerById(String(body.storytellerId || ""));
      if (!teller) return fail(res, 404, "Storyteller not found");
      const kind = ["video", "panel"].includes(body.kind) ? body.kind : "comic";
      const mime = String(body.mime || "");
      const ext = MEDIA_EXT[mime];
      if (!ext) return fail(res, 400, "Use PNG, JPG, WEBP, MP4 or WEBM");
      if (kind === "panel" && !mime.startsWith("image/")) return fail(res, 400, "A panel must be an image");
      let answerId = null;
      let panelIndex = null;
      if (body.answerId) {
        const answer = await store.answerById(String(body.answerId));
        if (!answer || answer.storyteller_id !== teller.id) return fail(res, 404, "Answer not found");
        if (answer.approval !== "approved") return fail(res, 400, "The storyteller has not approved this story");
        answerId = answer.id;
        if (kind === "panel") {
          const count = (answer.comic_script && answer.comic_script.panels || []).length;
          panelIndex = Number(body.panelIndex);
          if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= count) return fail(res, 400, "Bad panel");
        }
      } else if (kind === "panel") {
        return fail(res, 400, "A panel belongs to a story");
      }
      const media = await store.createMedia({
        storyteller_id: teller.id,
        answer_id: answerId,
        kind,
        panel_index: panelIndex,
        title: cleanText(body.title, 120) || null,
        mime,
        path: "pending",
        status: "uploading"
      });
      const path = `${teller.id}/${media.id}.${ext}`;
      await store.updateMedia(media.id, { path });
      const uploadUrl = await store.signedUploadUrl("media", path);
      return send(res, 200, { mediaId: media.id, uploadUrl });
    }

    if (body.action === "media-publish" || body.action === "media-delete") {
      const media = await store.mediaById(String(body.mediaId || ""));
      if (!media) return fail(res, 404, "Media not found");
      if (body.action === "media-publish") {
        if (media.kind === "panel") {
          const siblings = (await store.listMediaForAnswer(media.answer_id)).filter((m) => m.kind === "panel" && m.id !== media.id);
          const live = siblings.some((m) => m.status === "published");
          // A new image for a panel replaces the old one and keeps the comic's current visibility.
          const old = siblings.filter((m) => m.panel_index === media.panel_index);
          await store.updateMedia(media.id, { status: live ? "published" : "draft" });
          await store.remove("media", old.map((m) => m.path).filter((p) => p && p !== "pending"));
          for (const m of old) await store.deleteMedia(m.id);
        } else {
          await store.updateMedia(media.id, { status: "published" });
        }
      } else {
        if (media.path && media.path !== "pending") await store.remove("media", [media.path]);
        await store.deleteMedia(media.id);
      }
      return send(res, 200, { ok: true });
    }

    if (body.action === "comic-publish") {
      const answer = await store.answerById(String(body.answerId || ""));
      if (!answer) return fail(res, 404, "Answer not found");
      if (body.publish && answer.approval !== "approved") return fail(res, 400, "The storyteller has not approved this story");
      const panels = (await store.listMediaForAnswer(answer.id)).filter((m) => m.kind === "panel" && m.status !== "uploading");
      if (body.publish && !panels.length) return fail(res, 400, "Upload at least one panel first");
      for (const m of panels) await store.updateMedia(m.id, { status: body.publish ? "published" : "draft" });
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "Unknown action");
  } catch (err) {
    console.error(err);
    fail(res, 500, "Something went wrong");
  }
}
