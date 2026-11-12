// The animated story video: each comic picture slowly moves (zoom or pan), with its caption
// drawn by the app (always spelled right) and a voice-over.
// Voice-over: the storyteller's real voice clip for that picture when they allowed it,
// otherwise a calm narrator (ElevenLabs text-to-speech) reading their words.
// The video is saved as a draft for the studio to check, like the comic.
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./store.js";
import { ffmpegPath } from "./clips.js";
import { generateComic } from "./comic.js";

const W = 1280;
const H = 720;
const FPS = 25;
const TITLE_SEC = 3.2;
const SILENT_SEC = 4.5;      // a picture with no voice-over
const AFTER_VOICE_SEC = 1.0; // pause after the words before the next picture
const STALE_MS = 10 * 60 * 1000;
export const APP_VIDEO = -1; // panel_index marker: this video was made by the app (not uploaded by hand)

// Narrators (ElevenLabs default voices, warm and calm). Override with ELEVENLABS_VOICE_FEMALE / _MALE.
const VOICES = { female: "XrExE9yKIg1WjnnlVkGX", male: "JBFqnCBsd6RMkjVDRZzb" };
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

export function autoVideoOn() {
  return env("AUTO_VIDEO").toLowerCase() !== "off";
}

export function narratorFor(script, choice) {
  if (choice === "female" || choice === "male") return choice;
  return script && script.storyteller_voice === "male" ? "male" : "female";
}

function ffmpeg(bin, args, envVars) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120000, maxBuffer: 1 << 22, env: { ...process.env, ...envVars } }, (err, _out, stderr) => {
      if (err) reject(new Error("ffmpeg: " + String(stderr || err.message).split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300)));
      else resolve(String(stderr || ""));
    });
  });
}

// Length of an audio file in seconds (ffmpeg prints it when reading the file).
async function audioSeconds(bin, file) {
  const out = await new Promise((resolve) => {
    execFile(bin, ["-hide_banner", "-i", file], { timeout: 30000 }, (_err, _o, stderr) => resolve(String(stderr || "")));
  });
  const m = out.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// ElevenLabs text to speech → mp3 bytes.
// ElevenLabs limits how many voice requests run at once (2 on the free plan), so take turns
// and wait a little when it says "too many concurrent requests".
const SPEAK_AT_ONCE = 2;
let speaking = 0;
const queue = [];
async function takeTurn() {
  if (speaking < SPEAK_AT_ONCE) { speaking++; return; }
  await new Promise((resolve) => queue.push(resolve));
}
function endTurn() {
  const next = queue.shift();
  if (next) next(); else speaking--;
}

export async function speak(text, narrator, options = {}) {
  await takeTurn();
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await speakOnce(text, narrator, options); }
      catch (err) {
        if (!err.busy || attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  } finally {
    endTurn();
  }
}

async function speakOnce(text, narrator, { fetchImpl = fetch } = {}) {
  const key = env("ELEVENLABS_API_KEY");
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const voice = env(narrator === "male" ? "ELEVENLABS_VOICE_MALE" : "ELEVENLABS_VOICE_FEMALE") || VOICES[narrator] || VOICES.female;
  const res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: env("ELEVENLABS_TTS_MODEL") || "eleven_v3" })
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status === 401) throw new Error("ElevenLabs key has no text-to-speech permission (" + body + ")");
    throw Object.assign(new Error(`ElevenLabs text-to-speech error (${res.status}): ${body}`), { busy: res.status === 429 && /concurrent|rate|too many/i.test(body) });
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------- Captions (ASS subtitles, drawn with the bundled font) ----------
function assText(s) {
  return String(s || "").replace(/[\\{}]/g, "").replace(/\s*\n\s*/g, "\\N").trim();
}
function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
export function captionAss(lines, duration) {
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Caption: dark ink on a cream box at the bottom, like a comic caption.
    "Style: Caption,Lora,44,&H00202428,&H00202428,&H00E6F5FF,&H00E6F5FF,-1,0,0,0,100,100,0,0,3,14,0,2,90,90,36,1",
    "Style: Title,Lora,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1",
    "Style: Sub,Lora,40,&H00C8D8E6,&H00C8D8E6,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,0,0,5,120,120,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines.filter((l) => l.text).map((l) =>
      `Dialogue: 0,${assTime(l.start ?? 0.3)},${assTime(l.end ?? duration - 0.2)},${l.style},,0,0,${l.marginV ?? 0},,{\\fad(300,300)}${assText(l.text)}`)
  ].join("\n");
}

