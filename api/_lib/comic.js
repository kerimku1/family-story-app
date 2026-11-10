// Automatic comic drawing with Gemini image models.
// 1. A character sheet is drawn from the comic script and real photos of the storyteller.
// 2. Every panel is drawn with the sheet (and photos) attached, so faces and style stay the same.
// Images never contain text: the app adds correctly spelled captions itself.
// Panels are saved as drafts for the studio to check, unless AUTO_PUBLISH=on.
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "./store.js";
import { ffmpegPath, run } from "./clips.js";

const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const MAX_PHOTOS = 3;
const PARALLEL = 3;            // panels drawn at the same time
const STALE_MS = 8 * 60 * 1000; // a "drawing" job older than this is treated as stuck

export function autoComicsOn() {
  return Boolean(env("GEMINI_API_KEY")) && env("AUTO_COMICS").toLowerCase() !== "off";
}
const autoPublishOn = () => env("AUTO_PUBLISH").toLowerCase() === "on";

// ---------- Prompts ----------
function storytellerCharacter(script) {
  const chars = script.characters || [];
  return chars.find((c) => c.is_storyteller) || chars[0] || null;
}

function styleLines(script, tellerName) {
  const lines = [
    `This is a warm family comic about the life of ${tellerName || "a loved one"}, made for their family.`,
    "Style: warm hand-drawn illustration, clean ink outlines, soft natural colours, gentle light, expressive faces. The same style in every image.",
    "Era, place and mood: " + (script.style_notes || "not specified") + ".",
    "Characters:"
  ];
  for (const c of script.characters || []) lines.push(`- ${c.name}: ${c.look}`);
  return lines;
}

const NO_TEXT = "IMPORTANT: no text of any kind in the image — no captions, no speech bubbles, no letters, no words, no signs, no numbers, no watermark.";

function photoNote(script, photoCount, firstIndex) {
  if (!photoCount) return [];
  const me = storytellerCharacter(script);
  const range = photoCount === 1 ? `Image ${firstIndex} is a real photo` : `Images ${firstIndex}–${firstIndex + photoCount - 1} are real photos`;
  return [`${range} of the storyteller. Base ${me ? `"${me.name}"` : "the storyteller"}'s face and features on them, drawn at the age in this story. Keep the drawing style; do not copy the photo's background or clothes unless they fit the scene.`];
}

export function sheetPrompt(script, tellerName, photoCount) {
  return [
    ...styleLines(script, tellerName),
    "",
    "Draw a character reference sheet: every character above, full body, front view and three-quarter view, side by side on a plain light background.",
    ...photoNote(script, photoCount, 1),
    NO_TEXT
  ].join("\n");
}

export function panelPrompt(script, index, tellerName, { hasSheet, photoCount }) {
  const panels = script.panels || [];
  const p = panels[index] || {};
  const refs = [];
  if (hasSheet) refs.push("Image 1 is the character sheet for this comic: draw every character exactly as on it (face, hair, clothes, proportions).");
  refs.push(...photoNote(script, photoCount, hasSheet ? 2 : 1));
  return [
    ...styleLines(script, tellerName),
    "",
    `Draw ONE comic panel: panel ${index + 1} of ${panels.length}.`,
    "Scene: " + (p.setting || "") + ".",
    "What we see: " + (p.action || "") + ".",
    "One clear moment, faces visible, cinematic framing.",
    ...refs,
    NO_TEXT
  ].join("\n");
}

