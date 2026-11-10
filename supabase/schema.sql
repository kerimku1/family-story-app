-- Family Story: database and private storage (includes updates 002 and 003).
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create extension if not exists pgcrypto;

-- One row per person whose life we collect.
create table if not exists storytellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- how the family calls them, e.g. "Мама"
  from_name text not null,               -- who asked, e.g. "Мухамед"
  lang text not null default 'ru',       -- ru | kk | en
  teller_token text unique not null,     -- secret link for the storyteller
  family_token text unique not null,     -- secret link for the family page
  life_card jsonb not null default '{}'::jsonb,  -- people, places, years, objects, phrases...
  created_at timestamptz not null default now()
);

-- One row per recorded answer.
create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  storyteller_id uuid not null references storytellers(id) on delete cascade,
  question_index int not null,
  question_text text not null,
  audio_path text,                       -- path in the private "recordings" bucket
  mime text,
  duration_sec numeric,
  status text not null default 'pending',   -- pending | uploaded | processing | ready | failed
  error text,
  transcript text,
  words jsonb,                           -- word timings, used later to cut real-voice clips
  title text,
  story text,                            -- seen only by the storyteller, for approval
  details jsonb,
  comic_script jsonb,                    -- characters + panels for the comic / animation
  follow_up_questions jsonb,
  approval text not null default 'waiting', -- waiting | approved | hidden
  allow_voice boolean not null default false, -- storyteller allows short voice clips in the comic
  comic_status text,                     -- drawing | ready | partial | failed (automatic drawing)
  comic_error text,
  comic_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists answers_storyteller_idx on answers (storyteller_id, created_at);

-- Comics, videos and drawing references. The family sees only published comics and videos;
-- 'photo' (real photos of the storyteller) and 'sheet' (AI character sheets) are never shown to them.
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  storyteller_id uuid not null references storytellers(id) on delete cascade,
  answer_id uuid references answers(id) on delete set null,
  kind text not null check (kind in ('comic', 'video', 'panel', 'photo', 'sheet')),
  panel_index int,                       -- for kind = 'panel': which comic panel this image is
  title text,
  path text not null,                    -- path in the private "media" bucket
  mime text,
  status text not null default 'uploading', -- uploading | published
  created_at timestamptz not null default now()
);
create index if not exists media_storyteller_idx on media (storyteller_id, created_at);
create index if not exists media_answer_idx on media (answer_id, panel_index);

-- Row Level Security on, with no policies: browsers can never read these tables
-- directly. Only the server, using the secret key, can.
alter table storytellers enable row level security;
alter table answers enable row level security;
alter table media enable row level security;

-- Private buckets: files are reachable only through short-lived links made by the server.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false), ('media', 'media', false)
on conflict (id) do nothing;
