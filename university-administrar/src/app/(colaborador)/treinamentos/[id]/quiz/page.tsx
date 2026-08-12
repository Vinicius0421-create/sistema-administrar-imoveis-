import { notFound } from "next/navigation";
import { getTrainingById, getQuizByTrainingId } from "@/lib/queries/trainings";
import { getQuizQuestionsForTaking } from "@/lib/queries/quiz";
import { QuizRunner } from "@/components/domain/quiz-runner";

export default async function TrainingQuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const training = await getTrainingById(id).catch(() => null);
  if (!training || training.status !== "publicado") notFound();

  const quiz = await getQuizByTrainingId(id);
  if (!quiz) notFound();

  const questions = await getQuizQuestionsForTaking(quiz.id);
  if (questions.length === 0) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quiz — {training.title}</h1>
        <p className="text-muted-foreground">
          {questions.length} questões · nota mínima {quiz.passing_score}%
        </p>
      </div>
      <QuizRunner
        quizId={quiz.id}
        trainingId={id}
        trainingTitle={training.title}
        questions={questions}
        passingScore={quiz.passing_score}
      />
    </div>
  );
}
