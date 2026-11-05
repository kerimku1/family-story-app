// Local test server: the real API handlers + the real pages, with fake storage and fake AI.
// Run: node test/test-server.js   then open http://localhost:8787
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeStore, installFakeApis } from "./fake-store.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4" };

export async function startTestServer(port = PORT) {
  process.env.ELEVENLABS_API_KEY ||= "test";
  process.env.ANTHROPIC_API_KEY ||= "test";
  process.env.STUDIO_PASSWORD ||= "studio-test";
  const store = createFakeStore(`http://localhost:${port}`);
  globalThis.__STORY_TEST_STORE__ = store;
  const apiLog = [];
  installFakeApis(apiLog);

  const handlers = {};
  for (const name of ["create", "teller", "family", "studio"]) {
    handlers[name] = (await import(`../api/${name}.js`)).default;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    try {
      const api = url.pathname.match(/^\/api\/([a-z]+)$/);
      if (api && handlers[api[1]]) return await handlers[api[1]](req, res);

      const up = url.pathname.match(/^\/__upload\/([a-z]+)\/(.+)$/);
      if (up && req.method === "PUT") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        store.files.set(`${up[1]}/${decodeURIComponent(up[2])}`, { data: Buffer.concat(chunks), type: req.headers["content-type"] });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ Key: up[2] }));
      }
      const file = url.pathname.match(/^\/__file\/([a-z]+)\/(.+)$/);
      if (file) {
        const f = store.files.get(`${file[1]}/${decodeURIComponent(file[2])}`);
        if (!f) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": f.type });
        return res.end(f.data);
      }

      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
      if (safe.startsWith("/api") || safe.startsWith("/test") || safe.startsWith("/node_modules")) { res.writeHead(404); return res.end(); }
      const body = await readFile(join(ROOT, safe));
      res.writeHead(200, { "content-type": TYPES[extname(safe)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      if (!res.headersSent) { res.writeHead(err.code === "ENOENT" ? 404 : 500); res.end(); }
      else console.error(err);
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return { server, store, apiLog, url: `http://localhost:${port}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startTestServer().then(({ url }) => console.log("Test server running at " + url + " (studio password: " + process.env.STUDIO_PASSWORD + ")"));
}
