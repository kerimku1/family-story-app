// All database and file-storage access goes through this one object.
// Tests replace it with an in-memory version (see test/fake-store.js).
import { createClient } from "@supabase/supabase-js";

let cached = null;

export function getStore() {
  if (globalThis.__STORY_TEST_STORE__) return globalThis.__STORY_TEST_STORE__;
  if (!cached) cached = supabaseStore();
  return cached;
}

// Environment values pasted into Vercel sometimes carry spaces, new lines or quotes.
export function env(name) {
  return String(process.env[name] || "").trim().replace(/^["']|["']$/g, "").trim();
}

function must(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// Accept the forms people copy from Supabase: "https://ref.supabase.co", ".../rest/v1/",
// or the dashboard address "https://supabase.com/dashboard/project/ref".
export function normalizeSupabaseUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  let u;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text); } catch { return text; }
  const dash = u.pathname.match(/\/project\/([a-z0-9]+)/i);
  if (/(^|\.)supabase\.com$/i.test(u.hostname) && dash) return `https://${dash[1]}.supabase.co`;
  return u.origin;
}

function supabaseStore() {
  const url = normalizeSupabaseUrl(env("SUPABASE_URL"));
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async createStoryteller(row) {
      return must(await db.from("storytellers").insert(row).select().single(), "create storyteller");
    },
    async storytellerByTellerToken(token) {
      return must(await db.from("storytellers").select("*").eq("teller_token", token).maybeSingle(), "find storyteller");
    },
    async storytellerByFamilyToken(token) {
      return must(await db.from("storytellers").select("*").eq("family_token", token).maybeSingle(), "find family");
    },
    async storytellerById(id) {
      return must(await db.from("storytellers").select("*").eq("id", id).maybeSingle(), "find storyteller");
    },
    async listStorytellers() {
      return must(await db.from("storytellers").select("*").order("created_at", { ascending: false }), "list storytellers");
    },
    async updateStoryteller(id, patch) {
      return must(await db.from("storytellers").update(patch).eq("id", id).select().single(), "update storyteller");
    },
    async deleteStoryteller(id) {
      must(await db.from("storytellers").delete().eq("id", id), "delete storyteller");
    },

    async createAnswer(row) {
      return must(await db.from("answers").insert(row).select().single(), "create answer");
    },
    async answerById(id) {
      return must(await db.from("answers").select("*").eq("id", id).maybeSingle(), "find answer");
    },
    async listAnswers(storytellerId) {
      return must(
        await db.from("answers").select("*").eq("storyteller_id", storytellerId).order("created_at", { ascending: true }),
        "list answers");
    },
    async updateAnswer(id, patch) {
      return must(
        await db.from("answers").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
        "update answer");
    },
    async deleteAnswer(id) {
      must(await db.from("answers").delete().eq("id", id), "delete answer");
    },

    async createPart(row) {
      return must(await db.from("parts").insert(row).select().single(), "create part");
    },
    async partById(id) {
      return must(await db.from("parts").select("*").eq("id", id).maybeSingle(), "find part");
    },
    async listParts(answerId) {
      return must(
        await db.from("parts").select("*").eq("answer_id", answerId).order("created_at", { ascending: true }),
        "list parts");
    },
    async listPartsForStoryteller(storytellerId) {
      return must(
        await db.from("parts").select("*").eq("storyteller_id", storytellerId).order("created_at", { ascending: true }),
        "list parts");
    },
    async updatePart(id, patch) {
      return must(
        await db.from("parts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
        "update part");
    },
    async deletePart(id) {
      must(await db.from("parts").delete().eq("id", id), "delete part");
    },

    async createMedia(row) {
      return must(await db.from("media").insert(row).select().single(), "create media");
    },
    async listMediaForAnswer(answerId) {
      return must(
        await db.from("media").select("*").eq("answer_id", answerId).order("created_at", { ascending: true }),
        "list media for answer");
    },
    async mediaById(id) {
      return must(await db.from("media").select("*").eq("id", id).maybeSingle(), "find media");
    },
    async listMedia(storytellerId) {
      return must(
        await db.from("media").select("*").eq("storyteller_id", storytellerId).order("created_at", { ascending: true }),
        "list media");
    },
    async updateMedia(id, patch) {
      return must(await db.from("media").update(patch).eq("id", id).select().single(), "update media");
    },
    async deleteMedia(id) {
      must(await db.from("media").delete().eq("id", id), "delete media");
    },

    // Files
    async signedUploadUrl(bucket, path) {
      const data = must(await db.storage.from(bucket).createSignedUploadUrl(path), "signed upload url");
      return data.signedUrl;
    },
    async download(bucket, path) {
      return must(await db.storage.from(bucket).download(path), "download");
    },
    async upload(bucket, path, data, contentType) {
      must(await db.storage.from(bucket).upload(path, data, { contentType, upsert: true }), "upload");
    },
    async signedUrl(bucket, path, seconds) {
      const data = must(await db.storage.from(bucket).createSignedUrl(path, seconds), "signed url");
      return data.signedUrl;
    },
    async remove(bucket, paths) {
      if (!paths.length) return;
      must(await db.storage.from(bucket).remove(paths), "remove files");
    }
  };
}
