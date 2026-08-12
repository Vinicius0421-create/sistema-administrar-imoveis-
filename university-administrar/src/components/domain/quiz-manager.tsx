"use client";

import { useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { addQuizQuestion, deleteQuizQuestion, ensureQuiz } from "@/app/actions/admin-trainings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Question = {
  id: string;
  question: string;
  order: number;
  options: { id: string; option_text: string; is_correct: boolean }[];
};

export function QuizManager({
  trainingId,
  quizId,
  passingScore,
  questions,
}: {
  trainingId: string;
  quizId: string | null;
  passingScore: number;
  questions: Question[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localQuizId, setLocalQuizId] = useState(quizId);
  const formRef = useRef<HTMLFormElement>(null);

  function handleCreateQuiz() {
    startTransition(async () => {
      const res = await ensureQuiz(trainingId, passingScore);
      if (res.error) setError(res.error);
      else if (res.quizId) setLocalQuizId(res.quizId);
    });
  }

  function handleAddQuestion(formData: FormData) {
    if (!localQuizId) return;
    setError(null);
    startTransition(async () => {
      const res = await addQuizQuestion(trainingId, localQuizId, formData);
      if (res?.error) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
    });
  }

  function handleDeleteQuestion(questionId: string) {
    startTransition(async () => {
      await deleteQuizQuestion(trainingId, questionId);
    });
  }

  if (!localQuizId) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Este treinamento ainda não tem quiz.</p>
        <Button size="sm" onClick={handleCreateQuiz} disabled={pending}>
          Criar quiz
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma pergunta cadastrada.</p>
      ) : (
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{q.question}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => handleDeleteQuestion(q.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <ul className="mt-2 space-y-1">
                {q.options.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 text-muted-foreground">
                    {o.is_correct ? <Badge variant="default">Correta</Badge> : null}
                    {o.option_text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">Adicionar pergunta</p>
          <form ref={formRef} action={handleAddQuestion} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="question">Pergunta</Label>
              <Input id="question" name="question" required />
            </div>
            <div className="space-y-2">
              <Label>Alternativas (marque a correta)</Label>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name="correctIndex" value={i} defaultChecked={i === 0} required />
                  <Input name="optionText" placeholder={`Alternativa ${i + 1}`} required={i < 2} />
                </div>
              ))}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adicionando…" : "Adicionar pergunta"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
