// Real photos used only as drawing references, so people in the comic look like themselves.
// A photo shows the storyteller ("teller"), the asker ("asker") or someone else in the story ("other").
// Who is in it (and roughly when it was taken) is kept as JSON in the media row's title.
// The family page never shows these photos.
import { cleanText, extFor } from "./http.js";
import { describeRoles } from "./roles.js";

export const PHOTO_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const WHO = ["teller", "asker", "other"];

export function photoMeta(media, teller) {
  let meta = null;
  try { meta = JSON.parse(media.title || ""); } catch { /* older photos have a plain label or none */ }
  if (!meta || typeof meta !== "object" || !WHO.includes(meta.who)) meta = { who: "teller", name: "", year: "", note: media.title || "" };
  const roles = describeRoles({ name: teller.name, from: teller.from_name, relationship: teller.relationship, about: (teller.life_card || {}).about });
  const name = meta.who === "teller" ? teller.name : meta.who === "asker" ? teller.from_name : (meta.name || "someone in the story");
  const role = meta.who === "teller" ? `the storyteller, the ${roles.tellerRole}` : meta.who === "asker" ? `the asker, the ${roles.askerRole}` : "a person in the story";
  return { who: meta.who, name, role, year: String(meta.year || "").slice(0, 20), note: meta.note || "" };
}

// The photos to draw from: the newest 2 of the storyteller, 1 of the asker, and 1 each of up to 2 other people.
export async function drawingPhotos(store, teller) {
  const all = (await store.listMedia(teller.id)).filter((m) => m.kind === "photo" && m.status === "reference").reverse();
  const out = [];
  const count = { teller: 0, asker: 0 };
  const others = new Set();
  for (const m of all) {
    const meta = photoMeta(m, teller);
    if (meta.who === "other") {
      const key = meta.name.toLowerCase();
      if (others.has(key) || others.size >= 2) continue;
      others.add(key);
    } else if (++count[meta.who] > (meta.who === "teller" ? 2 : 1)) continue;
    out.push({ media: m, meta });
  }
  const order = { teller: 0, asker: 1, other: 2 };
  return out.sort((a, b) => order[a.meta.who] - order[b.meta.who]);
}

// Start an upload. who is limited by the page asking: the storyteller's page or the family page.
export async function startPhotoUpload(store, teller, body, allowed) {
  const mime = String(body.mime || "");
  if (!PHOTO_MIME[mime]) return { error: "Use a JPG, PNG or WEBP photo" };
  const who = allowed.includes(body.who) ? body.who : allowed[0];
  const title = JSON.stringify({ who, name: who === "other" ? cleanText(body.name, 40) : "", year: cleanText(body.year, 20) });
  if (who === "other" && !cleanText(body.name, 40)) return { error: "Say who is in the photo" };
  const media = await store.createMedia({ storyteller_id: teller.id, answer_id: null, kind: "photo", panel_index: null, title, mime, path: "pending", status: "uploading" });
  const path = `${teller.id}/${media.id}.${PHOTO_MIME[mime] || extFor(mime)}`;
  await store.updateMedia(media.id, { path });
  return { mediaId: media.id, uploadUrl: await store.signedUploadUrl("media", path) };
}

export async function finishPhotoUpload(store, teller, mediaId, allowed) {
  const media = mediaId ? await store.mediaById(String(mediaId)) : null;
  if (!media || media.storyteller_id !== teller.id || media.kind !== "photo") return false;
  if (!allowed.includes(photoMeta(media, teller).who)) return false;
  await store.updateMedia(media.id, { status: "reference" });
  return true;
}

export async function deletePhoto(store, teller, mediaId, allowed) {
  const media = mediaId ? await store.mediaById(String(mediaId)) : null;
  if (!media || media.storyteller_id !== teller.id || media.kind !== "photo") return false;
  if (!allowed.includes(photoMeta(media, teller).who)) return false;
  if (media.path && media.path !== "pending") await store.remove("media", [media.path]);
  await store.deleteMedia(media.id);
  return true;
}
