# Family Story

A person tells their life story to their phone. Nobody hears the recordings. The server writes each answer into a story, collects the details of their life (people, places, years, objects, favourite phrases), and prepares a comic script. After the storyteller approves a story, a comic or animated film is made from it. The family sees **only** the finished comics and films.

## How it works

```
Family member            Storyteller                    Server                         Studio (you)              Family
─────────────            ───────────                    ──────                         ────────────              ──────
creates links  ───────►  opens link, answers by voice
                         taps "Send"  ─────────────────► audio → private storage
                                                         ElevenLabs: speech → text
                                                         Claude: story, life card,
                                                         comic script + voice clips
                         reads story in "My stories"
                         taps "OK to use"  ───────────────────────────────────────►  sees script, makes
                                                                                      comic / film, uploads ──►  sees comics
                                                                                                                 and films only
```

| Who | Page | Sees |
| --- | --- | --- |
| Family member who sets it up | `/` | Two links: one for the storyteller, one for the family |
| Storyteller | `/?t=…` | Questions, record button, their own written stories, approve / hide / delete |
| Studio (you) | `/studio.html` | Approved stories, life card, comic script with voice-clip timings. Never recordings, never unapproved stories |
| Family | `/family.html?f=…` | Finished comics and films only, plus how many stories were collected |

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.js` | Link creation and the storyteller's pages |
| `questions.js` | All interface text and questions in Russian, Kazakh and English |
| `family.html`, `family.js` | Family page |
| `studio.html`, `studio.js`, `studio.css` | Production studio |
| `styles.css` | Shared look: large text, big buttons, dark mode |
| `api/create.js` | Creates a storyteller and their two secret links |
| `api/teller.js` | Storyteller actions: upload, approve, delete, list own stories |
| `api/family.js` | Family page data (finished media only) |
| `api/studio.js` | Studio data and media uploads (password-protected) |
| `api/_lib/pipeline.js` | Transcribe → write story → comic script → life card |
| `api/_lib/ai.js` | ElevenLabs Scribe and Claude calls, and the prompt |
| `supabase/schema.sql` | Database tables and private storage buckets |
| `test/` | Tests and a local test server with fake storage and fake AI |

## Set it up (about 30 minutes, once)

You need four accounts. Supabase and Vercel have free plans; ElevenLabs and Anthropic charge per use — check their pricing pages.

### 1. Supabase — database and private file storage

1. Go to supabase.com, sign up, and click **New project**. Choose a region close to your users and save the database password somewhere safe.
2. When the project is ready, open **SQL Editor → New query**. Paste everything from `supabase/schema.sql` and click **Run**. You should see "Success".
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

1. Open your Vercel address, create links for yourself, and open the storyteller link on your phone.
2. Record one answer and tap **Send**. You should see "Saved".
3. Wait about a minute and open **My stories**: your story should be written. Tap **OK to use**.
4. Open `/studio.html`, enter your studio password. You should see the story and its comic script.
5. Upload any image as a test and open the family link: the image appears there.

If a story shows "couldn't process", open the studio: the error message says which key or service failed. Fix it in Vercel and click **Retry**.

### 6. Turn off the old GitHub Pages site

The GitHub Pages copy can't save answers (it has no server). On GitHub: **Settings → Pages → Unpublish site**.

## Making comics and films (for now, in the studio)

1. In the studio, open an approved story and click **Copy brief for image AI**. The brief lists the characters, era, and each panel.
2. Paste it into an image generator, adjust until the characters look right, and export the page.
3. For a film: animate the panels with a video tool and use the **voice clip timings** shown under each panel to cut the storyteller's real voice for narration (the clip shows where that sentence was spoken in the recording).
4. Upload the result under that story with a title. It appears on the family page right away.

The next version can automate these steps.

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
```

To run against real services: `npm i -g vercel`, then `vercel link` and `vercel env pull`, then `vercel dev`.

## Next steps

- Generate comic pages automatically from the comic script with an image model, keeping characters consistent.
- Cut real-voice clips automatically from the recordings using the timings, and assemble animated films.
- AI interviewer: ask the follow-up questions the pipeline already writes ("What was the river called?").
- Pre-record the questions in the asking child's own voice.
- Translate captions for grandchildren who don't speak the storyteller's language, keeping the original voice.
- Check every Kazakh text in `questions.js` with a native speaker.
