-- =====================================================================
--  Mock Exam — database setup
--  Run this whole file ONCE in your Postgres SQL editor
--  (Vercel → Storage → your Neon database → "Open in Neon" → SQL Editor).
--  It is safe to run again: it never deletes anything.
-- =====================================================================

-- pgcrypto gives us crypt() + gen_salt() so you can create accounts with plain SQL.
create extension if not exists pgcrypto;

-- People who can sign in (test takers and proctors).
create table if not exists users (
  id            serial primary key,
  username      text not null unique,
  display_name  text not null,
  password_hash text not null,
  role          text not null default 'student' check (role in ('student', 'admin')),
  created_at    timestamptz not null default now()
);

-- Sign-in sessions (one row per signed-in browser).
create table if not exists sessions (
  token       text primary key,
  user_id     integer not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_idx on sessions(user_id);

-- Tests you upload from the proctor dashboard (the JSON file lives in "definition").
create table if not exists tests (
  id          text primary key,
  title       text not null,
  definition  jsonb not null,
  is_open     boolean not null default false,
  start_code  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per person per test: where they are, their timer, and their answers.
create table if not exists attempts (
  id               serial primary key,
  user_id          integer not null references users(id) on delete cascade,
  test_id          text not null references tests(id) on delete cascade,
  status           text not null default 'active',      -- active | paused | completed
  phase            text not null default 'directions',  -- directions | section | break | done
  section_index    integer not null default 0,
  section_ends_at  timestamptz,
  break_ends_at    timestamptz,
  paused_at        timestamptz,
  answers          jsonb not null default '{}'::jsonb,
  view             jsonb not null default '{}'::jsonb,
  away             boolean not null default false,
  away_since       timestamptz,
  away_count       integer not null default 0,
  message          text,
  message_id       integer not null default 0,
  message_ack      integer not null default 0,
  version          integer not null default 0,
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  completed_at     timestamptz,
  unique (user_id, test_id)
);

-- Activity log shown on the proctor dashboard (left the tab, came back, breaks, etc.).
create table if not exists events (
  id             serial primary key,
  attempt_id     integer references attempts(id) on delete cascade,
  user_id        integer references users(id) on delete cascade,
  type           text not null,
  section_index  integer,
  question       integer,
  detail         jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists events_attempt_idx on events(attempt_id);

-- ---------------------------------------------------------------------
--  Proctor (admin) account.
--  Username: proctor     Password: Proctor-2026!
--  Change the password right after your first sign-in
--  (dashboard → Accounts → Reset password), or edit it here before running.
-- ---------------------------------------------------------------------
insert into users (username, display_name, password_hash, role)
values ('proctor', 'Proctor', crypt('Proctor-2026!', gen_salt('bf', 10)), 'admin')
on conflict (username) do nothing;
