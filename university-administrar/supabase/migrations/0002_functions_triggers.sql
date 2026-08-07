-- Funções e triggers de suporte.
-- current_role()/current_status() são SECURITY DEFINER com search_path fixo (padrão
-- Supabase) para poderem ser usadas dentro das próprias policies de RLS de "profiles"
-- sem causar recursão infinita de RLS.

create or replace function public.current_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_status()
returns public.user_status
language sql
security definer
set search_path = public
stable
as $$
  select status from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create or replace function public.is_gestor()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_role() = 'gestor', false);
$$;

create or replace function public.is_active_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_status() = 'ativo', false);
$$;

create or replace function public.manages_user(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = target_user_id and manager_id = auth.uid()
  );
$$;

-- Cria automaticamente o profile ao criar um usuário no Supabase Auth.
-- Nunca confia em metadata enviada pelo próprio usuário para definir role/status:
-- todo novo cadastro nasce colaborador/ativo. Promoção a gestor/admin é uma ação
-- administrativa posterior (feita por um admin já existente).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'colaborador',
    'ativo'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Mantém updated_at consistente em todas as tabelas mutáveis.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.trainings
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.training_videos
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.video_progress
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quizzes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.quiz_questions
  for each row execute function public.set_updated_at();

-- Impede que o próprio usuário (ou qualquer requisição não-admin) altere seu role
-- ou status via UPDATE em profiles — desligamento e promoções só por admin.
-- Esta é a segunda camada de defesa; a policy de UPDATE (0003) já restringe quem
-- pode fazer UPDATE, mas esta trigger garante a regra mesmo se a policy mudar.
create or replace function public.prevent_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'Apenas administradores podem alterar role ou status';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_privilege_escalation before update on public.profiles
  for each row execute function public.prevent_privilege_escalation();

-- Marca automaticamente um vídeo como concluído quando o progresso reportado
-- cruza o limiar de conclusão, e registra no histórico de atividades.
-- Regra de conclusão: percent_watched >= 90 (ver documentação do produto) —
-- evita exigir 100% rígido, mas também evita marcar como concluído só por abrir.
create or replace function public.handle_video_progress_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.percent_watched >= 90 and new.completed_at is null then
    new.completed_at = now();
  end if;

  -- TG_OP é checado explicitamente antes de tocar em OLD: durante um INSERT,
  -- OLD não está definido, e uma condição OR/AND em SQL não garante avaliação
  -- de curto-circuito, então "old is null or old.completed_at is null" poderia
  -- lançar erro em runtime durante um INSERT.
  if tg_op = 'INSERT' then
    if new.completed_at is not null then
      insert into public.activity_log (user_id, action, entity_type, entity_id, metadata)
      values (new.user_id, 'video_concluido', 'training_video', new.video_id, '{}'::jsonb);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.completed_at is not null and old.completed_at is null then
      insert into public.activity_log (user_id, action, entity_type, entity_id, metadata)
      values (new.user_id, 'video_concluido', 'training_video', new.video_id, '{}'::jsonb);
    end if;
  end if;

  return new;
end;
$$;

create trigger handle_video_progress_update
  before insert or update on public.video_progress
  for each row execute function public.handle_video_progress_update();

-- Registra automaticamente a finalização de um quiz no histórico.
create or replace function public.handle_quiz_attempt_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_log boolean := false;
begin
  if tg_op = 'INSERT' then
    should_log := new.finished_at is not null;
  elsif tg_op = 'UPDATE' then
    should_log := new.finished_at is not null and old.finished_at is null;
  end if;

  if should_log then
    insert into public.activity_log (user_id, action, entity_type, entity_id, metadata)
    values (
      new.user_id,
      case when new.passed then 'quiz_aprovado' else 'quiz_reprovado' end,
      'quiz',
      new.quiz_id,
      jsonb_build_object('percent', new.percent, 'score', new.score, 'attempt_number', new.attempt_number)
    );
  end if;
  return new;
end;
$$;

create trigger handle_quiz_attempt_finished
  before insert or update on public.quiz_attempts
  for each row execute function public.handle_quiz_attempt_finished();
