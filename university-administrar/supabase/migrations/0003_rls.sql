-- Row Level Security — nenhuma tabela de aplicação fica acessível sem policy
-- explícita. Todas as policies usam auth.uid() e as funções current_role()/
-- is_admin()/is_active_user() (0002), nunca dados enviados pelo client.

alter table public.profiles enable row level security;
alter table public.trainings enable row level security;
alter table public.training_videos enable row level security;
alter table public.video_progress enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_options enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempt_answers enable row level security;
alter table public.activity_log enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles_select" on public.profiles
  for select
  using (
    id = auth.uid()
    or public.is_admin()
    or (public.is_gestor() and manager_id = auth.uid())
  );

-- Usuário edita seus próprios dados de contato; role/status são bloqueados pela
-- trigger prevent_privilege_escalation mesmo quando o próprio usuário faz o UPDATE.
create policy "profiles_update" on public.profiles
  for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Inserts de profiles acontecem via trigger (handle_new_auth_user, security definer);
-- não há policy de INSERT para o role authenticated, então clients não podem forjar
-- profiles arbitrários.

-- ---------------------------------------------------------------------------
-- trainings / training_videos / quizzes / quiz_questions / quiz_options
-- Conteúdo é gerenciado por admin; leitura liberada a todo usuário ativo,
-- restrita a itens publicados (admin enxerga tudo, inclusive rascunhos).
-- ---------------------------------------------------------------------------
create policy "trainings_select" on public.trainings
  for select
  using (public.is_active_user() and (status = 'publicado' or public.is_admin()));

create policy "trainings_write" on public.trainings
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "training_videos_select" on public.training_videos
  for select
  using (
    public.is_active_user()
    and exists (
      select 1 from public.trainings t
      where t.id = training_videos.training_id
        and (t.status = 'publicado' or public.is_admin())
    )
  );

create policy "training_videos_write" on public.training_videos
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "quizzes_select" on public.quizzes
  for select
  using (
    public.is_active_user()
    and exists (
      select 1 from public.trainings t
      where t.id = quizzes.training_id
        and (t.status = 'publicado' or public.is_admin())
    )
  );

create policy "quizzes_write" on public.quizzes
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "quiz_questions_select" on public.quiz_questions
  for select
  using (
    public.is_active_user()
    and exists (
      select 1 from public.quizzes q
      join public.trainings t on t.id = q.training_id
      where q.id = quiz_questions.quiz_id
        and (t.status = 'publicado' or public.is_admin())
    )
  );

create policy "quiz_questions_write" on public.quiz_questions
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Alternativas: leitura NÃO expõe is_correct para colaboradores — tratado na
-- camada de aplicação (a API/serviço de quiz nunca retorna is_correct para quem
-- ainda não enviou a tentativa); a policy de SELECT aqui cobre a linha inteira
-- porque Postgres RLS é por linha, não por coluna. Ver lib/queries/quiz.ts.
create policy "quiz_options_select" on public.quiz_options
  for select
  using (
    public.is_active_user()
    and exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      join public.trainings t on t.id = q.training_id
      where qq.id = quiz_options.question_id
        and (t.status = 'publicado' or public.is_admin())
    )
  );

create policy "quiz_options_write" on public.quiz_options
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- video_progress — dono lê/escreve; gestor lê dos liderados; admin só lê
-- (progresso não é editável administrativamente, apenas gerado pela aplicação).
-- ---------------------------------------------------------------------------
create policy "video_progress_select" on public.video_progress
  for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (public.is_gestor() and public.manages_user(user_id))
  );

create policy "video_progress_insert" on public.video_progress
  for insert
  with check (user_id = auth.uid() and public.is_active_user());

create policy "video_progress_update" on public.video_progress
  for update
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- quiz_attempts / quiz_attempt_answers — mesmo padrão de video_progress.
-- ---------------------------------------------------------------------------
create policy "quiz_attempts_select" on public.quiz_attempts
  for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (public.is_gestor() and public.manages_user(user_id))
  );

create policy "quiz_attempts_insert" on public.quiz_attempts
  for insert
  with check (user_id = auth.uid() and public.is_active_user());

create policy "quiz_attempts_update" on public.quiz_attempts
  for update
  using (user_id = auth.uid() and public.is_active_user())
  with check (user_id = auth.uid());

create policy "quiz_attempt_answers_select" on public.quiz_attempt_answers
  for select
  using (
    exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_attempt_answers.attempt_id
        and (
          qa.user_id = auth.uid()
          or public.is_admin()
          or (public.is_gestor() and public.manages_user(qa.user_id))
        )
    )
  );

create policy "quiz_attempt_answers_insert" on public.quiz_attempt_answers
  for insert
  with check (
    public.is_active_user()
    and exists (
      select 1 from public.quiz_attempts qa
      where qa.id = quiz_attempt_answers.attempt_id and qa.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- activity_log — histórico próprio; gestor vê dos liderados; admin vê tudo.
-- ---------------------------------------------------------------------------
create policy "activity_log_select" on public.activity_log
  for select
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (public.is_gestor() and public.manages_user(user_id))
  );

create policy "activity_log_insert" on public.activity_log
  for insert
  with check (user_id = auth.uid());