// ---------- Rendering ----------
async function renderSegment(bin, dir, i, { image, audio, duration, ass, motion }) {
  const out = join(dir, `seg${i}.mp4`);
  const assFile = join(dir, `seg${i}.ass`);
  await writeFile(assFile, ass);
  const frames = Math.round(duration * FPS);
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  let video;
  if (image) {
    args.push("-i", image);
    // Make the picture 16:9 and large, then move slowly across it.
    const zoom = {
      in: `zoompan=z='min(1+0.10*on/${frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
      out: `zoompan=z='1.10-0.10*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
      right: `zoompan=z='1.08':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`,
      left: `zoompan=z='1.08':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`
    }[motion];
    video = `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2}:(iw-ow)/2:(ih-oh)*0.3,setsar=1,` +
      `${zoom}:d=${frames}:s=${W}x${H}:fps=${FPS},`;
  } else {
    args.push("-f", "lavfi", "-i", `color=c=0x1d1916:s=${W}x${H}:r=${FPS}:d=${duration.toFixed(2)}`);
    video = "[0:v]";
  }
  video += `subtitles=${assFile}:fontsdir=${FONT_DIR},fade=t=in:st=0:d=0.4,fade=t=out:st=${(duration - 0.4).toFixed(2)}:d=0.4,format=yuv420p[v]`;
  let audioFilter;
  if (audio) {
    args.push("-i", audio);
    audioFilter = `[1:a]aresample=44100,aformat=channel_layouts=mono,adelay=400:all=1,apad,atrim=0:${duration.toFixed(2)}[a]`;
  } else {
    args.push("-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`);
    audioFilter = `[1:a]atrim=0:${duration.toFixed(2)}[a]`;
  }
  args.push("-filter_complex", `${video};${audioFilter}`, "-map", "[v]", "-map", "[a]",
    "-t", duration.toFixed(2), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1", out);
  // libass finds fonts through fontconfig; give it a config that knows only our font folder.
  const conf = join(dir, "fonts.conf");
  await writeFile(conf, `<?xml version="1.0"?><fontconfig><dir>${FONT_DIR}</dir><cachedir>${join(dir, "fc-cache")}</cachedir></fontconfig>`);
  await ffmpeg(bin, args, { FONTCONFIG_FILE: conf });
  return out;
}

// panels: [{ image: Buffer, ext, caption, audio: Buffer|null, audioExt }]
export async function renderVideo({ title, subtitle, panels }) {
  const bin = await ffmpegPath();
  await readFile(join(FONT_DIR, "Lora.ttf")).catch(() => { throw new Error("The caption font is missing on the server (assets/fonts/Lora.ttf)"); });
  const dir = await mkdtemp(join(tmpdir(), "story-video-"));
  try {
    const segments = [];
    segments.push(await renderSegment(bin, dir, 0, {
      duration: TITLE_SEC,
      ass: captionAss([{ style: "Title", text: title, marginV: 0 }, { style: "Sub", text: subtitle ? "\n\n\n" + subtitle : "" }], TITLE_SEC)
    }));
    const motions = ["in", "right", "out", "left"];
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const image = join(dir, `p${i}.${p.ext || "png"}`);
      await writeFile(image, p.image);
      let audio = null;
      let duration = SILENT_SEC;
      if (p.audio) {
        audio = join(dir, `a${i}.${p.audioExt || "mp3"}`);
        await writeFile(audio, p.audio);
        const len = await audioSeconds(bin, audio);
        if (len > 0) duration = Math.max(3.5, Math.min(30, len + 0.4 + AFTER_VOICE_SEC));
      }
      segments.push(await renderSegment(bin, dir, i + 1, {
        image, audio, duration, motion: motions[i % motions.length],
        ass: captionAss([{ style: "Caption", text: p.caption }], duration)
      }));
    }
    const list = join(dir, "list.txt");
    await writeFile(list, segments.map((s) => `file '${s}'`).join("\n"));
    const out = join(dir, "story.mp4");
    await ffmpeg(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------- The whole job for one story ----------
const extOf = (path) => (String(path).split(".").pop() || "png").toLowerCase();

export async function makeVideo(store, answerId, { narrator = null, fetchImpl } = {}) {
  fetchImpl = fetchImpl || fetch;
  const answer = await store.answerById(answerId);
  if (!answer || answer.approval !== "approved" || !answer.comic_script) return null;
  const teller = await store.storytellerById(answer.storyteller_id);
  const all = await store.listMediaForAnswer(answerId);
  const videos = all.filter((m) => m.kind === "video" && m.panel_index === APP_VIDEO);
  if (videos.some((m) => m.status === "rendering" && Date.now() - Date.parse(m.created_at) < STALE_MS)) return null; // already running
  const panelMedia = all.filter((m) => m.kind === "panel" && (m.status === "draft" || m.status === "published"));
  if (!panelMedia.length) return null;

  const job = await store.createMedia({
    storyteller_id: answer.storyteller_id, answer_id: answerId, kind: "video", panel_index: APP_VIDEO,
    title: answer.title || null, mime: "video/mp4", path: "pending", status: "rendering"
  });
  try {
    const script = answer.comic_script;
    const voice = narratorFor(script, narrator);
    const notes = [];
    const parts = await Promise.all((script.panels || []).map(async (p, i) => {
      const pic = panelMedia.filter((m) => m.panel_index === i).pop();
      if (!pic) return null;
      const image = Buffer.from(await (await store.download("media", pic.path)).arrayBuffer());
      let audio = null;
      let audioExt = "mp3";
      if (answer.allow_voice && p.clip_path) {
        try {
          audio = Buffer.from(await (await store.download("media", p.clip_path)).arrayBuffer());
          audioExt = extOf(p.clip_path);
        } catch (err) { notes.push(`picture ${i + 1}: voice clip missing`); }
      }
      if (!audio) {
        const words = String(p.quote || p.caption || "").trim();
        if (words) {
          try { audio = await speak(words, voice, { fetchImpl }); }
          catch (err) { notes.push(`picture ${i + 1}: ${err.message}`); }
        }
      }
      return { image, ext: extOf(pic.path), caption: p.caption, audio, audioExt };
    }));
    const data = await renderVideo({
      title: answer.title || answer.question_text,
      subtitle: teller ? teller.name : "",
      panels: parts.filter(Boolean)
    });
    const path = `${answer.storyteller_id}/${job.id}.mp4`;
    await store.upload("media", path, data, "video/mp4");
    // Replace the previous app-made video; stay on the family page if it was there.
    const wasLive = videos.some((m) => m.status === "published");
    const comicLive = panelMedia.some((m) => m.status === "published");
    const live = wasLive || (comicLive && env("AUTO_PUBLISH").toLowerCase() === "on");
    await store.updateMedia(job.id, { path, status: live ? "published" : "draft", title: answer.title || null });
    await store.remove("media", videos.map((m) => m.path).filter((p) => p && p !== "pending"));
    for (const m of videos) await store.deleteMedia(m.id);
    // Tell the studio if a voice-over was missing (for example, the key can't do text-to-speech).
    const fresh = await store.answerById(answerId);
    if (fresh && fresh.comic_script) await store.updateAnswer(answerId, { comic_script: { ...fresh.comic_script, video_notes: notes } });
    if (notes.length) console.warn("video notes", answerId, notes.join("; "));
    return { mediaId: job.id, notes };
  } catch (err) {
    console.error("makeVideo failed", answerId, err);
    await store.updateMedia(job.id, { status: "failed", title: String(err.message || err).slice(0, 300) });
    return null;
  }
}

// Automatic chain after approval: draw the comic, then make the video from it.
// Only after a full drawing (not a single redraw), and only if there is no video yet.
export async function comicThenVideo(store, answerId, drawOptions = {}) {
  await generateComic(store, answerId, drawOptions);
  if (!autoVideoOn()) return;
  const after = await store.answerById(answerId);
  if (!after || after.comic_status !== "ready") return;
  const media = await store.listMediaForAnswer(answerId);
  const panels = media.filter((m) => m.kind === "panel" && (m.status === "draft" || m.status === "published"));
  const total = (after.comic_script.panels || []).length;
  const hasVideo = media.some((m) => m.kind === "video" && m.panel_index === APP_VIDEO && m.status !== "failed");
  if (panels.length < total || hasVideo) return;
  if (!(await startVideoElsewhere(answerId))) await makeVideo(store, answerId, { fetchImpl: drawOptions.fetchImpl });
}

// On Vercel, ask our own studio endpoint to make the video, so it gets a fresh time limit.
async function startVideoElsewhere(answerId) {
  const base = env("PUBLIC_BASE_URL") || (env("VERCEL_PROJECT_PRODUCTION_URL") ? "https://" + env("VERCEL_PROJECT_PRODUCTION_URL") : "");
  const password = String(process.env.STUDIO_PASSWORD || "").trim();
  if (!process.env.VERCEL || !base || !password) return false;
  try {
    const res = await fetch(base.replace(/\/+$/, "") + "/api/studio", {
      method: "POST",
      headers: { authorization: "Bearer " + password, "content-type": "application/json" },
      body: JSON.stringify({ action: "video-make", answerId }),
      signal: AbortSignal.timeout(20000)
    });
    return res.ok || res.status === 409;
  } catch (err) {
    console.error("could not start the video job", err.message);
    return false;
  }
}