// ---------- Gemini ----------
function pickImage(data) {
  const cand = (data.candidates || [])[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const images = parts.filter((p) => !p.thought && (p.inlineData || p.inline_data));
  const last = images[images.length - 1];
  if (last) {
    const d = last.inlineData || last.inline_data;
    return { data: Buffer.from(d.data, "base64"), mime: d.mimeType || d.mime_type || "image/png" };
  }
  const reason = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || "no image returned";
  throw new Error("Gemini did not draw the image (" + reason + ")");
}

export async function drawImage(prompt, images, { aspectRatio = "4:3", fetchImpl = fetch } = {}) {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = env("GEMINI_IMAGE_MODEL") || DEFAULT_MODEL;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        ...images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.data.toString("base64") } }))
      ]
    }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio, imageSize: env("GEMINI_IMAGE_SIZE") || "1K" }
    }
  };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(150000)
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Gemini is busy (${res.status})`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini error (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return pickImage(await res.json());
    } catch (err) {
      lastErr = err;
      if (!/busy|timeout|fetch failed|ECONNRESET/i.test(String(err.message))) break;
    }
  }
  throw lastErr;
}

// Shrink phone photos so several fit in one request (and the face is what matters).
export async function shrinkPhoto(data, ext) {
  try {
    const dir = await mkdtemp(join(tmpdir(), "photo-"));
    try {
      const input = join(dir, "in." + ext);
      const output = join(dir, "out.jpg");
      await writeFile(input, data);
      await run(await ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-i", input,
        "-vf", "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", "-frames:v", "1", "-q:v", "3", output]);
      return { data: await readFile(output), mime: "image/jpeg" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("shrinkPhoto failed, sending original", err.message);
    return { data, mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  }
}

// ---------- Saving ----------
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

async function saveImage(store, answer, kind, index, image, status) {
  const media = await store.createMedia({
    storyteller_id: answer.storyteller_id, answer_id: answer.id, kind, panel_index: index,
    mime: image.mime, path: "pending", status: "uploading"
  });
  const path = `${answer.storyteller_id}/${kind}s/${media.id}.${EXT[image.mime] || "png"}`;
  await store.upload("media", path, image.data, image.mime);
  await store.updateMedia(media.id, { path, status });
  return { ...media, path, status };
}

async function removeMedia(store, list) {
  const paths = list.map((m) => m.path).filter((p) => p && p !== "pending");
  if (paths.length) await store.remove("media", paths);
  for (const m of list) await store.deleteMedia(m.id);
}

async function loadPhotos(store, storytellerId) {
  const photos = (await store.listMedia(storytellerId))
    .filter((m) => m.kind === "photo" && m.status === "reference")
    .slice(-MAX_PHOTOS);
  const out = [];
  for (const m of photos) {
    const blob = await store.download("media", m.path);
    out.push(await shrinkPhoto(Buffer.from(await blob.arrayBuffer()), String(m.path).split(".").pop()));
  }
  return out;
}

async function loadSheet(store, answerId) {
  const sheet = (await store.listMediaForAnswer(answerId)).filter((m) => m.kind === "sheet" && m.status === "reference").pop();
  if (!sheet) return null;
  const blob = await store.download("media", sheet.path);
  return { data: Buffer.from(await blob.arrayBuffer()), mime: sheet.mime || "image/png" };
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await worker(items[i], i) }; }
      catch (err) { results[i] = { ok: false, error: err }; }
    }
  }));
  return results;
}

// Draw the whole comic, or only the listed panels (panelIndexes) when redrawing.
// newSheet: draw a fresh character sheet even if one exists.
export async function generateComic(store, answerId, { panelIndexes = null, newSheet = false, force = false, fetchImpl = fetch } = {}) {
  let answer = await store.answerById(answerId);
  if (!answer || answer.approval !== "approved" || !answer.comic_script) return;
  const startedAt = answer.comic_started_at ? Date.parse(answer.comic_started_at) : 0;
  if (!force && answer.comic_status === "drawing" && Date.now() - startedAt < STALE_MS) return; // already running

  const script = answer.comic_script;
  const total = (script.panels || []).length;
  const wanted = (panelIndexes || [...Array(total).keys()]).filter((i) => Number.isInteger(i) && i >= 0 && i < total);
  if (!wanted.length) return;

  const myStart = new Date().toISOString();
  await store.updateAnswer(answerId, { comic_status: "drawing", comic_error: null, comic_started_at: myStart });
  const stillMine = async () => {
    const now = await store.answerById(answerId);
    return now && now.comic_started_at === myStart && JSON.stringify(now.comic_script) === JSON.stringify(script) ? now : null;
  };
  try {
    const teller = await store.storytellerById(answer.storyteller_id);
    const photos = await loadPhotos(store, answer.storyteller_id);

    let sheet = newSheet || !panelIndexes ? null : await loadSheet(store, answerId);
    if (!sheet) {
      sheet = await drawImage(sheetPrompt(script, teller.name, photos.length), photos, { aspectRatio: "3:2", fetchImpl });
      const old = (await store.listMediaForAnswer(answerId)).filter((m) => m.kind === "sheet");
      await saveImage(store, answer, "sheet", null, sheet, "reference");
      await removeMedia(store, old);
    }

    const results = await pool(wanted, PARALLEL, async (index) => {
      const prompt = panelPrompt(script, index, teller.name, { hasSheet: true, photoCount: photos.length });
      return drawImage(prompt, [sheet, ...photos], { aspectRatio: "4:3", fetchImpl });
    });

    // Story rewritten or a newer drawing started meanwhile? Then these pictures no longer fit.
    answer = await stillMine();
    if (!answer) return;

    const existing = (await store.listMediaForAnswer(answerId)).filter((m) => m.kind === "panel");
    // A full redraw also drops panels the new script no longer has.
    if (!panelIndexes) await removeMedia(store, existing.filter((m) => m.panel_index >= total));
    const live = existing.some((m) => m.status === "published");
    const failed = [];
    for (let k = 0; k < wanted.length; k++) {
      const index = wanted[k];
      const r = results[k];
      if (!r.ok) { failed.push(`panel ${index + 1}: ${r.error.message}`); continue; }
      const status = live || (autoPublishOn() && !panelIndexes) ? "published" : "draft";
      await saveImage(store, answer, "panel", index, r.value, status);
      await removeMedia(store, existing.filter((m) => m.panel_index === index));
    }

    if (!failed.length && autoPublishOn() && !panelIndexes) {
      for (const m of (await store.listMediaForAnswer(answerId)).filter((x) => x.kind === "panel")) {
        if (m.status === "draft") await store.updateMedia(m.id, { status: "published" });
      }
    }
    await store.updateAnswer(answerId, {
      comic_status: failed.length === wanted.length ? "failed" : failed.length ? "partial" : "ready",
      comic_error: failed.length ? failed.join("; ").slice(0, 500) : null
    });
  } catch (err) {
    console.error("generateComic failed", answerId, err);
    if (await stillMine()) await store.updateAnswer(answerId, { comic_status: "failed", comic_error: String(err.message || err).slice(0, 500) });
  }
}
