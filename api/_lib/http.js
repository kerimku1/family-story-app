import { randomBytes, timingSafeEqual } from "node:crypto";

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function fail(res, status, message) {
  send(res, status, { error: message });
}

// Vercel parses JSON bodies for us; this also handles strings and raw streams (tests).
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, "http://local").searchParams);
}

export function newToken() {
  return randomBytes(18).toString("base64url");
}

export function cleanText(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function isAdmin(req) {
  const expected = String(process.env.STUDIO_PASSWORD || "").trim();
  const header = String(req.headers.authorization || "");
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const LANGS = ["ru", "kk", "en"];

export function extFor(mime) {
  const m = String(mime || "");
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "webm";
}

// Run work after the response is sent (Vercel keeps the function alive for it).
export async function inBackground(promise) {
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(promise);
  } catch {
    await promise;
  }
}
