// On Vercel, one server call may run for at most 300 seconds. Long jobs (writing a comic script,
// drawing, making a video) each start in their own call to our studio endpoint, so each gets
// a fresh time limit. Returns false when that is not possible (tests, local runs): run it inline then.
import { env } from "./store.js";

export async function startInOwnCall(body) {
  const base = env("PUBLIC_BASE_URL") || (env("VERCEL_PROJECT_PRODUCTION_URL") ? "https://" + env("VERCEL_PROJECT_PRODUCTION_URL") : "");
  const password = String(process.env.STUDIO_PASSWORD || "").trim();
  if (!process.env.VERCEL || !base || !password) return false;
  try {
    const res = await fetch(base.replace(/\/+$/, "") + "/api/studio", {
      method: "POST",
      headers: { authorization: "Bearer " + password, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    return res.ok || res.status === 409;
  } catch (err) {
    console.error("could not start", body.action, err.message);
    return false;
  }
}
