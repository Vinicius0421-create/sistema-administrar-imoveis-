import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function getMyActivityLog(limit = 50) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

export async function getMyQuizAttemptsHistory(limit = 50) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: attempts, error } = await supabase
    .from("quiz_attempts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  if (attempts.length === 0) return [];

  const quizIds = [...new Set(attempts.map((a) => a.quiz_id))];
  const { data: quizzes, error: quizzesError } = await supabase
    .from("quizzes")
    .select("id, training_id")
    .in("id", quizIds);
  if (quizzesError) throw quizzesError;

  const trainingIds = [...new Set((quizzes ?? []).map((q) => q.training_id))];
  const { data: trainings, error: trainingsError } = await supabase
    .from("trainings")
    .select("id, title")
    .in("id", trainingIds);
  if (trainingsError) throw trainingsError;

  const trainingTitleByQuizId = new Map(
    (quizzes ?? []).map((q) => [
      q.id,
      trainings?.find((t) => t.id === q.training_id)?.title ?? "Treinamento removido",
    ])
  );

  return attempts.map((a) => ({
    ...a,
    trainingTitle: trainingTitleByQuizId.get(a.quiz_id) ?? "Treinamento removido",
  }));
}
