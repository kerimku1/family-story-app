// Local demo data for looking at the studio: node test/seed-demo.js (then open /studio.html, password studio-test)
import { startTestServer } from "./test-server.js";
process.env.GEMINI_API_KEY ||= "test-gemini";
const port = Number(process.env.PORT || 8791);
const { url, store } = await startTestServer(port);
const post = (path, body, headers = {}) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
const auth = { authorization: "Bearer " + process.env.STUDIO_PASSWORD };
const wait = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 30)); };
const tok = (c) => ({ t: new URL(c.tellerUrl).searchParams.get("t"), f: new URL(c.familyUrl).searchParams.get("f") });
const latest = async (t) => { const v = await (await fetch(`${url}/api/teller?t=${t}`)).json(); return v.stories.at(-1).id; };
async function answerAll(t, id, approve) {
  await post("/api/teller", { t, action: "text-answer", answerId: id, partIndex: 0, text: "Я родилась в ауле у реки." });
  await post("/api/teller", { t, action: "finish", answerId: id });
  await wait(() => store.db.answers.find((a) => a.id === id).status === "ready");
  if (approve) {
    await post("/api/teller", { t, action: "approve", answerId: id, approval: "approved" });
    await wait(() => ["ready", "partial", "failed"].includes(store.db.answers.find((a) => a.id === id).comic_status));
    await wait(() => store.db.media.some((m) => m.answer_id === id && m.kind === "video" && m.status !== "rendering"));
  }
}
// Mama: an older person with a finished comic, a story waiting for OK, one still answering.
const mama = tok(await post("/api/create", { from: "Мухамед", name: "Мама", lang: "ru", relationship: "parent", mainKey: "p01", mainQuestion: "Кем Вы мечтали стать в детстве?" }));
let id = await latest(mama.t); await answerAll(mama.t, id, true);
await post("/api/studio", { action: "comic-publish", answerId: id, publish: true }, auth);
await post("/api/family", { f: mama.f, action: "ask", mainKey: "p02", mainQuestion: "Вы довольны тем, как сложилась Ваша жизнь?" });
id = await latest(mama.t); await answerAll(mama.t, id, false);
await post("/api/family", { f: mama.f, action: "ask", mainKey: "p03", mainQuestion: "Как Вы познакомились с любовью всей своей жизни?" });
// Partner: the newest person; latest story approved and drawn, waiting to be sent.
const partner = tok(await post("/api/create", { from: "Мухамед", name: "Айгерим", lang: "ru", relationship: "partner", mainKey: "r01", mainQuestion: "Что ты подумала, когда впервые меня увидела?" }));
id = await latest(partner.t); await answerAll(partner.t, id, true);
// …and a newer question with every answer in, but "Write my story" not tapped yet.
await post("/api/family", { f: partner.f, action: "ask", mainKey: "r02", mainQuestion: "What did you think of me when we first met?" });
id = await latest(partner.t);
for (const i of [0, 1, 2, 3, 4]) await post("/api/teller", { t: partner.t, action: "text-answer", answerId: id, partIndex: i, text: "Ответ " + (i + 1) });
console.log("Demo studio at " + url + "/studio.html (password " + process.env.STUDIO_PASSWORD + ")");
