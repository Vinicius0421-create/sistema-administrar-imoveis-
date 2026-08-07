"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { submitQuizAttempt } from "@/app/actions/quiz";
import type { QuizQuestionForTaking } from "@/lib/queries/quiz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function QuizRunner({
  quizId,
  trainingId,
  trainingTitle,
  questions,
  passingScore,
}: {
  quizId: string;
  trainingId: string;
  trainingTitle: string;
  questions: QuizQuestionForTaking[];
  passingScore: number;
}) {
  const [startedAt] = useState(() => new Date().toISOString());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { percent: number; passed: boolean; correctCount: number; totalQuestions: number }
    | null
    | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);

  const allAnswered = questions.every((q) => answers[q.id]);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await submitQuizAttempt({
        quizId,
        trainingId,
        startedAt,
        answers: questions.map((q) => ({ questionId: q.id, optionId: answers[q.id] ?? null })),
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
    });
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resultado — {trainingTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant={result.passed ? "default" : "destructive"}>
            {result.passed ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
            <AlertTitle>{result.passed ? "Aprovado" : "Reprovado"}</AlertTitle>
            <AlertDescription>
              Você acertou {result.correctCount} de {result.totalQuestions} questões (
              {result.percent}%). Nota mínima para aprovação: {passingScore}%.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button asChild>
              <Link href={`/treinamentos/${trainingId}`}>Voltar ao treinamento</Link>
            </Button>
            {!result.passed ? (
              <Button variant="outline" onClick={() => setResult(undefined)}>
                Tentar novamente
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {questions.map((q, index) => (
        <Card key={q.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {index + 1}. {q.question}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {q.options.map((opt) => (
              <label
                key={opt.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-muted",
                  answers[q.id] === opt.id && "border-primary bg-primary/5"
                )}
              >
                <input
                  type="radio"
                  name={q.id}
                  value={opt.id}
                  checked={answers[q.id] === opt.id}
                  onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                  className="accent-primary"
                />
                {opt.option_text}
              </label>
            ))}
          </CardContent>
        </Card>
      ))}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button onClick={handleSubmit} disabled={!allAnswered || pending} size="lg">
        {pending ? "Enviando…" : "Finalizar quiz"}
      </Button>
    </div>
  );
}
