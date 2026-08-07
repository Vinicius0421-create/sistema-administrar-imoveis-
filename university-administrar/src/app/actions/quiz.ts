"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SubmitQuizResult =
  | { ok: false; error: string }
  | {
      ok: true;
      score: number;
      percent: number;
      passed: boolean;
      correctCount: number;
      totalQuestions: number;
    };

// Correção 100% no servidor: o client nunca recebe is_correct (ver
// lib/queries/quiz.ts), então mesmo interceptando a requisição de submissão
// não há como descobrir as respostas certas antes de responder — a nota é
// sempre calculada aqui, a partir do gabarito lido diretamente do banco.
export async function submitQuizAttempt(input: {
  quizId: string;
  trainingId: string;
  startedAt: string;
  answers: { questionId: string; optionId: string | null }[];
}): Promise<SubmitQuizResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Não autenticado." };

  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select("id, passing_score")
    .eq("id", input.quizId)
    .single();
  if (quizError || !quiz) return { ok: false, error: "Quiz não encontrado." };

  const { data: questions, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("id")
    .eq("quiz_id", input.quizId);
  if (questionsError || !questions || questions.length === 0) {
    return { ok: false, error: "Não foi possível carregar o gabarito do quiz." };
  }

  const { data: options, error: optionsError } = await supabase
    .from("quiz_options")
    .select("question_id, id, is_correct")
    .in(
      "question_id",
      questions.map((q) => q.id)
    );
  if (optionsError) return { ok: false, error: optionsError.message };

  const correctByQuestion = new Map(
    questions.map((q) => [
      q.id,
      (options ?? []).find((o) => o.question_id === q.id && o.is_correct)?.id ?? null,
    ])
  );

  let correctCount = 0;
  const gradedAnswers = input.answers.map((a) => {
    const isCorrect = a.optionId !== null && correctByQuestion.get(a.questionId) === a.optionId;
    if (isCorrect) correctCount += 1;
    return { ...a, isCorrect };
  });

  const totalQuestions = questions.length;
  const percent = Math.round((correctCount / totalQuestions) * 10000) / 100;
  const passed = percent >= quiz.passing_score;
  const finishedAt = new Date();
  const startedAt = new Date(input.startedAt);
  const durationSeconds = Math.max(
    0,
    Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)
  );

  const { count } = await supabase
    .from("quiz_attempts")
    .select("id", { count: "exact", head: true })
    .eq("quiz_id", input.quizId)
    .eq("user_id", user.id);
  const attemptNumber = (count ?? 0) + 1;

  const { data: attempt, error: attemptError } = await supabase
    .from("quiz_attempts")
    .insert({
      user_id: user.id,
      quiz_id: input.quizId,
      attempt_number: attemptNumber,
      score: correctCount,
      percent,
      passed,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_seconds: durationSeconds,
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    return { ok: false, error: attemptError?.message ?? "Não foi possível registrar a tentativa." };
  }

  const { error: answersError } = await supabase.from("quiz_attempt_answers").insert(
    gradedAnswers.map((a) => ({
      attempt_id: attempt.id,
      question_id: a.questionId,
      selected_option_id: a.optionId,
      is_correct: a.isCorrect,
    }))
  );
  if (answersError) return { ok: false, error: answersError.message };

  revalidatePath(`/treinamentos/${input.trainingId}`);
  revalidatePath("/dashboard");
  revalidatePath("/historico");

  return { ok: true, score: correctCount, percent, passed, correctCount, totalQuestions };
}
