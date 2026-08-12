-- Visão de progresso agregado por (usuário, treinamento). Não é uma tabela
-- gravável: é sempre derivada de video_progress + quiz_attempts, evitando
-- indicadores contraditórios entre telas diferentes.
--
-- security_invoker = true (Postgres 15+/Supabase) faz a view rodar com os
-- privilégios de quem consulta, então as policies de RLS de video_progress e
-- quiz_attempts continuam sendo aplicadas nas linhas subjacentes — a view em
-- si não amplia o acesso de ninguém.
--
-- Regra de progresso: percent = 100 * (vídeos concluídos + quiz aprovado?1:0)
--                                / (total de vídeos + tem quiz?1:0)
-- Só aparece uma linha para (usuário, treinamento) quando o usuário já iniciou
-- algo nesse treinamento (tem ao menos um video_progress ou quiz_attempt); a
-- aplicação trata "não iniciado" como ausência de linha nesta view.

create view public.training_progress
with (security_invoker = true) as
with video_counts as (
  select training_id, count(*) as total_videos
  from public.training_videos
  where status = 'ativo'
  group by training_id
),
user_video_progress as (
  select tv.training_id, vp.user_id,
         count(*) filter (where vp.completed_at is not null) as completed_videos,
         max(vp.updated_at) as last_activity_at
  from public.video_progress vp
  join public.training_videos tv on tv.id = vp.video_id
  group by tv.training_id, vp.user_id
),
quiz_best as (
  select qz.training_id, qa.user_id,
         bool_or(qa.passed) as quiz_passed,
         max(qa.percent) as best_percent,
         count(*) as attempts_count,
         max(qa.finished_at) as last_attempt_at
  from public.quiz_attempts qa
  join public.quizzes qz on qz.id = qa.quiz_id
  group by qz.training_id, qa.user_id
),
training_users as (
  select training_id, user_id from user_video_progress
  union
  select training_id, user_id from quiz_best
)
select
  t.id as training_id,
  t.title as training_title,
  t.is_mandatory,
  t.passing_score,
  tu.user_id,
  coalesce(vc.total_videos, 0) as total_videos,
  coalesce(uvp.completed_videos, 0) as completed_videos,
  (q.id is not null) as has_quiz,
  coalesce(qb.quiz_passed, false) as quiz_passed,
  qb.best_percent as quiz_best_percent,
  coalesce(qb.attempts_count, 0) as quiz_attempts_count,
  round(
    100.0 * (
      coalesce(uvp.completed_videos, 0)
      + (case when q.id is not null and coalesce(qb.quiz_passed, false) then 1 else 0 end)
    )
    / nullif(
      coalesce(vc.total_videos, 0) + (case when q.id is not null then 1 else 0 end),
      0
    )
  ) as percent_complete,
  (
    coalesce(vc.total_videos, 0) + (case when q.id is not null then 1 else 0 end) > 0
    and coalesce(uvp.completed_videos, 0) >= coalesce(vc.total_videos, 0)
    and (q.id is null or coalesce(qb.quiz_passed, false))
  ) as is_complete,
  greatest(uvp.last_activity_at, qb.last_attempt_at) as last_activity_at
from training_users tu
join public.trainings t on t.id = tu.training_id
left join video_counts vc on vc.training_id = t.id
left join user_video_progress uvp on uvp.training_id = t.id and uvp.user_id = tu.user_id
left join public.quizzes q on q.training_id = t.id
left join quiz_best qb on qb.training_id = t.id and qb.user_id = tu.user_id;
