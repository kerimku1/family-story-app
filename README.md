# Family Story

A family member picks **one main question** for someone close ("Who did you want to become as a child?"). That person opens a link and answers about **5 short lead-up questions** on their phone, by voice or by typing. Nobody hears the recordings. The server combines the answers into **one story** that answers the main question, collects the details of their life (people, places, years, objects, favourite phrases), and prepares a comic script. After the storyteller approves a story, a comic or animated film is made from it. The family sees **only** the finished comics and films.

## How it works

```
Family member            Storyteller                    Server                         Studio (you)              Family
─────────────            ───────────                    ──────                         ────────────              ──────
picks who and   ──────►  opens link, answers ~5
one question             lead-up questions
(Claude writes                                           audio → private storage
 the 5 lead-ups)                                         ElevenLabs: speech → text
                         taps "Write my story"  ───────► Claude: one story, life card,
                                                         comic script + voice clips
                         reads story in "My stories"
                         taps "OK to use"  ───────────────────────────────────────►  sees script, makes
                                                                                      comic / film, uploads ──►  sees comics
                                                                                                                 and films only
```

| Who | Page | Sees |
| --- | --- | --- |
| Family member who sets it up | `/` | Who is this person to you → 30 questions (or your own) → the 5 lead-up questions and two links |
| Storyteller | `/?t=…` | The main question and its lead-up questions, record or type, their own written stories, approve / hide / delete |
| Studio (you) | `/studio.html` | One person at a time (newest first). Each story shows its progress and **one next step** (Draw the comic → Send comic to the family). Never recordings, never unapproved stories |
| Family | `/family.html?f=…` | Finished comics and films; their questions and how far along each is (never the answers); "Ask another question" |

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.js` | Link creation and the storyteller's pages |
| `questions.js` | All interface text in Russian, Kazakh and English |
| `question-bank.js` | The 30 main questions for each relationship (parent, child, partner, friend), in 3 languages |
| `chooser.js` | The "who is this person to you → pick a question" picker, used on the first page and the family page |
| `family.html`, `family.js` | Family page |
| `studio.html`, `studio.js`, `studio.css` | Production studio |
| `styles.css` | Shared look: large text, big buttons, dark mode |
| `api/create.js` | Creates a storyteller, their first question with its lead-up questions, and the two secret links |
| `api/_lib/stories.js` | Adds a main question to a storyteller (Claude writes the lead-up questions) |
| `api/teller.js` | Storyteller actions: upload, approve, delete, list own stories |
| `api/family.js` | Family page data (finished media only) |
| `api/studio.js` | Studio data and media uploads (password-protected) |
| `api/_lib/pipeline.js` | Transcribe → write story → comic script → life card |
| `api/_lib/comic.js` | Draws the character sheet and comic panels with Gemini |
| `api/_lib/clips.js` | Cuts one-sentence voice clips for panels (only when the storyteller allows it) |
| `api/_lib/ai.js` | ElevenLabs Scribe and Claude calls, and the prompt |
| `supabase/schema.sql` | Database tables and private storage buckets |
| `test/` | Tests and a local test server with fake storage and fake AI |

## Set it up (about 30 minutes, once)

You need four accounts. Supabase and Vercel have free plans; ElevenLabs and Anthropic charge per use — check their pricing pages.

### 1. Supabase — database and private file storage

1. Go to supabase.com, sign up, and click **New project**. Choose a region close to your users and save the database password somewhere safe.
2. When the project is ready, open **SQL Editor → New snippet**. Paste everything from `supabase/schema.sql` and click **Run**. You should see "Success".
   - **Already set up before?** Instead, run the update files you haven't run yet, in order: `supabase/002_panels_and_voice.sql`, `supabase/003_auto_comics.sql`, then `supabase/004_story_parts.sql` (one main question + lead-up questions; your old answers are kept as one-part stories).
3. Open **Project Settings → API Keys** (or **API**). Copy:
   - the **Project URL** → this is `SUPABASE_URL`
   - the **secret** key (older projects call it **service_role**) → this is `SUPABASE_SECRET_KEY`. Keep it secret; never put it in browser code.

### 2. ElevenLabs — speech to text (Kazakh, Russian, English)

1. Sign up at elevenlabs.io.
2. Open **Developers → API Keys**, create a key with speech-to-text access → this is `ELEVENLABS_API_KEY`.

### 3. Anthropic — writes the stories and comic scripts

1. Sign up at console.anthropic.com and add a payment method.
2. Open **API Keys → Create Key** → this is `ANTHROPIC_API_KEY`.

### 4. Vercel — runs the website and server

1. Go to vercel.com, sign in with GitHub, click **Add New → Project**, and import `family-story-app`.
2. Framework preset: **Other**. Leave build settings empty.
3. Open **Environment Variables** and add each one from `.env.example`:
   `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, and `STUDIO_PASSWORD` (any long password you choose).
4. Click **Deploy**. Your site will be at `https://family-story-app-….vercel.app` (you can add your own domain later).

