import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function listAllTrainingsForAdmin() {
  const supabase = await createClient();
  const { data: trainings, error } = await supabase
    .from("trainings")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!trainings || trainings.length === 0) return [];

  const trainingIds = trainings.map((t) => t.id);
  const { data: videos } = await supabase
    .from("training_videos")
    .select("id, training_id")
    .in("training_id", trainingIds);
  const { data: quizzes } = await supabase
    .from("quizzes")
    .select("id, training_id")
    .in("training_id", trainingIds);

  return trainings.map((t) => ({
    ...t,
    videoCount: (videos ?? []).filter((v) => v.training_id === t.id).length,
    hasQuiz: (quizzes ?? []).some((q) => q.training_id === t.id),
  }));
}

export async function getTrainingForAdmin(trainingId: string) {
  const supabase = await createClient();

  const { data: training, error } = await supabase
    .from("trainings")
    .select("*")
    .eq("id", trainingId)
    .single();
  if (error || !training) return null;

  const { data: videos } = await supabase
    .from("training_videos")
    .select("*")
    .eq("training_id", trainingId)
    .order("order", { ascending: true });

  const { data: quiz } = await supabase
    .from("quizzes")
    .select("*")
    .eq("training_id", trainingId)
    .maybeSingle();

  let questions: { id: string; question: string; order: number; options: { id: string; option_text: string; is_correct: boolean; order: number }[] }[] = [];

  if (quiz) {
    const { data: qs } = await supabase
      .from("quiz_questions")
      .select("id, question, order")
      .eq("quiz_id", quiz.id)
      .order("order", { ascending: true });

    if (qs && qs.length > 0) {
      const { data: opts } = await supabase
        .from("quiz_options")
        .select("id, question_id, option_text, is_correct, order")
        .in(
          "question_id",
          qs.map((q) => q.id)
        )
        .order("order", { ascending: true });

      questions = qs.map((q) => ({
        ...q,
        options: (opts ?? []).filter((o) => o.question_id === q.id),
      }));
    }
  }

  return { training, videos: videos ?? [], quiz, questions };
}
