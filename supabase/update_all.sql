-- Catch-up: every database update in one file (002, 003, 004).
-- Safe to run any number of times. Supabase → SQL Editor → New snippet → paste all → Run.

-- ===== 002_panels_and_voice =====

-- The storyteller decides per story whether short voice clips may play in the comic.
alter table answers add column if not exists allow_voice boolean not null default false;

-- A comic is now a set of panels; each panel image knows its place in the story.
alter table media add column if not exists panel_index int;

alter table media drop constraint if exists media_kind_check;
alter table media add constraint media_kind_check check (kind in ('comic', 'video', 'panel'));

create index if not exists media_answer_idx on media (answer_id, panel_index);

-- ===== 003_auto_comics =====

-- New kinds of private files:
--   photo = a real photo of the storyteller, used only as a drawing reference (never shown to family)
--   sheet = the AI character sheet for one story, keeps faces the same in every panel
alter table media drop constraint if exists media_kind_check;
alter table media add constraint media_kind_check check (kind in ('comic', 'video', 'panel', 'photo', 'sheet'));

-- Drawing progress for each story's comic.
alter table answers add column if not exists comic_status text;   -- drawing | ready | partial | failed
alter table answers add column if not exists comic_error text;
alter table answers add column if not exists comic_started_at timestamptz;

-- ===== 004_story_parts =====

-- Who the storyteller is to the person who asked: parent | child | partner | friend
alter table storytellers add column if not exists relationship text;

-- Each story (row in "answers") now has one main question and its lead-up questions.
alter table answers add column if not exists main_key text;          -- id from the question bank, or 'custom'
alter table answers add column if not exists sub_questions jsonb;    -- the ~5 questions the storyteller answers

-- The storyteller's answer to each lead-up question.
create table if not exists parts (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references answers(id) on delete cascade,
  storyteller_id uuid not null references storytellers(id) on delete cascade,
  part_index int not null,
  question_text text not null,
  audio_path text,                       -- private recording (null for a typed answer)
  mime text,
  duration_sec numeric,
  transcript text,                       -- what they said, or what they typed
  words jsonb,                           -- word timings, for real-voice clips
  status text not null default 'pending', -- pending | uploaded | ready | failed
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists parts_answer_idx on parts (answer_id, part_index, created_at);
alter table parts enable row level security;

-- Earlier answers become one-part stories, so nothing is lost.
insert into parts (answer_id, storyteller_id, part_index, question_text, audio_path, mime, duration_sec, transcript, words, status)
select a.id, a.storyteller_id, 0, a.question_text, a.audio_path, a.mime, a.duration_sec, a.transcript, a.words,
       case when a.transcript is not null then 'ready' else 'uploaded' end
from answers a
where (a.audio_path is not null or a.transcript is not null)
  and not exists (select 1 from parts p where p.answer_id = a.id);

update answers set sub_questions = jsonb_build_array(question_text) where sub_questions is null;

-- Make the API see the new columns right away.
notify pgrst, 'reload schema';