### 5. Check it works

1. Open your Vercel address, choose who the person is and one question, and create the links. Open the storyteller link on your phone.
2. Answer a lead-up question by voice or text and tap **Send**. You should see "Saved". Answer a few more, then tap **Write my story** (or, in the studio, **Write the story now**).
3. Wait about a minute and open **My stories**: your story should be written. Tap **OK to use**.
4. Open `/studio.html`, enter your studio password. The story's box says what to do next.
5. Upload any image as a test and open the family link: the image appears there.

If a story shows "couldn't process", open the studio: the error message says which key or service failed. Fix it in Vercel and click **Try again**.

### 6. Turn off the old GitHub Pages site

The GitHub Pages copy can't save answers (it has no server). On GitHub: **Settings → Pages → Unpublish site**.

## Making comics

A comic is a set of panels. The image AI draws only pictures; **the app adds the captions**, so they are always spelled right, in Kazakh, Russian or English.

### Automatic (with a Gemini key)

1. In the studio, add 1–3 clear photos of the storyteller under **Photos of … (optional)** → **Add a photo**. They are used only so the faces look like them; the family never sees them.
2. When the storyteller taps **OK to use** on a story, the server draws it by itself, in about a minute:
   a character sheet from the photos, then every panel with that sheet attached, so faces and style stay the same.
3. In the studio, check the panels. Tap **Redraw** under any picture that looks wrong (to redraw all of them: **More options → Redraw the whole comic**).
4. Tap **Send comic to the family**.

Settings in Vercel → Environment Variables:

| Name | What it does |
| --- | --- |
| `GEMINI_API_KEY` | Turns on automatic drawing. From Google AI Studio → Get API key (billing must be on: image generation has no free tier) |
| `AUTO_PUBLISH` | `on` = publish finished comics to the family without review. Default: off (you review first) |
| `AUTO_COMICS` | `off` = don't draw on approval; only when you click Draw in the studio |
| `GEMINI_IMAGE_MODEL` | Optional. Default `gemini-3.1-flash-image-preview` (about $0.07 per image at 1K); `gemini-3-pro-image-preview` is higher quality and about twice the price |

Each story costs about one character sheet plus one image per panel (usually 4–6).

### By hand (no key needed)

Open **More options**, tap **Copy prompt 1** (2, 3…), make the picture in Gemini, then tap **Use my own** under that picture. Then **Send comic to the family**.

To clean up test data, open the person in the studio → **More for …** → **Delete …** (or **More options → Delete story** for one story).

### Animated video (automatic)

Right after the comic is drawn, the app makes a short video from it: each picture slowly zooms or pans, the caption is drawn by the app (so it's always spelled right), and there is a voice-over. Where the storyteller allowed their voice, it's their **real voice** for that picture. Everywhere else a calm narrator (ElevenLabs text-to-speech, woman or man) reads their words. It takes 1–2 minutes and costs a little ElevenLabs credit.

- Your ElevenLabs key needs **Text to Speech** permission as well as Speech to Text (ElevenLabs → Developers → API Keys → edit the key).
- In the studio: watch the video, tap **Remake video** (choose Woman / Man) if needed, then **Send to the family**. That sends the comic and the video together.
- To turn the automatic video off, add `AUTO_VIDEO=off` in Vercel; the **Make the animated video** button still works.

### The real voice

In **My stories**, the storyteller chooses **With my voice / Without voice** for each approved story (off by default).
- If allowed, the server cuts one short clip per panel — just the sentence quoted for that panel — and the family can tap **Voice** on a panel or **Listen to the story** to play them all in order.
- If not allowed (or the story is hidden), the clips are deleted and the family sees pictures and captions only.
- The full recording is never sent to the family or the studio.

Typed answers have no voice, so their comics are pictures and captions only.

## Privacy

- Recordings are stored in a **private** bucket. No page or API returns them — not the family page, not the studio.
- Database tables have Row Level Security on with no public policies; only the server can read them.
- Links use long random tokens. Anyone with the family link can see that family's published media, so keep it private.
- The storyteller can delete any recording and its story from **My stories**.
- Stories reach the studio only after the storyteller taps **OK to use**.

## Run and test on your computer

```bash
npm install
npm test                    # API and pipeline tests with fake storage and fake AI
node test/test-server.js    # full site at http://localhost:8787, studio password: studio-test
node test/seed-demo.js      # same, with demo people and stories, at http://localhost:8791
```

To run against real services: `npm i -g vercel`, then `vercel link` and `vercel env pull`, then `vercel dev`.

## Next steps

- Generate comic pages automatically from the comic script with an image model, keeping characters consistent.
- Cut real-voice clips automatically from the recordings using the timings, and assemble animated films.
- AI interviewer: ask the follow-up questions the pipeline already writes ("What was the river called?").
- Pre-record the questions in the asking child's own voice.
- Translate captions for grandchildren who don't speak the storyteller's language, keeping the original voice.
- Check every Kazakh text in `questions.js` and `question-bank.js` with a native speaker.
