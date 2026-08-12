import "server-only";

import { createClient } from "@/lib/supabase/server";

// Contagens feitas no Postgres (count: 'exact', head: true) em vez de trazer
// as linhas para o Node e contar em JS — evita transferir dados
// desnecessários e escala melhor conforme a base cresce.
export async function getAdminStats() {
  const supabase = await createClient();

  const [
    totalColaboradores,
    colaboradoresAtivos,
    totalTreinamentos,
    treinamentosPublicados,
    totalVideos,
    videosAssistidos,
    videosConcluidos,
    quizAttempts,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "ativo"),
    supabase.from("trainings").select("id", { count: "exact", head: true }),
    supabase
      .from("trainings")
      .select("id", { count: "exact", head: true })
      .eq("status", "publicado"),
    supabase.from("training_videos").select("id", { count: "exact", head: true }),
    supabase
      .from("video_progress")
      .select("id", { count: "exact", head: true })
      .gt("percent_watched", 0),
    supabase
      .from("video_progress")
      .select("id", { count: "exact", head: true })
      .not("completed_at", "is", null),
    supabase.from("quiz_attempts").select("percent, passed"),
  ]);

  const attempts = quizAttempts.data ?? [];
  const averageScore =
    attempts.length === 0
      ? 0
      : Math.round((attempts.reduce((sum, a) => sum + a.percent, 0) / attempts.length) * 100) /
        100;
  const approvalRate =
    attempts.length === 0
      ? 0
      : Math.round((attempts.filter((a) => a.passed).length / attempts.length) * 10000) / 100;

  const { data: progressRows } = await supabase
    .from("training_progress")
    .select("training_id, user_id, is_complete");

  const totalProgressEntries = progressRows?.length ?? 0;
  const completedEntries = progressRows?.filter((p) => p.is_complete).length ?? 0;
  const completionRate =
    totalProgressEntries === 0
      ? 0
      : Math.round((completedEntries / totalProgressEntries) * 10000) / 100;

  return {
    totalColaboradores: totalColaboradores.count ?? 0,
    colaboradoresAtivos: colaboradoresAtivos.count ?? 0,
    totalTreinamentos: totalTreinamentos.count ?? 0,
    treinamentosPublicados: treinamentosPublicados.count ?? 0,
    totalVideos: totalVideos.count ?? 0,
    videosAssistidos: videosAssistidos.count ?? 0,
    videosConcluidos: videosConcluidos.count ?? 0,
    averageScore,
    approvalRate,
    completionRate,
  };
}

export async function getTeamProgressOverview(managerId?: string) {
  const supabase = await createClient();

  let profilesQuery = supabase
    .from("profiles")
    .select("id, full_name, department, status, role")
    .order("full_name", { ascending: true });

  if (managerId) {
    profilesQuery = profilesQuery.eq("manager_id", managerId);
  }

  const { data: profiles, error: profilesError } = await profilesQuery;
  if (profilesError) throw profilesError;

  const { data: progress, error: progressError } = await supabase
    .from("training_progress")
    .select("*");
  if (progressError) throw progressError;

  const { data: mandatoryTrainings } = await supabase
    .from("trainings")
    .select("id")
    .eq("status", "publicado")
    .eq("is_mandatory", true);
  const mandatoryIds = new Set((mandatoryTrainings ?? []).map((t) => t.id));

  return (profiles ?? []).map((p) => {
    const rows = (progress ?? []).filter((r) => r.user_id === p.id);
    const completed = rows.filter((r) => r.is_complete).length;
    const pendingMandatory = [...mandatoryIds].filter(
      (tid) => !rows.find((r) => r.training_id === tid && r.is_complete)
    ).length;

    return {
      ...p,
      trainingsStarted: rows.length,
      trainingsCompleted: completed,
      pendingMandatory,
    };
  });
}
