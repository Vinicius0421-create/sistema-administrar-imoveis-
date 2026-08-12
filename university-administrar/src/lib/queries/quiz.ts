import "server-only";

import { createClient } from "@/lib/supabase/server";

export type QuizQuestionForTaking = {
  id: string;
  question: string;
  order: number;
  options: { id: string; option_text: string; order: number }[];
};

// Nunca retorna is_correct para quem vai responder o quiz — mesmo que a
// policy de RLS libere a leitura da linha inteira (é por linha, não por
// coluna), a aplicação nunca envia esse campo para o client. Ver comentário
// em supabase/migrations/0003_rls.sql.
export async function getQuizQuestionsForTaking(quizId: string): Promise<QuizQuestionForTaking[]> {
  const supabase = await createClient();
  const { data: questions, error } = await supabase
    .from("quiz_questions")
    .select("id, question, order")
    .eq("quiz_id", quizId)
    .order("order", { ascending: true });

  if (error) throw error;
  if (!questions || questions.length === 0) return [];

  const { data: options, error: optionsError } = await supabase
    .from("quiz_options")
    .select("id, question_id, option_text, order")
    .in(
      "question_id",
      questions.map((q) => q.id)
    )
    .order("order", { ascending: true });

  if (optionsError) throw optionsError;

  return questions.map((q) => ({
    id: q.id,
    question: q.question,
    order: q.order,
    options: (options ?? [])
      .filter((o) => o.question_id === q.id)
      .map((o) => ({ id: o.id, option_text: o.option_text, order: o.order })),
  }));
}

export async function getMyQuizAttempts(quizId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("*")
    .eq("quiz_id", quizId)
    .eq("user_id", user.id)
    .order("attempt_number", { ascending: false });

  if (error) throw error;
  return data;
}
