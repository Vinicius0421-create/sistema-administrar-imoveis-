"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteTraining, setTrainingStatus } from "@/app/actions/admin-trainings";
import { Button } from "@/components/ui/button";
import type { TrainingStatus } from "@/lib/types/database";

export function TrainingStatusActions({
  trainingId,
  status,
}: {
  trainingId: string;
  status: TrainingStatus;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function changeStatus(next: TrainingStatus) {
    startTransition(async () => {
      const res = await setTrainingStatus(trainingId, next);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Status atualizado.");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Excluir este treinamento e todo o seu conteúdo? Esta ação não pode ser desfeita.")) {
      return;
    }
    startTransition(async () => {
      const res = await deleteTraining(trainingId);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "publicado" ? (
        <Button size="sm" disabled={pending} onClick={() => changeStatus("publicado")}>
          Publicar
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => changeStatus("rascunho")}>
          Voltar para rascunho
        </Button>
      )}
      {status !== "arquivado" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => changeStatus("arquivado")}>
          Arquivar
        </Button>
      ) : null}
      <Button size="sm" variant="destructive" disabled={pending} onClick={handleDelete}>
        Excluir
      </Button>
    </div>
  );
}
