// Short real-voice clips for comic panels.
// Only one sentence per panel is cut from the private recording, and only when the storyteller
// allowed their voice for that story. The full recording is never shared.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAD_BEFORE = 0.15; // seconds kept before the first word
const PAD_AFTER = 0.35;  // and after the last, so words aren't clipped
const MAX_CLIP = 30;

async function ffmpegPath() {
  const mod = await import("ffmpeg-static");
  const path = mod.default || mod;
  if (!path) throw new Error("ffmpeg is not available on this server");
  return path;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 60000, maxBuffer: 1 << 20 }, (err, _out, stderr) => {
      if (err) reject(new Error("ffmpeg: " + String(stderr || err.message).slice(0, 300)));
      else resolve();
    });
  });
}

// Cut [start, end] seconds out of an audio file and return it as AAC in .m4a,
// which plays on iPhone, Android and desktop browsers.
export async function cutClip(audio, start, end, inputExt = "webm") {
  const from = Math.max(0, Number(start) - PAD_BEFORE);
  const length = Math.min(MAX_CLIP, Math.max(0.3, Number(end) + PAD_AFTER - from));
  const dir = await mkdtemp(join(tmpdir(), "clip-"));
  try {
    const input = join(dir, "in." + inputExt);
    const output = join(dir, "out.m4a");
    await writeFile(input, audio);
    await run(await ffmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-ss", from.toFixed(2), "-t", length.toFixed(2),
      "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "96k",
      "-af", "afade=t=in:d=0.05",
      "-movflags", "+faststart",
      output
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const extOf = (path) => (String(path).split(".").pop() || "webm").toLowerCase();

export function clipPaths(answer) {
  return ((answer && answer.comic_script && answer.comic_script.panels) || []).map((p) => p.clip_path).filter(Boolean);
}

// Make the clips match the storyteller's choice: cut them if voice is allowed, delete them if not.
export async function syncClips(store, answerId) {
  try {
    const answer = await store.answerById(answerId);
    const script = answer && answer.comic_script;
    if (!script || !Array.isArray(script.panels)) return;
    const panels = script.panels.map((p) => ({ ...p }));
    const wanted = Boolean(answer.allow_voice && answer.approval === "approved" && answer.audio_path);
    let changed = false;

    if (!wanted) {
      const old = clipPaths(answer);
      if (old.length) {
        await store.remove("media", old);
        panels.forEach((p) => { delete p.clip_path; });
        changed = true;
      }
    } else {
      const missing = panels.filter((p) => p.voice_clip && !p.clip_path);
      if (missing.length) {
        const recording = Buffer.from(await (await store.download("recordings", answer.audio_path)).arrayBuffer());
        const stamp = Date.now();
        for (let i = 0; i < panels.length; i++) {
          const p = panels[i];
          if (!p.voice_clip || p.clip_path) continue;
          try {
            const clip = await cutClip(recording, p.voice_clip.start, p.voice_clip.end, extOf(answer.audio_path));
            const path = `${answer.storyteller_id}/clips/${answer.id}/${i}-${stamp}.m4a`;
            await store.upload("media", path, clip, "audio/mp4");
            p.clip_path = path;
            changed = true;
          } catch (err) {
            console.error("clip failed", answer.id, i, err.message);
          }
        }
      }
    }

    if (changed) {
      // Re-read so we don't overwrite a newer script (for example after a rewrite).
      const fresh = await store.answerById(answerId);
      if (fresh && JSON.stringify(fresh.comic_script) === JSON.stringify(script)) {
        await store.updateAnswer(answerId, { comic_script: { ...script, panels } });
      } else if (wanted) {
        await store.remove("media", panels.map((p) => p.clip_path).filter(Boolean));
      }
    }
  } catch (err) {
    console.error("syncClips failed", answerId, err);
  }
}
