"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/lib/types/database";

type Training = Database["public"]["Tables"]["trainings"]["Row"];

export function TrainingForm({
  action,
  defaultValues,
}: {
  action: (formData: FormData) => Promise<{ error?: string | null } | void>;
  defaultValues?: Partial<Training>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" defaultValue={defaultValues?.title} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Descrição</Label>
        <Textarea id="description" name="description" defaultValue={defaultValues?.description ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="category">Categoria</Label>
          <Input id="category" name="category" defaultValue={defaultValues?.category ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="estimatedMinutes">Duração estimada (min)</Label>
          <Input
            id="estimatedMinutes"
            name="estimatedMinutes"
            type="number"
            min={0}
            defaultValue={defaultValues?.estimated_minutes ?? undefined}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="passingScore">Nota mínima de aprovação (%)</Label>
        <Input
          id="passingScore"
          name="passingScore"
          type="number"
          min={0}
          max={100}
          defaultValue={defaultValues?.passing_score ?? 70}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="isMandatory"
          name="isMandatory"
          type="checkbox"
          defaultChecked={defaultValues?.is_mandatory}
          className="size-4"
        />
        <Label htmlFor="isMandatory" className="font-normal">
          Treinamento obrigatório
        </Label>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
