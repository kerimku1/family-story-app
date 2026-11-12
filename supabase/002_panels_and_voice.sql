-- Update 2: comic panels and the storyteller's voice permission.
-- Run once in Supabase: SQL Editor → New snippet → paste → Run. Safe to run again.

-- The storyteller decides per story whether short voice clips may play in the comic.
alter table answers add column if not exists allow_voice boolean not null default false;

-- A comic is now a set of panels; each panel image knows its place in the story.
alter table media add column if not exists panel_index int;

alter table media drop constraint if exists media_kind_check;
alter table media add constraint media_kind_check check (kind in ('comic', 'video', 'panel', 'photo', 'sheet'));

create index if not exists media_answer_idx on media (answer_id, panel_index);
