-- Update 3: automatic comic drawing.
-- Run once in Supabase: SQL Editor → New snippet → paste → Run. Safe to run again.

-- New kinds of private files:
--   photo = a real photo of the storyteller, used only as a drawing reference (never shown to family)
--   sheet = the AI character sheet for one story, keeps faces the same in every panel
alter table media drop constraint if exists media_kind_check;
alter table media add constraint media_kind_check check (kind in ('comic', 'video', 'panel', 'photo', 'sheet'));

-- Drawing progress for each story's comic.
alter table answers add column if not exists comic_status text;   -- drawing | ready | partial | failed
alter table answers add column if not exists comic_error text;
alter table answers add column if not exists comic_started_at timestamptz;
