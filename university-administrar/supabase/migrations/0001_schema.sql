-- University Administrar — schema inicial
-- Estratégia de isolamento: tabelas compartilhadas + user_id + Row Level Security
-- (ver 0003_rls.sql). Não há bancos físicos separados por usuário: inviável em
-- escala/custo/manutenção e desnecessário, já que RLS garante isolamento completo.

create extension if not exists "pgcrypto";

create type public.user_role as enum ('colaborador', 'gestor', 'admin');
create type public.user_status as enum ('ativo', 'desativado');
create type public.training_status as enum ('rascunho', 'publicado', 'arquivado');
create type public.item_status as enum ('ativo', 'inativo');

-- profiles espelha auth.users (1:1). Populada por trigger em auth.users (0002).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.user_role not null default 'colaborador',
  department text,
  status public.user_status not null default 'ativo',
  manager_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_manager_not_self check (manager_id is distinct from id)
);

create index profiles_manager_id_idx on public.profiles (manager_id);
create index profiles_role_idx on public.profiles (role);
create index profiles_status_idx on public.profiles (status);

create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_url text,
  category text,
  status public.training_status not null default 'rascunho',
  "order" int not null default 0,
  passing_score int not null default 70 check (passing_score between 0 and 100),
  estimated_minutes int check (estimated_minutes is null or estimated_minutes >= 0),
  is_mandatory boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trainings_status_idx on public.trainings (status);
create index trainings_category_idx on public.trainings (category);

create table public.training_videos (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.trainings (id) on delete cascade,
  title text not null,
  description text,
  "order" int not null default 0,
  duration_seconds int not null default 0 check (duration_seconds >= 0),
  video_url text not null,
  status public.item_status not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index training_videos_training_id_idx on public.training_videos (training_id);

create table public.video_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.training_videos (id) on delete cascade,
  watched_seconds int not null default 0 check (watched_seconds >= 0),
  last_position_seconds int not null default 0 check (last_position_seconds >= 0),
  percent_watched numeric(5, 2) not null default 0 check (percent_watched between 0 and 100),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, video_id)
);

create index video_progress_user_id_idx on public.video_progress (user_id);
create index video_progress_video_id_idx on public.video_progress (video_id);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null unique references public.trainings (id) on delete cascade,
  title text not null default 'Quiz',
  passing_score int not null default 70 check (passing_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question text not null,
  "order" int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quiz_questions_quiz_id_idx on public.quiz_questions (quiz_id);

create table public.quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  "order" int not null default 0,
  created_at timestamptz not null default now()
);

create index quiz_options_question_id_idx on public.quiz_options (question_id);

-- Estrutura já preparada para múltiplas tentativas / melhor nota / bloqueio futuro,
-- mesmo que o MVP não limite o número de tentativas.
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  attempt_number int not null default 1 check (attempt_number > 0),
  score int not null default 0,
  percent numeric(5, 2) not null default 0 check (percent between 0 and 100),
  passed boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_seconds int,
  created_at timestamptz not null default now(),
  unique (user_id, quiz_id, attempt_number)
);

create index quiz_attempts_user_id_idx on public.quiz_attempts (user_id);
create index quiz_attempts_quiz_id_idx on public.quiz_attempts (quiz_id);

create table public.quiz_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  selected_option_id uuid references public.quiz_options (id) on delete set null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index quiz_attempt_answers_attempt_id_idx on public.quiz_attempt_answers (attempt_id);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_user_id_idx on public.activity_log (user_id);
create index activity_log_created_at_idx on public.activity_log (created_at desc);
